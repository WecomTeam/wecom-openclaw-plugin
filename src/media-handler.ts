/**
 * 企业微信媒体（图片）下载和保存模块
 *
 * 负责下载、检测格式、保存图片到本地，包含超时保护
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import type { WSClient } from "@wecom/aibot-node-sdk";
import { decryptFile } from "@wecom/aibot-node-sdk";
import { fileTypeFromBuffer } from "file-type";
import { getWeComRuntime } from "./runtime.js";
import { IMAGE_DOWNLOAD_TIMEOUT_MS, FILE_DOWNLOAD_TIMEOUT_MS, DEFAULT_MEDIA_MAX_MB } from "./const.js";
import { withTimeout } from "./timeout.js";
import type { ResolvedWeComAccount } from "./utils.js";

// ============================================================================
// 媒体超限错误
// ============================================================================

/**
 * 附件超过 OpenClaw 配置的 `agents.defaults.mediaMaxMb` 上限时抛出。
 *
 * 本错误由插件层主动判定并抛出，不依赖 OpenClaw 核心层错误消息的字符串匹配，
 * 上层（monitor）可通过 `instanceof MediaOversizeError` 精确识别并向用户提示。
 */
export class MediaOversizeError extends Error {
  readonly kind: "image" | "file";
  readonly filename?: string;
  readonly sizeBytes: number;
  readonly maxBytes: number;

  constructor(params: {
    kind: "image" | "file";
    filename?: string;
    sizeBytes: number;
    maxBytes: number;
  }) {
    super(
      `Media oversize: kind=${params.kind}, size=${params.sizeBytes}, max=${params.maxBytes}` +
        (params.filename ? `, filename=${params.filename}` : ""),
    );
    this.name = "MediaOversizeError";
    this.kind = params.kind;
    this.filename = params.filename;
    this.sizeBytes = params.sizeBytes;
    this.maxBytes = params.maxBytes;
  }
}

// ============================================================================
// 图片格式检测辅助函数（基于 file-type 包）
// ============================================================================

/**
 * 检查 Buffer 是否为有效的图片格式
 */
async function isImageBuffer(data: Buffer): Promise<boolean> {
  const type = await fileTypeFromBuffer(data);
  return type?.mime.startsWith("image/") ?? false;
}

/**
 * 检测 Buffer 的图片内容类型
 */
async function detectImageContentType(data: Buffer): Promise<string> {
  const type = await fileTypeFromBuffer(data);
  if (type?.mime.startsWith("image/")) {
    return type.mime;
  }
  return "application/octet-stream";
}

/**
 * fallback 路径专用：当回退到 `fetchRemoteMedia` 时，这条路径只做 HTTP fetch，
 * 不感知消息上下文中的 `aesKey`，落盘字节仍是 AES-CBC 密文。本辅助函数补上
 * 解密步骤，保证下游 magic-byte 嗅探与 MIME 推断能拿到真实文件内容。
 *
 * 解密失败时（极少数 — 例如服务端真给了明文）退回原 buffer，由调用方自行决定。
 */
function tryDecryptWithAesKey(
  buffer: Buffer,
  aesKey: string | undefined,
  runtime: RuntimeEnv,
): Buffer {
  if (!aesKey) return buffer;
  try {
    const decrypted = decryptFile(buffer, aesKey);
    runtime.log?.(
      `[wecom] Fallback decrypt OK: ${buffer.length} -> ${decrypted.length} bytes`,
    );
    return decrypted;
  } catch (e) {
    runtime.log?.(`[wecom] Fallback decrypt failed, keep raw: ${String(e)}`);
    return buffer;
  }
}

// ============================================================================
// 图片下载和保存
// ============================================================================

/**
 * 下载并保存所有图片到本地，每张图片的下载带超时保护
 */
