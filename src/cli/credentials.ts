/**
 * 登录态同步（ensureSynced）
 *
 * 职责：确保当前会话的 bot 在自己的配置目录里有可用登录态，返回该目录。
 *
 * **授权动作整体委托 cli**：spawn `wecom-cli auth init --bot-id <ID> --secret <SECRET>`
 * （cli >= 0.1.9-build.149，stderr 非 TTY 时走直连授权分支）。
 * 插件不再复刻凭据协议——签名算法、AES-GCM格式、`.encryption_key`、原子写
 * 全部由 cli 负责。那些代码曾是整套方案最脆的部分：cli 改一处格式，
 * 插件就静默解密失败，且表现为"未授权"，完全不指向真实原因。
 *
 * 本文件只保留 cli 里不存在的 **openclaw 侧策略**：
 *   1. 目录隔离：每个 (botId, secret) 组合一个目录 → 多 bot 隔离 + secret 轮换即时生效
 *   2. 短路：`auth init` 无幂等，每次调用都会打一次鉴权接口（45009 频率限制）
 *   3. 并发去重 + 全局串行
 *   4. 重签冷却熔断
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  CLI_AUTH_TIMEOUT_MS,
  CLI_KILL_FORCE_WAIT_MS,
  CLI_KILL_GRACE_MS,
  CLI_LOG,
  CLI_MAX_OUTPUT_BYTES,
  CLI_RESIGN_COOLDOWN_MS,
} from "./const.js";
import { resolveStateDir } from "../state-dir-resolve.js";
import { spawn } from "./process-launcher.js";
import { BoundedOutputCollector } from "./process-output.js";

export class CliAuthError extends Error {
  constructor(
    message: string,
    readonly errcode?: number,
  ) {
    super(message);
  }
}

export type CliEnvOverrides = Partial<
  Record<"WECOM_CLI_BASE_URL" | "WECOM_CLI_AUTH_ENDPOINT" | "WECOM_CLI_ADDITIONAL_HEADERS", string>
>;

const sha256Hex = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

// ============================================================================
// 路径
// ============================================================================

/** 目录名里secret 指纹的长度 */
const FINGERPRINT_LEN = 8;
/** 兄弟目录清理时用于识别"本插件生成的目录"的形状 */
const DIR_SHAPE = new RegExp(`^(.+)-([0-9a-f]{${FINGERPRINT_LEN}})$`);

const cliStateRoot = () => path.join(resolveStateDir(), "wecom-cli");
const safeBotId = (botId: string) => botId.replace(/[^A-Za-z0-9_-]/g, "_");
const credentialsPath = (dir: string) => path.join(dir, "credentials.enc");
const keyPath = (dir: string) => path.join(dir, ".encryption_key");

/**
 * 配置目录 = `<state>/wecom-cli/<safeBotId>-<sha8(botId:secret)>`。
 *
 * 为什么把 secret 指纹编进目录名，而不是另外维护一份 meta 文件：
 * 删掉自实现的crypto 后插件不再解密 `credentials.enc`，也就永远读不到里面的
 * secret，"磁盘上这份凭据是不是用当前配置签出来的"这个问题就无法回答。
 * 把指纹放进目录名后，secret 一变目录就变 → 天然没有凭据 → 自动重新授权，
 * 且走的是普通路径（不碰 force 熔断），所以**改配置立即生效**。
 *
 * 分隔符 `:` 是必需的：否则 `ab`+`c` 与 `a`+`bc` 会得到同一指纹。
 *
 * 已知取舍：`safeBotId` 的字符归一化可能碰撞（`a.b` 与 `a_b` 同名），
 * 清理兄弟目录时可能误删另一个 bot 的目录。代价仅是"那个 bot 下次调用
 * 重新授权一次"，不是数据丢失、更不是串号，因此接受。
 */
export function cliConfigDirFor(botId: string, secret: string): string {
  const fp = sha256Hex(`${botId}:${secret}`).slice(0, FINGERPRINT_LEN);
  return path.join(cliStateRoot(), `${safeBotId(botId)}-${fp}`);
}

