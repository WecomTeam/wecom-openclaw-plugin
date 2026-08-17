/**
 * wecom-cli — 把 @wecom/cli 包装成 openclaw tool
 *
 * 为什么包装成 tool 而不是让 agent 用 exec 直接跑：
 * 1. 企微会话常见的 `messaging` profile 里没有 exec 工具
 * 2. **更关键**：exec 无法可靠注入 per-bot 的 WECOM_CLI_CONFIG_DIR。
 *    模型漏带一次 env 就会落到默认目录，拿 A 企业的凭据调 B 企业的接口——
 *    这是数据越权，不是功能降级。tool 让配置目录完全由服务端决定。
 * 3. 插件私有 node_modules/.bin 不在 PATH，PATH 上反而可能是用户全局装的 cli
 */

import * as path from "node:path";
import { spawn } from "./process-launcher.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { getWeComRuntime } from "../runtime.js";
import { hasMultiAccounts, resolveWeComAccountMulti } from "../accounts.js";
import { resolveStateDir } from "../state-dir-resolve.js";
import {
  CLI_ENV_PASSTHROUGH,
  CLI_KILL_FORCE_WAIT_MS,
  CLI_KILL_GRACE_MS,
  CLI_LOG,
  CLI_MAX_OUTPUT_BYTES,
  CLI_RESIGN_CODES,
  CLI_TIMEOUT_MS,
  CLI_TOOL_NAME,
} from "./const.js";
import { CliArgvError, normalizeArgs } from "./argv.js";
import { CliAuthError, type CliEnvOverrides, ensureSynced } from "./credentials.js";
import { locateCliBinary } from "./locate.js";
import { BoundedOutputCollector } from "./process-output.js";

// ============================================================================
// 类型
// ============================================================================

export interface CreateWeComCliToolOptions {
  /** 当前会话对应的账号 ID（来自 ctx.agentAccountId） */
  accountId?: string;
}

interface CliParams {
  args: string | string[];
}

type SpawnOutcome = {
  status: number | null;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stdoutTruncated: boolean;
  ms: number;
  timedOut: boolean;
};

/** cli 的结构化业务错误（exit 1 时输出到 stdout） */
type CliErrorPayload = {
  error?: { type?: string; code?: number; message?: string; endpoint?: string; status?: number };
};

// ============================================================================
// 响应构造
// ============================================================================

const textResult = (data: unknown) => {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text" as const, text }], details: data };
};

const errorResult = (message: string, extra?: Record<string, unknown>) =>
  textResult({ error: message, ...extra });

// ============================================================================
// 账号解析
// ============================================================================

type ResolvedBot = { botId: string; secret: string; accountId: string; env: CliEnvOverrides };

/**
 * 解析当前会话对应的 bot 凭据。
 *
 * ⚠️刻意**不继承** resolveCurrentAccountId() 的"回退默认账号"行为：
 * 多账号场景下上下文丢失时回退，等于拿 A 企业的凭据调 B 企业的接口。
 * 宁可失败也不能串号—— 只有单账号模式才允许回退。
 */
function resolveBot(accountId: string | undefined): ResolvedBot {
  let cfg: OpenClawConfig;
  try {
    cfg = getWeComRuntime().config.loadConfig();
  } catch {
    throw new CliAuthError("插件运行时未初始化，无法读取 openclaw 配置");
  }

  const multi = hasMultiAccounts(cfg);
  const id = accountId?.trim();

  if (!id && multi) {
    throw new CliAuthError(
      "当前会话缺少账号上下文（agentAccountId），而配置中存在多个企业微信账号。" +
        "为避免误用其他企业的凭据，本次调用已被拒绝。请在有明确会话上下文的场景下使用。",
    );
  }

  const resolved = resolveWeComAccountMulti({ cfg, accountId: id ?? null });
  const botId = resolved.botId?.trim();
  const secret = resolved.secret?.trim();

  if (!botId || !secret) {
    throw new CliAuthError(
      `企业微信账号 "${resolved.accountId}" 未配置 botId / secret，` +
        "请检查 openclaw 配置 `channels.wecom`",
    );
  }

  // 端点覆盖（仅联调用；在未启用 custom-endpoint feature 的正式包上不生效）
  const rawCliCfg = (resolved.config as Record<string, unknown> | undefined)?.cli as
    | { binPath?: string; env?: Record<string, string> }
    | undefined;
  const env: CliEnvOverrides = {};
  for (const key of CLI_ENV_PASSTHROUGH) {
    const v = rawCliCfg?.env?.[key];
    if (typeof v === "string" && v.trim()) env[key] = v.trim();
  }

  return { botId, secret, accountId: resolved.accountId, env };
}

