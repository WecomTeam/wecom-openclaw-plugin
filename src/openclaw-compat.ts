/**
 * openclaw plugin-sdk 高版本方法兼容层
 *
 * 部分方法（如 loadOutboundMediaFromUrl、detectMime、getDefaultMediaLocalRoots）
 * 仅在较新版本的 openclaw plugin-sdk 中才导出。
 *
 * 本模块在加载时一次性探测 SDK 导出，存在则直接 re-export SDK 版本，
 * 不存在则导出 fallback 实现。其他模块统一从本文件导入，无需关心底层兼容细节。
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

// ============================================================================
// 类型定义
// ============================================================================

/** 与 openclaw plugin-sdk 中 WebMediaResult 兼容的类型 */
export type WebMediaResult = {
  buffer: Buffer;
  contentType?: string;
  kind?: string;
  fileName?: string;
};

export type OutboundMediaLoadOptions = {
  maxBytes?: number;
  mediaLocalRoots?: readonly string[];
};

export type DetectMimeOptions = {
  buffer?: Buffer;
  headerMime?: string | null;
  filePath?: string;
};

// ============================================================================
// SDK 一次性探测（模块加载时执行，结果缓存）
// ============================================================================

interface SdkExports {
  loadOutboundMediaFromUrl?: (url: string, opts?: OutboundMediaLoadOptions) => Promise<WebMediaResult>;
  detectMime?: (opts: DetectMimeOptions) => Promise<string | undefined>;
  getDefaultMediaLocalRoots?: () => readonly string[];
}

const _sdkReady: Promise<SdkExports> = import("openclaw/plugin-sdk")
  .then((sdk) => {
    const exports: SdkExports = {};
    const maybeSdk = sdk as Record<string, unknown>;
    if (typeof maybeSdk.loadOutboundMediaFromUrl === "function") {
      exports.loadOutboundMediaFromUrl = maybeSdk.loadOutboundMediaFromUrl as SdkExports["loadOutboundMediaFromUrl"];
    }
    if (typeof maybeSdk.detectMime === "function") {
      exports.detectMime = maybeSdk.detectMime as SdkExports["detectMime"];
    }
    if (typeof maybeSdk.getDefaultMediaLocalRoots === "function") {
      exports.getDefaultMediaLocalRoots = maybeSdk.getDefaultMediaLocalRoots as SdkExports["getDefaultMediaLocalRoots"];
    }
    return exports;
  })
  .catch(() => {
    // openclaw/plugin-sdk 不可用或版本过低，全部使用 fallback
    return {} as SdkExports;
  });

// ============================================================================
// detectMime —— 检测 MIME 类型
// ============================================================================