/**
 * 短路判据：两个文件都在就认为已授权。
 *
 * 短路不是性能优化而是**必需项**：`auth init` 内部无任何幂等检查，
 * 每次调用都会打一次 `fetch_auth`，而该接口有 45009 频率超限。
 *
 * `.encryption_key` 的存在性同样要查：文件缺失但密文还在时，cli 会回退到
 * keyring 取密钥，而 keyring 可能被系统锁定/不可用 → 静默表现为"未授权"。
 */
function isAuthorized(dir: string): boolean {
  return fs.existsSync(credentialsPath(dir)) && fs.existsSync(keyPath(dir));
}

/**
 * 清理同一 bot 的旧 secret 目录。
 *
 * 时机必须是**授权成功之后**：反过来先清理，一旦授权失败就连旧凭据都没了，
 * 把"可降级"变成"直接不可用"。
 *
 * 双重约束防误删：父目录固定在 `<state>/wecom-cli/`，且名字必须严格匹配
 * `<safeBotId>-<8位hex>`。清理是卫生工作而非正确性前提，失败只 warn。
 */
function cleanupSiblings(botId: string, currentDir: string): void {
  const root = cliStateRoot();
  const prefix = safeBotId(botId);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const m = DIR_SHAPE.exec(entry.name);
    if (!m || m[1] !== prefix) continue;

    const full = path.join(root, entry.name);
    if (full === currentDir) continue;

    try {
      fs.rmSync(full, { recursive: true, force: true });
      console.log(`${CLI_LOG} 已清理旧凭据目录 ${entry.name}`);
    } catch (err) {
      console.warn(
        `${CLI_LOG} 清理旧凭据目录失败（不影响本次调用）${entry.name}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// ============================================================================
// auth init
// ============================================================================

/** 从 cli 的错误输出里提取 errcode，兼容两种形态 */
function extractErrcode(stdout: string): number | null {
  try {
    const parsed = JSON.parse(stdout) as { error?: { code?: number }; errcode?: number };
    // `{"error":{...}}` 是常规形态；裸 `{"errcode":...}` 来自 Transport::Api 的原样透传
    const code = parsed?.error?.code ?? parsed?.errcode;
    return typeof code === "number" ? code : null;
  } catch {
    return null;
  }
}

function extractMessage(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as { error?: { message?: string }; errmsg?: string };
    return parsed?.error?.message ?? parsed?.errmsg ?? null;
  } catch {
    return null;
  }
}

/**
 * `auth init` 全局串行（**跨 bot 也串**）。
 *
 * keyring 是全局资源，macOS Keychain 的并发写入行为不确定。
 * 授权频率极低（首次 + 重签），全局串行的代价可忽略，换来行为确定性。
 * 业务命令仍按 botId 串行，不受这里影响。
 */
let authChain: Promise<unknown> = Promise.resolve();

function serializeAuth<T>(task: () => Promise<T>): Promise<T> {
  const next = authChain.then(task, task);
  authChain = next.catch(() => undefined);
  return next;
}

/**
 * 执行非交互授权。
 *
 * 刻意**不复用** tool.ts 的 runCli：
 *   - runCli 会把 `argv.join(" ")` 打进日志，那样 secret 会被写进 openclaw
 *     日志文件并持久化/上报，比 `ps` 可见严重得多
 *   - 两者的错误分类逻辑也不同（这里 exit 2 意味着"cli 版本不支持"）
 *
 * 门禁提醒：cli 只在 **stderr 非 TTY** 时才走 `--bot-id/--secret` 直连分支，
 * 否则**静默忽略参数**并回退扫码。`stdio` 的 pipe 天然满足；
 * stdin 用 `ignore` 而非 pipe——万一走到交互分支，让它立刻拿到 EOF 而不是挂着等输入。
 */
function spawnAuthInit(
  binPath: string,
  botId: string,
  secret: string,
  dir: string,
  env: CliEnvOverrides,
): Promise<{ status: number | null; stdout: string; stderr: string; ms: number; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(binPath, ["auth", "init", "--bot-id", botId, "--secret", secret], {
      shell: false,
      cwd: resolveStateDir(),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        ...(process.platform === "win32"
          ? { USERPROFILE: process.env.USERPROFILE ?? "", SystemRoot: process.env.SystemRoot ?? "" }
          : {}),
        WECOM_CLI_CONFIG_DIR: dir,
        WECOM_CLI_LOG_LEVEL: "warn",
        // 端点与业务调用同源：授权和调用现在由同一个二进制、同一份 env 解析，
        // 不可能再出现"授权在测试环境、调用在生产"的错配
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout = new BoundedOutputCollector(CLI_MAX_OUTPUT_BYTES, "head");
    const stderr = new BoundedOutputCollector(CLI_MAX_OUTPUT_BYTES, "tail");
    let timedOut = false;
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    let forceWaitTimer: ReturnType<typeof setTimeout> | undefined;

    child.stdout.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.append(chunk));

    const clearTimers = () => {
      clearTimeout(killTimer);
      if (graceTimer) clearTimeout(graceTimer);
      if (forceWaitTimer) clearTimeout(forceWaitTimer);
    };

    const finish = (status: number | null) => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve({
        status,
        stdout: stdout.result().text,
        stderr: stderr.result().text,
        ms: Date.now() - started,
        timedOut,
      });
    };

    const killTimer = setTimeout(() => {
      timedOut = true;
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");

      graceTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");

        forceWaitTimer = setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          finish(child.exitCode);
        }, CLI_KILL_FORCE_WAIT_MS);
      }, CLI_KILL_GRACE_MS);
    }, CLI_AUTH_TIMEOUT_MS);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(err);
    });
    child.on("close", (status) => finish(status));
  });
}

async function runAuthInit(
  binPath: string,
  botId: string,
  secret: string,
  dir: string,
  env: CliEnvOverrides,
): Promise<void> {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const redact = (s: string) => (secret ? s.split(secret).join("***") : s);
  const shortBot = `${botId.slice(0, 10)}…`;
  console.log(
    `${CLI_LOG} 授权中 auth init --bot-id ${shortBot} --secret *** → ${path.basename(dir)}`,
  );

  const out = await spawnAuthInit(binPath, botId, secret, dir, env);

  if (out.timedOut) {
    throw new CliAuthError(
      `企业微信授权超时（${CLI_AUTH_TIMEOUT_MS / 1000}s）。` +
        "常见原因：网络不可达，或系统钥匙串（Keychain）弹出了授权确认而无人响应。",
    );
  }

  // exit 2 = clap 参数错误。插件依赖已锁定支持该能力的版本，所以这属于"不该发生"，
  // 通常说明二进制被外部替换（binPath 指向旧二进制 / 全局安装的 cli）
  if (out.status === 2) {
    throw new CliAuthError(
      "当前 wecom-cli 不支持非交互授权（缺少 --bot-id/--secret）。" +
        "插件已锁定支持该能力的版本，出现此错误通常说明二进制被外部替换——" +
        "请检查 `channels.wecom.cli.binPath` 是否指向了旧二进制或全局安装的 cli。",
    );
  }

  if (out.status !== 0) {
    // 错误在 stdout（cli 统一 `println!(err.render())`）；stderr 只有 cliclack 的
    // 进度装饰与 ANSI 控制符，塞进用户文案会污染，只在 stdout 为空时兜底
    const code = extractErrcode(out.stdout) ?? undefined;
    const detail =
      extractMessage(out.stdout) ??
      (out.stdout.trim() || out.stderr.trim() || `exit ${out.status}`).slice(0, 500);
    throw new CliAuthError(
      `企业微信授权失败：${redact(detail)}${code != null ? `（errcode=${code}）` : ""}。` +
        "请检查 openclaw 配置 `channels.wecom` 中的 botId / secret 是否正确。",
      code,
    );
  }

  // 防御性：exit 0 但文件没落地（例如 cli 未来改了目录语义）
  if (!isAuthorized(dir)) {
    throw new CliAuthError(
      `wecom-cli 授权返回成功，但 ${dir} 下未生成凭据文件。` +
        "可能是 cli 版本行为变更，请检查插件依赖的 @wecom/cli 版本。",
    );
  }

  console.log(`${CLI_LOG} 授权成功 botId=${shortBot} (${out.ms}ms)`);
  cleanupSiblings(botId, dir);
}

// ============================================================================
// ensureSynced
// ============================================================================

/** 进程内并发去重，key = 配置目录（含 secret 指纹，改secret 不会复用旧 inflight） */
const inflight = new Map<string, Promise<string>>();
/** 上次实际开始强制重签的时间，用于服务端频控保护 */
const lastResignAttempt = new Map<string, number>();
/** 上次强制重签成功的时间，仅用于区分尝试与成功的状态语义 */
const lastResignSucceeded = new Map<string, number>();

/**
 * 确保指定 bot 的登录态已就绪，返回其配置目录。
 *
 * @param force 强制重新授权（业务命令报凭据类错误时的兜底），受冷却熔断约束。
 *              注意 cli 没有 `--force` 参数，也不需要：`auth init` 本身无幂等，
 *              每次调用都会重新签发，所以"force"只是跳过插件自己的短路。
 */
export async function ensureSynced(params: {
  binPath: string;
  botId: string;
  secret: string;
  env?: CliEnvOverrides;
  force?: boolean;
}): Promise<string> {
  const { binPath, botId, secret, env = {}, force = false } = params;
  if (!botId?.trim() || !secret?.trim()) {
    throw new CliAuthError(
      "当前企业微信账号未配置 botId / secret，请检查 openclaw 配置 `channels.wecom`",
    );
  }

  const dir = cliConfigDirFor(botId, secret);

  if (!force && isAuthorized(dir)) return dir;

  // 普通授权与强制重签都按目录复用同一个进行中的任务，避免并发重复签发。
  const existing = inflight.get(dir);
  if (existing) return existing;

  // 授权本身全局串行；冷却时间在任务真正开始时记录，不把排队时间算作重签尝试。
  const task = serializeAuth(async () => {
    // 排队期间可能已被前一个任务授权好了（同目录并发），再查一次省一次鉴权请求
    if (!force && isAuthorized(dir)) return dir;

    let attemptAt: number | undefined;
    if (force) {
      const last = lastResignAttempt.get(dir) ?? 0;
      const elapsed = Date.now() - last;
      if (elapsed < CLI_RESIGN_COOLDOWN_MS) {
        const waitSec = Math.ceil((CLI_RESIGN_COOLDOWN_MS - elapsed) / 1000);
        const succeeded = (lastResignSucceeded.get(dir) ?? 0) >= last;
        const state = succeeded ? "凭据刚刚重新签发成功但仍然不可用" : "凭据刚刚尝试重新签发但未成功";
        throw new CliAuthError(
          `${state}，${waitSec} 秒内不再重试，` +
            `以避免触发企业微信换取凭据的频率限制（45009）。` +
            `请检查 openclaw 配置 \`channels.wecom\` 中的 botId / secret 是否正确。`,
        );
      }
      attemptAt = Date.now();
      lastResignAttempt.set(dir, attemptAt);
    }

    try {
      await runAuthInit(binPath, botId, secret, dir, env);
      if (force) lastResignSucceeded.set(dir, Date.now());
      return dir;
    } catch (err) {
      if (force) {
        console.warn(
          `${CLI_LOG} 强制重签失败，保留本次尝试的冷却保护 ` +
            `(attemptAt=${attemptAt ?? "unknown"}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      throw err;
    }
  }).finally(() => {
    if (inflight.get(dir) === task) inflight.delete(dir);
  });

  inflight.set(dir, task);
  return task;
}

/** 仅用于测试 */
export function resetCredentialState(): void {
  inflight.clear();
  lastResignAttempt.clear();
  lastResignSucceeded.clear();
  authChain = Promise.resolve();
}