function resolveBinPath(accountId: string | undefined): { binPath: string; source: string } {
  let explicit: string | undefined;
  try {
    const cfg = getWeComRuntime().config.loadConfig();
    const resolved = resolveWeComAccountMulti({ cfg, accountId: accountId ?? null });
    explicit = ((resolved.config as Record<string, unknown> | undefined)?.cli as
      | { binPath?: string }
      | undefined)?.binPath;
  } catch {
    /* 配置不可读时走默认寻址 */
  }

  const located = locateCliBinary(explicit);
  if (located.ok) return { binPath: located.binPath, source: located.source };

  throw new CliAuthError(
    "未找到 wecom-cli 可执行文件，插件安装可能不完整。\n" +
      `尝试过的位置：\n  ${located.tried.join("\n  ")}\n` +
      "可通过 openclaw 配置 `channels.wecom.cli.binPath` 显式指定二进制路径。",
  );
}

// ============================================================================
// spawn（按 botId 串行化）
// ============================================================================

/**
 * 同一 botId 的调用串行执行。
 *
 * 原因：cli 的 refresh_lock 只是**进程内**锁，credentials.enc 虽然是原子写但
 * 没有跨进程文件锁。并发进程同时遇到 853004 会各自去换token（可能撞 45009）
 * 并互相覆盖。企微场景 QPS 极低，串行化几乎无感知。
 */
const queues = new Map<string, Promise<unknown>>();

function serialize<T>(botId: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(botId) ?? Promise.resolve();
  const next = prev.then(task, task);
  queues.set(
    botId,
    next.catch(() => undefined),
  );
  return next;
}

function runCli(binPath: string, argv: string[], configDir: string, env: CliEnvOverrides): Promise<SpawnOutcome> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(binPath, argv, {
      shell: false,
      // cwd 固定到 state 目录：cli 启动时会读cwd 下的 .env，避免被无关目录污染；
      // 同时 cli 用 cwd 解析相对路径，因此 skills 中一律要求绝对路径
      cwd: resolveStateDir(),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        ...(process.platform === "win32"
          ? { USERPROFILE: process.env.USERPROFILE ?? "", SystemRoot: process.env.SystemRoot ?? "" }
          : {}),
        WECOM_CLI_CONFIG_DIR: configDir,
        // 压掉 cli 的 info/debug 噪音，避免 stderr 淹没真实错误
        WECOM_CLI_LOG_LEVEL: "warn",
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
      const stdoutResult = stdout.result();
      resolve({
        status,
        stdout: stdoutResult.text,
        stderr: stderr.result().text,
        stdoutBytes: stdoutResult.originalBytes,
        stdoutTruncated: stdoutResult.truncated,
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
    }, CLI_TIMEOUT_MS);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(err);
    });
    child.on("close", (status) => finish(status));
  });
}

// ============================================================================
// 结果分类
// ============================================================================

function parseErrorPayload(stdout: string): CliErrorPayload["error"] | null {
  try {
    const parsed = JSON.parse(stdout) as CliErrorPayload;
    return parsed?.error ?? null;
  } catch {
    return null;
  }
}

/** 从 cli 的裸企微响应里提取 errcode（如 token 过期时会直接透出 {errcode,errmsg}） */
function parseErrcode(stdout: string): number | null {
  try {
    const parsed = JSON.parse(stdout) as { errcode?: number };
    return typeof parsed?.errcode === "number" ? parsed.errcode : null;
  } catch {
    return null;
  }
}