export async function downloadAndSaveImages(params: {
  imageUrls: string[];
  imageAesKeys?: Map<string, string>;
  account: ResolvedWeComAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  wsClient: WSClient;
}): Promise<Array<{ path: string; contentType?: string }>> {
  const { imageUrls, config, runtime, wsClient } = params;
  const core = getWeComRuntime();
  const mediaList: Array<{ path: string; contentType?: string }> = [];

  for (const imageUrl of imageUrls) {
    try {
      runtime.log?.(`[wecom] Downloading image: url=${imageUrl}`);
      const mediaMaxMb = config.agents?.defaults?.mediaMaxMb ?? DEFAULT_MEDIA_MAX_MB;
      const maxBytes = mediaMaxMb * 1024 * 1024;

      let imageBuffer: Buffer;
      let imageContentType: string;
      let originalFilename: string | undefined;
      const imageAesKey = params.imageAesKeys?.get(imageUrl);

      try {
        // 优先使用 SDK 的 downloadFile 方法下载（带超时保护）
        const result = await withTimeout(
          wsClient.downloadFile(imageUrl, imageAesKey),
          IMAGE_DOWNLOAD_TIMEOUT_MS,
          `Image download timed out: ${imageUrl}`,
        );
        imageBuffer = result.buffer;
        originalFilename = result.filename;
        imageContentType = await detectImageContentType(imageBuffer);
        runtime.log?.(`[wecom] Image downloaded: size=${imageBuffer.length}, contentType=${imageContentType}, filename=${originalFilename ?? '(none)'}`);
      } catch (sdkError) {
        // 如果 SDK 方法失败，回退到原有方式（带超时保护）
        runtime.log?.(`[wecom] SDK download failed, fallback: ${String(sdkError)}`);
        const fetched = await withTimeout(
          core.channel.media.fetchRemoteMedia({ url: imageUrl }),
          IMAGE_DOWNLOAD_TIMEOUT_MS,
          `Manual image download timed out: ${imageUrl}`,
        ) as { buffer: Buffer; contentType?: string };
        runtime.log?.(`[wecom] Image fetched: contentType=${fetched.contentType}, size=${fetched.buffer.length}`);

        // fix: `fetchRemoteMedia` 仅做 HTTP fetch，不解密 AES-CBC，
        // 直接落盘会导致 fileTypeFromBuffer 嗅探失败 → contentType 退化为
        // application/octet-stream → 文件名缺扩展 → 下游 image 工具报
        // "Unsupported media type: undefined"。此处补解密。
        imageBuffer = tryDecryptWithAesKey(fetched.buffer, imageAesKey, runtime);
        imageContentType = await detectImageContentType(imageBuffer);
        const isValidImage = await isImageBuffer(imageBuffer);

        if (!isValidImage) {
          runtime.log?.(`[wecom] WARN: Downloaded data is not a valid image format`);
        }
      }

      // 大小校验由插件层主动进行，超限抛出 MediaOversizeError，由 monitor 统一提示用户。
      // 不再把 maxBytes 传给核心层 saveMediaBuffer，避免重复校验产生无结构化错误。
      if (imageBuffer.length > maxBytes) {
        throw new MediaOversizeError({
          kind: "image",
          filename: originalFilename,
          sizeBytes: imageBuffer.length,
          maxBytes,
        });
      }

      const saved = await core.channel.media.saveMediaBuffer(
        imageBuffer,
        imageContentType,
        "inbound",
        maxBytes,
        originalFilename,
      );
      mediaList.push({ path: saved.path, contentType: saved.contentType });
      runtime.log?.(`[wecom][plugin] Image saved: path=${saved.path}, contentType=${saved.contentType}`);
    } catch (err) {
      // 媒体超限错误需要上抛给 monitor，用于向用户发送明确的提示文案。
      if (err instanceof MediaOversizeError) {
        throw err;
      }
      runtime.error?.(`[wecom] Failed to download image: ${String(err)}`);
    }
  }

  return mediaList;
}