const MIME_BY_EXT: Record<string, string> = {
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/x-m4a",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar",
  ".doc": "application/msword",
  ".xls": "application/vnd.ms-excel",
  ".ppt": "application/vnd.ms-powerpoint",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".amr": "audio/amr",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

/** 通过 buffer 魔术字节嗅探 MIME 类型（动态导入 file-type，不强依赖） */
async function sniffMimeFromBuffer(buffer: Buffer): Promise<string | undefined> {
  try {
    const { fileTypeFromBuffer } = await import("file-type");
    const type = await fileTypeFromBuffer(buffer);
    return type?.mime ?? undefined;
  } catch {
    return undefined;
  }
}

/** fallback 版 detectMime，参考 weclaw/src/media/mime.ts */
async function detectMimeFallback(opts: DetectMimeOptions): Promise<string | undefined> {
  const ext = opts.filePath ? path.extname(opts.filePath).toLowerCase() : undefined;
  const extMime = ext ? MIME_BY_EXT[ext] : undefined;

  const sniffed = opts.buffer ? await sniffMimeFromBuffer(opts.buffer) : undefined;

  const isGeneric = (m?: string) =>
    !m || m === "application/octet-stream" || m === "application/zip";

  if (sniffed && (!isGeneric(sniffed) || !extMime)) {
    return sniffed;
  }
  if (extMime) {
    return extMime;
  }
  const headerMime = opts.headerMime?.split(";")?.[0]?.trim().toLowerCase();
  if (headerMime && !isGeneric(headerMime)) {
    return headerMime;
  }
  if (sniffed) {
    return sniffed;
  }
  if (headerMime) {
    return headerMime;
  }
  return undefined;
}

/**
 * 检测 MIME 类型（兼容入口）
 *
 * 支持两种调用签名以兼容不同使用场景：
 * - detectMime(buffer)           → 旧式调用
 * - detectMime({ buffer, headerMime, filePath }) → 完整参数
 *
 * 优先使用 SDK 版本，不可用时使用 fallback。
 */
export async function detectMime(
  bufferOrOpts: Buffer | DetectMimeOptions,
): Promise<string | undefined> {
  const sdk = await _sdkReady;

  const opts: DetectMimeOptions = Buffer.isBuffer(bufferOrOpts)
    ? { buffer: bufferOrOpts }
    : bufferOrOpts;

  if (sdk.detectMime) {
    try {
      return await sdk.detectMime(opts);
    } catch {
      // SDK detectMime 异常，降级到 fallback
    }
  }
  return detectMimeFallback(opts);
}

// ============================================================================
// loadOutboundMediaFromUrl —— 从 URL/路径加载媒体文件
// ============================================================================

/** 安全的本地文件路径校验，参考 weclaw/src/web/media.ts */
async function assertLocalMediaAllowed(
  mediaPath: string,
  localRoots: readonly string[] | undefined,
): Promise<void> {
  if (!localRoots || localRoots.length === 0) {
    throw new Error(`Local media path is not under an allowed directory: ${mediaPath}`);
  }

  let resolved: string;
  try {
    resolved = await fs.realpath(mediaPath);
  } catch {
    resolved = path.resolve(mediaPath);
  }

  for (const root of localRoots) {
    let resolvedRoot: string;
    try {
      resolvedRoot = await fs.realpath(root);
    } catch {
      resolvedRoot = path.resolve(root);
    }
    if (resolvedRoot === path.parse(resolvedRoot).root) {
      continue;
    }
    if (resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)) {
      return;
    }
  }

  throw new Error(`Local media path is not under an allowed directory: ${mediaPath}`);
}