/**
 * 改写 cli 的错误文案。
 *
 * cli 会提示用户去跑 `wecom auth init`，但手工执行会绕过 openclaw 配置、
 * 把凭据写到默认目录（而本会话读的是插件按 botId+secret 分配的目录），
 * 且需要用户自己拿到 secret。凭据由插件统一管理，必须改写为引导改配置。
 */
function rewriteMessage(message: string): string {
  if (/auth\s+init/i.test(message)) {
    return "企业微信凭据不可用。请检查 openclaw 配置 `channels.wecom` 中的 botId / secret（请勿手动执行 wecom-cli auth init，凭据由插件统一管理）。";
  }
  return message;
}

// ============================================================================
// 工具定义
// ============================================================================

const DESCRIPTION = [
  "执行企业微信命令行（wecom-cli），用于访问通讯录、文档、会议、日程、待办、智能表格等企业微信能力。",
  "",
  "参数 `args` 是命令行中 `wecom-cli ` 之后的字符串数组。",
  "例如：[\"contact\",\"users\",\"search\",\"--json\",\"{\\\"keywords\\\":[\\\"张三\\\"]}\"]",
  "参数值本身含引号、空格或特殊字符时，仍作为一个完整数组元素传入。",
  "",
  "重要约束：",
  "  - 相关 skill 文档中给出的命令，一律通过本 tool 执行；",
  "    **禁止**使用 exec / bash / shell / npx 或全局命令直接运行 wecom-cli，那会绕过当前会话的企业凭据隔离。",
  "  - 本 tool 内部自行寻址并启动 wecom-cli 二进制是正常实现；禁止的是 Agent 主动改用通用执行工具。",
  "  - 本 tool 调用失败、不可见、权限不足或提示授权时，不得降级到 exec，也不得手动执行 auth init；应直接报告工具权限或 `channels.wecom` 配置问题。",
  "  - 不要在 args 中写 `wecom-cli` 前缀，也不要拼接 shell 命令（管道、重定向、&& 等）。",
  "  - 不要传入任何 WECOM_CLI_* 环境变量或 --config-dir：运行环境由插件按当前会话的机器人自动注入。",
  "  - 涉及本地文件的参数请使用绝对路径。",
  "  - 想了解某个方法的参数结构时，可在命令末尾加 `--schema` 或 `--doc`。",
].join("\n");

export function prepareCliArguments(params: unknown): unknown {
  if (!params || typeof params !== "object" || Array.isArray(params)) return params;

  const value = params as Record<string, unknown>;
  if (typeof value.args !== "string") return params;

  return { ...value, args: normalizeArgs(value.args) };
}

