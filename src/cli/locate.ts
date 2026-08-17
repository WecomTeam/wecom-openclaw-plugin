/**
 * wecom-cli 二进制寻址
 *
 * 为什么不依赖 PATH：
 * 1. 插件私有的 node_modules/.bin 不在 PATH 上
 * 2. 更重要的是——PATH 上可能存在用户**全局安装**的 wecom-cli，
 *    它绑定的是用户自己的 bot（默认目录 ~/.config/wecom）。
 *    误用会导致"拿 A 企业的凭据查 B 企业的数据"，是静默的数据越权。
 *    因此这里只接受"插件依赖内的二进制"或"配置显式指定的路径"。
 */

import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { CLI_LOG } from "./const.js";

const require_ = createRequire(import.meta.url);

/**
 * npm 包名前缀候选。
 *
 * 联调期用内网包 `@tencent/wecom-cli`（discovery 分支、启用 custom-endpoint），
 * 正式发布用公开包 `@wecom/cli`。两者平台子包命名规则不同，故依次尝试。
 */
const PACKAGE_PREFIXES = ["@tencent/wecom-cli", "@wecom/cli"] as const;

/** node platform/arch → 平台子包后缀 */
function platformSuffix(): string | null {
  const { platform, arch } = process;
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "win32" && arch === "x64") return "win32-x64";
  return null;
}

function binName(): string {
  return process.platform === "win32" ? "wecom-cli.exe" : "wecom-cli";
}

/** 判断路径是否为可执行文件 */
function isExecutable(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false;
    if (process.platform !== "win32") fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** 从平台包根目录推断原生二进制位置 */
function binCandidatesFromPkgRoot(root: string): string[] {
  return [path.join(root, "bin", binName()), path.join(root, binName())];
}

/** 按主包 package.json 的 bin 声明解析 shim，兼容字符串和对象两种形式。 */
export function binCandidatesFromPackageManifest(root: string): string[] {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const values =
      typeof manifest.bin === "string"
        ? [manifest.bin]
        : manifest.bin && typeof manifest.bin === "object"
          ? [manifest.bin["wecom-cli"], ...Object.values(manifest.bin)]
          : [];

    const candidates: string[] = [];
    for (const value of values) {
      if (typeof value !== "string" || !value.trim()) continue;
      const candidate = path.resolve(root, value);
      const relative = path.relative(root, candidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
      if (!candidates.includes(candidate)) candidates.push(candidate);
    }
    return candidates;
  } catch {
    return [];
  }
}

export type LocateResult =
  | { ok: true; binPath: string; source: string }
  | { ok: false; tried: string[] };

let cached: LocateResult | null = null;

/** 已打印过寻址结果的 binPath，避免每次调用都刷日志 */
const logged = new Set<string>();

const EXPLICIT_SOURCE = "channels.wecom.cli.binPath";

/**
 * 打印一次寻址结果。
 *
 * 排查"是否误用了全局 cli"时，这是唯一的直接证据：
 * `source` 为npm 包名 → 命中插件依赖内的二进制（正确）；
 * `source` 为 binPath  → 来自配置逃生舱，需人工确认该路径不是全局安装。
 */
function logHit(binPath: string, source: string): void {
  if (logged.has(binPath)) return;
  logged.add(binPath);

  if (source === EXPLICIT_SOURCE) {
    console.warn(
      `${CLI_LOG} 二进制寻址命中 source=${source} path=${binPath} ` +
        "（来自配置显式指定，请确认它不是全局安装的 wecom-cli：" +
        "配置目录仍由插件按会话机器人注入，但版本可能与 skills 不匹配）",
    );
    return;
  }
  console.log(`${CLI_LOG} 二进制寻址命中 source=${source} path=${binPath}`);
}

/**
 * 定位 wecom-cli 二进制。
 *
 * 优先级：
 * 1. 配置显式指定 `channels.wecom.cli.binPath`（联调期塞本地 cargo 产物用）
 * 2. 平台子包 `<prefix>-<platform>-<arch>`（跳过 bin/wecom.js 那层 node shim，
 *    每次调用少一次 node 冷启动）
 * 3. 主包 `<prefix>` 自带的 bin
 */
export function locateCliBinary(explicitPath?: string): LocateResult {
  if (explicitPath?.trim()) {
    const p = path.resolve(explicitPath.trim());
    if (isExecutable(p)) {
      logHit(p, EXPLICIT_SOURCE);
      return { ok: true, binPath: p, source: EXPLICIT_SOURCE };
    }
    return { ok: false, tried: [`${p} (配置指定，但不存在或不可执行)`] };
  }

  if (cached?.ok) return cached;

  const tried: string[] = [];
  const suffix = platformSuffix();

  for (const prefix of PACKAGE_PREFIXES) {
    // 平台子包优先
    if (suffix) {
      const pkg = `${prefix}-${suffix}`;
      try {
        const root = path.dirname(require_.resolve(`${pkg}/package.json`));
        for (const c of binCandidatesFromPkgRoot(root)) {
          if (isExecutable(c)) {
            cached = { ok: true, binPath: c, source: pkg };
            logHit(c, pkg);
            return cached;
          }
          tried.push(c);
        }
      } catch {
        tried.push(`${pkg} (未安装)`);
      }
    }

    // 退化到主包：先从主包自身的依赖上下文找平台包（兼容 pnpm 严格布局），
    // 最后按 package.json.bin 运行主包 shim。
    try {
      const manifestPath = require_.resolve(`${prefix}/package.json`);
      const root = path.dirname(manifestPath);

      if (suffix) {
        const pkg = `${prefix}-${suffix}`;
        try {
          const requireFromMain = createRequire(manifestPath);
          const platformRoot = path.dirname(requireFromMain.resolve(`${pkg}/package.json`));
          for (const c of binCandidatesFromPkgRoot(platformRoot)) {
            if (isExecutable(c)) {
              cached = { ok: true, binPath: c, source: pkg };
              logHit(c, pkg);
              return cached;
            }
            tried.push(c);
          }
        } catch {
          tried.push(`${pkg} (主包依赖中未找到)`);
        }
      }

      const candidates = [
        ...binCandidatesFromPackageManifest(root),
        ...binCandidatesFromPkgRoot(root),
      ];
      for (const c of [...new Set(candidates)]) {
        if (isExecutable(c)) {
          cached = { ok: true, binPath: c, source: prefix };
          logHit(c, prefix);
          return cached;
        }
        tried.push(c);
      }
    } catch {
      tried.push(`${prefix} (未安装)`);
    }
  }

  const result: LocateResult = { ok: false, tried };
  console.warn(`${CLI_LOG} 未找到 wecom-cli 二进制，尝试过：\n  ${tried.join("\n  ")}`);
  return result;
}

/** 仅用于测试：清除寻址缓存 */
export function resetLocateCache(): void {
  cached = null;
  logged.clear();
}