/** 从远程 URL 获取媒体 */
async function fetchRemoteMedia(
  url: string,
  maxBytes?: number,
): Promise<{ buffer: Buffer; contentType?: string; fileName?: string }> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to fetch media from ${url}: HTTP ${res.status} ${res.statusText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (maxBytes && buffer.length > maxBytes) {
    throw new Error(`Media from ${url} exceeds max size (${buffer.length} > ${maxBytes})`);
  }

  const headerMime = res.headers.get("content-type")?.split(";")?.[0]?.trim();

  let fileName: string | undefined;
  const disposition = res.headers.get("content-disposition");
  if (disposition) {
    const match = /filename\*?\s*=\s*(?:UTF-8''|")?([^";]+)/i.exec(disposition);
    if (match?.[1]) {
      try {
        fileName = path.basename(decodeURIComponent(match[1].replace(/["']/g, "").trim()));
      } catch {
        fileName = path.basename(match[1].replace(/["']/g, "").trim());
      }
    }
  }
  if (!fileName) {
    try {
      const parsed = new URL(url);
      const base = path.basename(parsed.pathname);
      if (base && base.includes(".")) fileName = base;
    } catch { /* ignore */ }
  }

  const contentType = await detectMimeFallback({ buffer, headerMime, filePath: fileName ?? url });

  return { buffer, contentType, fileName };
}

/** 展开 ~ 为用户主目录 */
function resolveUserPath(p: string): string {
  if (p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/** fallback 版 loadOutboundMediaFromUrl，参考 weclaw/src/web/media.ts */
async function loadOutboundMediaFromUrlFallback(
  mediaUrl: string,
  options: OutboundMediaLoadOptions = {},
): Promise<WebMediaResult> {
  const { maxBytes, mediaLocalRoots } = options;

  // 去除 MEDIA: 前缀
  mediaUrl = mediaUrl.replace(/^\s*MEDIA\s*:\s*/i, "");

  // 处理 file:// URL
  if (mediaUrl.startsWith("file://")) {
    try {
      mediaUrl = fileURLToPath(mediaUrl);
    } catch {
      throw new Error(`Invalid file:// URL: ${mediaUrl}`);
    }
  }

  // 远程 URL
  if (/^https?:\/\//i.test(mediaUrl)) {
    const fetched = await fetchRemoteMedia(mediaUrl, maxBytes);
    return {
      buffer: fetched.buffer,
      contentType: fetched.contentType,
      fileName: fetched.fileName,
    };
  }

  // 展开 ~ 路径
  if (mediaUrl.startsWith("~")) {
    mediaUrl = resolveUserPath(mediaUrl);
  }

  // 本地文件：安全校验
  await assertLocalMediaAllowed(mediaUrl, mediaLocalRoots);

  // 读取本地文件
  let data: Buffer;
  try {
    const stat = await fs.stat(mediaUrl);
    if (!stat.isFile()) {
      throw new Error(`Local media path is not a file: ${mediaUrl}`);
    }
    data = await fs.readFile(mediaUrl);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(`Local media file not found: ${mediaUrl}`);
    }
    throw err;
  }

  if (maxBytes && data.length > maxBytes) {
    throw new Error(`Local media exceeds max size (${data.length} > ${maxBytes})`);
  }

  const mime = await detectMimeFallback({ buffer: data, filePath: mediaUrl });
  const fileName = path.basename(mediaUrl) || undefined;

  return {
    buffer: data,
    contentType: mime,
    fileName,
  };
}

/**
 * 从 URL 或本地路径加载媒体文件（兼容入口）
 *
 * 优先使用 SDK 版本，不可用时使用 fallback。
 * SDK 版本抛出的业务异常（如 LocalMediaAccessError）会直接透传。
 */
export async function loadOutboundMediaFromUrl(
  mediaUrl: string,
  options: OutboundMediaLoadOptions = {},
): Promise<WebMediaResult> {
  const sdk = await _sdkReady;

  if (sdk.loadOutboundMediaFromUrl) {
    return sdk.loadOutboundMediaFromUrl(mediaUrl, options);
  }
  return loadOutboundMediaFromUrlFallback(mediaUrl, options);
}

// ============================================================================
// getDefaultMediaLocalRoots —— 获取默认媒体本地路径白名单
// ============================================================================

/** 解析 openclaw 状态目录 */
function resolveStateDir(): string {
  const stateOverride = process.env.OPENCLAW_STATE_DIR?.trim() || process.env.CLAWDBOT_STATE_DIR?.trim();
  if (stateOverride) return stateOverride;
  return path.join(os.homedir(), ".openclaw");
}

/**
 * 获取默认媒体本地路径白名单（兼容入口）
 *
 * 优先使用 SDK 版本，不可用时手动构建白名单（与 weclaw/src/media/local-roots.ts 逻辑一致）。
 */
export async function getDefaultMediaLocalRoots(): Promise<readonly string[]> {
  const sdk = await _sdkReady;

  if (sdk.getDefaultMediaLocalRoots) {
    try {
      return sdk.getDefaultMediaLocalRoots();
    } catch {
      // SDK 版本异常，降级到 fallback
    }
  }

  // fallback: 手动构建默认白名单
  const stateDir = path.resolve(resolveStateDir());
  return [
    path.join(stateDir, "media"),
    path.join(stateDir, "agents"),
    path.join(stateDir, "workspace"),
    path.join(stateDir, "sandboxes"),
  ];
}