export function createWeComCliTool(options: CreateWeComCliToolOptions = {}) {
  const accountId = options.accountId?.trim() || undefined;

  return {
    name: CLI_TOOL_NAME,
    label: "企业微信命令行",
    description: DESCRIPTION,
    parameters: {
      type: "object" as const,
      properties: {
        args: {
          type: "array" as const,
          items: { type: "string" as const },
          description:
            "命令行中 `wecom-cli ` 之后的字符串数组，" +
            "例如 [\"contact\",\"users\",\"search\",\"--json\",\"{\\\"keywords\\\":[\\\"张三\\\"]}\"]",
        },
      },
      required: ["args"],
      additionalProperties: false,
    },
    prepareArguments: prepareCliArguments,

    async execute(_toolCallId: string, params: unknown) {
      const raw = (params as CliParams)?.args;

      // 1. 入参归一化 + 安全校验
      let argv: string[];
      try {
        argv = normalizeArgs(raw);
      } catch (err) {
        if (err instanceof CliArgvError) return errorResult(err.message);
        throw err;
      }

      // 2. 解析当前会话的 bot 与二进制
      let bot: ResolvedBot;
      let binPath: string;
      let binSource: string;
      try {
        bot = resolveBot(accountId);
        ({ binPath, source: binSource } = resolveBinPath(accountId));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const cmdForLog = argv.join(" ");

      return serialize(bot.botId, async () => {
        const attempt = async (force: boolean): Promise<SpawnOutcome> => {
          const dir = await ensureSynced({
            binPath,
            botId: bot.botId,
            secret: bot.secret,
            env: bot.env,
            force,
          });
          return runCli(binPath, argv, dir, bot.env);
        };

        try {
          let out = await attempt(false);

          // 3. 凭据类错误 → 强制重签一次后重试（受 5 分钟熔断约束）
          //必要性：cli 的 853004 自动刷新在当前版本会因缺少请求头被 48002 拒绝，
          //    插件不能完全依赖 cli 自愈。
          const code = parseErrorPayload(out.stdout)?.code ?? parseErrcode(out.stdout);
          if (out.status !== 0 && code != null && CLI_RESIGN_CODES.has(code)) {
            console.warn(`${CLI_LOG} 凭据失效 (code=${code})，强制重签后重试：${cmdForLog}`);
            try {
              out = await attempt(true);
            } catch (err) {
              if (err instanceof CliAuthError) return errorResult(err.message, { errcode: err.errcode });
              throw err;
            }
          }

          // 4. 结果整理
          if (out.timedOut) {
            return errorResult(
              `命令执行超时（${CLI_TIMEOUT_MS / 1000}s）：wecom-cli ${cmdForLog}`,
              { stderr: out.stderr.slice(-2048) || undefined },
            );
          }

          // exit2 = clap 参数/子命令错误，错误文本在 stderr，且常意味着 skills 与 cli 版本不匹配
          if (out.status === 2) {
            console.warn(`${CLI_LOG} 命令不存在或参数非法 (exit 2) via=${binSource}：${cmdForLog}`);
            return errorResult(
              `命令不存在或参数非法：wecom-cli ${cmdForLog}\n${out.stderr.trim().slice(0, 1500)}`,
              { hint: "该命令在当前 wecom-cli 版本中不可用，技能文档可能与 CLI 版本不一致。可用 `--help` 查看可用子命令。" },
            );
          }

          const errPayload = parseErrorPayload(out.stdout);
          if (out.status !== 0 || errPayload) {
            const message = rewriteMessage(
              errPayload?.message ?? (out.stderr.trim() || `命令执行失败（exit ${out.status}）`),
            );
            console.warn(
              `${CLI_LOG} 调用失败 (${out.ms}ms, exit=${out.status}) ${cmdForLog} → ` +
                JSON.stringify(errPayload ?? out.stderr.slice(-500)),
            );
            return errorResult(message, {
              errcode: errPayload?.code,
              endpoint: errPayload?.endpoint,
              httpStatus: errPayload?.status,
            });
          }

          const text = out.stdout.trim();
          console.log(
            `${CLI_LOG} ok (${out.ms}ms, ${out.stdoutBytes}B${out.stdoutTruncated ? " 已截断" : ""}) ` +
              `via=${binSource} ${cmdForLog}`,
          );

          if (out.stdoutTruncated) {
            return textResult(
              `${text}\n\n[输出过大已截断：原始 ${out.stdoutBytes} 字节，上限 ${CLI_MAX_OUTPUT_BYTES} 字节。` +
                "请缩小查询范围（例如使用更精确的关键词、加上分页或筛选参数）后重试。]",
            );
          }
          return textResult(text);
        } catch (err) {
          if (err instanceof CliAuthError) return errorResult(err.message, { errcode: err.errcode });

          const e = err as NodeJS.ErrnoException;
          if (e?.code === "ENOENT") {
            return errorResult(
              `wecom-cli 可执行文件不存在：${binPath}。插件安装可能不完整，请重新安装，` +
                "或通过 `channels.wecom.cli.binPath` 指定路径。",
            );
          }
          if (e?.code === "EACCES") {
            return errorResult(
              `wecom-cli 没有执行权限：${binPath}。请执行 chmod +x 或重新安装插件。`,
            );
          }
          console.error(`${CLI_LOG} 异常 ${cmdForLog} → ${e?.message ?? String(err)}`);
          return errorResult(e?.message ?? String(err));
        }
      });
    },
  };
}

/** 仅用于测试 */
export function resetCliToolState(): void {
  queues.clear();
}

export { path as _path };