/**
 * 下载并保存所有文件到本地，每个文件的下载带超时保护
 */
export async function downloadAndSaveFiles(params: {
  fileUrls: string[];
  fileAesKeys?: Map<string, string>;
  account: ResolvedWeComAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  wsClient: WSClient;
}): Promise<Array<{ path: string; contentType?: string }>> {
  const { fileUrls, config, runtime, wsClient } = params;
  const core = getWeComRuntime();
  const mediaList: Array<{ path: string; contentType?: string }> = [];

  for (const fileUrl of fileUrls) {
    try {
      runtime.log?.(`[wecom] Downloading file: url=${fileUrl}`);
      const mediaMaxMb = config.agents?.defaults?.mediaMaxMb ?? DEFAULT_MEDIA_MAX_MB;
      const maxBytes = mediaMaxMb * 1024 * 1024;

      let fileBuffer: Buffer;
      let fileContentType: string;
      let originalFilename: string | undefined;
      const fileAesKey = params.fileAesKeys?.get(fileUrl);

      try {
        // 使用 SDK 的 downloadFile 方法下载（带超时保护）
        const result = await withTimeout(
          wsClient.downloadFile(fileUrl, fileAesKey),
          FILE_DOWNLOAD_TIMEOUT_MS,
          `File download timed out: ${fileUrl}`,
        );
        fileBuffer = result.buffer;
        originalFilename = result.filename;

        // 检测文件类型
        const type = await fileTypeFromBuffer(fileBuffer);
        fileContentType = type?.mime ?? "application/octet-stream";
        runtime.log?.(`[wecom] File downloaded: size=${fileBuffer.length}, contentType=${fileContentType}, filename=${originalFilename ?? '(none)'}`);
      } catch (sdkError) {
        // 如果 SDK 方法失败，回退到 fetchRemoteMedia（带超时保护）
        runtime.log?.(`[wecom] SDK file download failed, fallback: ${String(sdkError)}`);
        const fetched = await withTimeout(
          core.channel.media.fetchRemoteMedia({ url: fileUrl }),
          FILE_DOWNLOAD_TIMEOUT_MS,
          `Manual file download timed out: ${fileUrl}`,
        ) as { buffer: Buffer; contentType?: string };
        runtime.log?.(`[wecom] File fetched: contentType=${fetched.contentType}, size=${fetched.buffer.length}`);

        // fix: 同图片分支，fallback 路径漏解密会导致下载文件 MD5 与原文件不一致
        // （用户拿到的是密文），重新做 magic-byte 嗅探推 MIME。
        fileBuffer = tryDecryptWithAesKey(fetched.buffer, fileAesKey, runtime);
        const type = await fileTypeFromBuffer(fileBuffer);
        fileContentType = type?.mime ?? fetched.contentType ?? "application/octet-stream";
      }

      // 大小校验由插件层主动进行，超限抛出 MediaOversizeError，由 monitor 统一提示用户。
      // 不再把 maxBytes 传给核心层 saveMediaBuffer，避免重复校验产生无结构化错误。
      if (fileBuffer.length > maxBytes) {
        throw new MediaOversizeError({
          kind: "file",
          filename: originalFilename,
          sizeBytes: fileBuffer.length,
          maxBytes,
        });
      }

      const saved = await core.channel.media.saveMediaBuffer(
        fileBuffer,
        fileContentType,
        "inbound",
        maxBytes,
        originalFilename,
      );
      mediaList.push({ path: saved.path, contentType: saved.contentType });
      runtime.log?.(`[wecom][plugin] File saved: path=${saved.path}, contentType=${saved.contentType}`);
    } catch (err) {
      // 媒体超限错误需要上抛给 monitor，用于向用户发送明确的提示文案。
      if (err instanceof MediaOversizeError) {
        throw err;
      }
      runtime.error?.(`[wecom] Failed to download file: ${String(err)}`);
    }
  }

  return mediaList;
}
