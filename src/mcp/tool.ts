/**
 * wecom_mcp — 模拟 MCP 调用的 Agent Tool
 *
 * 通过 MCP Streamable HTTP 传输协议调用企业微信 MCP Server，
 * 提供 list（列出所有工具）和 call（调用工具）两个操作。
 *
 * 在 skills 中的使用方式：
 *   wecom_mcp list <category>
 *   wecom_mcp call <category> <method> '<jsonArgs>'
 *
 * 示例：
 *   wecom_mcp list contact
 *   wecom_mcp call contact getContact '{}'
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { sendJsonRpc, clearCategoryCache, MEDIA_DOWNLOAD_TIMEOUT_MS, type McpToolInfo } from "./transport.js";
import { cleanSchemaForGemini } from "./schema.js";
import { getWeComRuntime } from "../runtime.js";
import { detectMime } from "../openclaw-compat.js";

// ============================================================================
// 类型定义
// ============================================================================

/** wecom_mcp 的入参 */
interface WeComToolsParams {
  /** 操作类型：list | call */
  action: "list" | "call";
  /** MCP 品类，对应 mcpConfig 中的 key，如 doc、contact */
  category: string;
  /** 调用的 MCP 方法名（action=call 时必填） */
  method?: string;
  /** 调用 MCP 方法的 JSON 参数（action=call 时使用） */
  args?: string | Record<string, unknown>;
}

// ============================================================================
// 响应构造辅助
// ============================================================================

/** 构造统一的文本响应结构 */
const textResult = (data: unknown): AgentToolResult<unknown> => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  details: data,
});

/** 构造错误响应 */
const errorResult = (err: unknown) => {
  // 适配企业微信 API 返回的 { errcode, errmsg } 结构
  if (err && typeof err === "object" && "errcode" in err) {
    const { errcode, errmsg } = err as { errcode: number; errmsg?: string };
    return textResult({ error: errmsg ?? `错误码: ${errcode}`, errcode });
  }

  const message = err instanceof Error ? err.message : String(err);
  return textResult({ error: message });
};

// ============================================================================
// list 操作：列出某品类的所有 MCP 工具
// ============================================================================

const handleList = async (category: string): Promise<unknown> => {
  const result = await sendJsonRpc(category, "tools/list") as { tools?: McpToolInfo[] } | undefined;

  const tools = result?.tools ?? [];
  if (tools.length === 0) {
    return { message: `品类 "${category}" 下暂无可用工具`, tools: [] };
  }

  return {
    category,
    count: tools.length,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      // 清洗 inputSchema，内联 $ref/$defs 引用并移除 Gemini 不支持的关键词，
      // 避免 Gemini 模型解析 function response 时报 400 错误
      inputSchema: t.inputSchema ? cleanSchemaForGemini(t.inputSchema) : undefined,
    })),
  };
};

// ============================================================================
// call 操作：调用某品类的某个 MCP 工具
// ============================================================================

/**
 * 需要触发缓存清理的业务错误码集合
 *
 * 这些错误码出现在 MCP 工具调用返回的 content 文本中（业务层面），
 * 与 JSON-RPC 层面的错误码不同，需要在此处额外检测。
 *
 * - 850002: 机器人未被授权使用对应能力，需清理缓存以便下次重新拉取配置
 */
const BIZ_CACHE_CLEAR_ERROR_CODES = new Set([850002]);

/**
 * 检查 tools/call 的返回结果中是否包含需要清理缓存的业务错误码
 *
 * MCP Server 可能在正常的 JSON-RPC 响应中返回业务层错误，
 * 这些错误被包裹在 result.content[].text 中，需要解析后判断。
 */
const checkBizErrorAndClearCache = (result: unknown, category: string): void => {
  if (!result || typeof result !== "object") return;

  const { content } = result as { content?: Array<{ type: string; text?: string }> };
  if (!Array.isArray(content)) return;

  for (const item of content) {
    if (item.type !== "text" || !item.text) continue;
    try {
      const parsed = JSON.parse(item.text) as Record<string, unknown>;
      if (typeof parsed.errcode === "number" && BIZ_CACHE_CLEAR_ERROR_CODES.has(parsed.errcode)) {
        console.log(`[mcp] 检测到业务错误码 ${parsed.errcode} (category="${category}")，清理缓存`);
        clearCategoryCache(category);
        return;
      }
    } catch {
      // text 不是 JSON 格式，跳过
    }
  }
};

// ============================================================================
// get_msg_media 响应拦截：base64 → 本地文件
// ============================================================================

/**
 * 拦截 get_msg_media 的 MCP 响应
 *
 * 核心逻辑：
 * 1. 从 MCP result 的 content[].text 中提取业务 JSON
 * 2. 提取 media_item.base64_data，解码为 Buffer
 * 3. 通过 openclaw SDK 的 saveMediaBuffer 保存到本地媒体目录
 * 4. 替换响应：移除 base64_data，加入 local_path
 *
 * 这样大模型只看到轻量的文件路径信息，不会被 base64 数据消耗 token。
 */
async function interceptMediaResponse(result: unknown): Promise<unknown> {
  const t0 = performance.now();

  // 1. 提取 MCP result 中的 content 数组
  const content = (result as Record<string, unknown>)?.content;
  if (!Array.isArray(content)) return result;

  const textItem = content.find(
    (c: Record<string, unknown>) => c.type === "text" && typeof c.text === "string",
  ) as { type: string; text: string } | undefined;
  if (!textItem) return result;

  // 2. 解析业务 JSON
  let bizData: Record<string, unknown>;
  try {
    bizData = JSON.parse(textItem.text) as Record<string, unknown>;
  } catch {
    // 非 JSON 格式，原样返回
    return result;
  }

  // 3. 校验业务响应：errcode !== 0 或无 media_item 时原样返回
  if (bizData.errcode !== 0) return result;

  const mediaItem = bizData.media_item as Record<string, unknown> | undefined;
  if (!mediaItem || typeof mediaItem.base64_data !== "string") return result;

  const base64Data = mediaItem.base64_data as string;
  const mediaName = mediaItem.name as string | undefined;
  const mediaType = mediaItem.type as string | undefined;
  const mediaId = mediaItem.media_id as string | undefined;

  const tParsed = performance.now();

  // 4. 解码 base64 → Buffer
  const buffer = Buffer.from(base64Data, "base64");
  const tDecoded = performance.now();

  // 5. 检测 contentType，并通过 saveMediaBuffer 保存到本地媒体目录
  const contentType = await detectMime({ buffer, filePath: mediaName }) ?? "application/octet-stream";
  const tMimeDetected = performance.now();

  // 企业微信聊天记录附件可达 20MB（文件消息上限），
  // 而 saveMediaBuffer 默认 maxBytes 为 5MB（针对 outbound 场景），
  // 此处显式放宽到 20MB 以支持大文件下载。
  const INBOUND_MAX_BYTES = 20 * 1024 * 1024; // 20MB

  const core = getWeComRuntime();
  const saved = await core.channel.media.saveMediaBuffer(
    buffer,
    contentType,
    "inbound",
    INBOUND_MAX_BYTES,   // maxBytes: 放宽到 20MB，匹配企业微信文件消息上限
    mediaName,           // originalFilename: 保留原始文件名
  );

  // 5.1 补偿：核心库 EXT_BY_MIME 可能缺少某些格式映射（如 audio/amr），
  //     导致保存的文件没有后缀。此处检测并修复。
  const MIME_EXT_PATCH: Record<string, string> = {
    "audio/amr": ".amr",
  };
  const patchExt = MIME_EXT_PATCH[contentType];
  if (patchExt && !path.extname(saved.path)) {
    const newPath = saved.path + patchExt;
    try {
      await fs.rename(saved.path, newPath);
      saved.path = newPath;
    } catch {
      // rename 失败不影响主流程，文件仍可用
    }
  }

  const tSaved = performance.now();

  // 6. 构造精简响应，移除 base64_data，加入本地路径
  const newBizData = {
    errcode: 0,
    errmsg: "ok",
    media_item: {
      media_id: mediaId,
      name: mediaName ?? saved.path.split("/").pop(),
      type: mediaType,
      local_path: saved.path,
      size: buffer.length,
      content_type: saved.contentType,
    },
  };

  const tEnd = performance.now();

  // 耗时日志：各环节耗时（ms）
  console.log(
    `[mcp] get_msg_media 拦截成功: media_id=${mediaId ?? "unknown"}, ` +
    `type=${mediaType ?? "unknown"}, size=${buffer.length}, saved=${saved.path}\n` +
    `  ⏱ 耗时明细 (总 ${(tEnd - t0).toFixed(1)}ms):\n` +
    `    解析响应 JSON:   ${(tParsed - t0).toFixed(1)}ms\n` +
    `    base64 解码:     ${(tDecoded - tParsed).toFixed(1)}ms  (${(base64Data.length / 1024).toFixed(0)}KB base64 → ${(buffer.length / 1024).toFixed(0)}KB buffer)\n` +
    `    MIME 检测:       ${(tMimeDetected - tDecoded).toFixed(1)}ms  (${contentType})\n` +
    `    saveMediaBuffer: ${(tSaved - tMimeDetected).toFixed(1)}ms\n` +
    `    构造响应:        ${(tEnd - tSaved).toFixed(1)}ms`,
  );

  // 7. 返回修改后的 MCP result 结构
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(newBizData),
    }],
  };
}

// ============================================================================
// call 操作：调用某品类的某个 MCP 工具
// ============================================================================

const handleCall = async (
  category: string,
  method: string,
  args: Record<string, unknown>,
): Promise<unknown> => {
  const callStart = performance.now();

  // get_msg_media 使用延长的超时时间（120s），因为返回的 base64 数据可达 ~27MB
  const options = method === "get_msg_media" ? { timeoutMs: MEDIA_DOWNLOAD_TIMEOUT_MS } : undefined;

  const result = await sendJsonRpc(category, "tools/call", {
    name: method,
    arguments: args,
  }, options);

  const rpcDone = performance.now();
  const rpcMs = (rpcDone - callStart).toFixed(1);

  // 检查业务层错误码，必要时清理缓存
  checkBizErrorAndClearCache(result, category);

  // 对 get_msg_media 响应进行 base64 拦截：解码存本地，只返回路径给大模型
  if (method === "get_msg_media") {
    const intercepted = await interceptMediaResponse(result);
    const totalMs = (performance.now() - callStart).toFixed(1);
    console.log(
      `[mcp] handleCall ${category}/${method} 总耗时: ${totalMs}ms` +
      ` (MCP请求: ${rpcMs}ms, 拦截处理: ${(performance.now() - rpcDone).toFixed(1)}ms)`,
    );
    return intercepted;
  }

  console.log(`[mcp] handleCall ${category}/${method} 耗时: ${rpcMs}ms`);
  return result;
};

// ============================================================================
// 参数解析
// ============================================================================

/**
 * 解析 args 参数：支持 JSON 字符串或直接的对象
 */
const parseArgs = (args: string | Record<string, unknown> | undefined): Record<string, unknown> => {
  if (!args) return {};
  if (typeof args === "object") return args;
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch (err) {
    const detail = err instanceof SyntaxError ? err.message : String(err);
    throw new Error(`args 参数不是合法的 JSON: ${args} (${detail})`);
  }
};

// ============================================================================
// 工具定义 & 导出
// ============================================================================

/**
 * 创建 wecom_mcp Agent Tool 定义
 */
export function createWeComMcpTool() {
  return {
    name: "wecom_mcp",
    label: "企业微信 MCP 工具",
    description: [
      "通过 HTTP 直接调用企业微信 MCP Server。",
      "支持两种操作：",
      "  - list: 列出指定品类的所有 MCP 工具",
      "  - call: 调用指定品类的某个 MCP 工具",
      "",
      "使用方式：",
      "  wecom_mcp list <category>",
      "  wecom_mcp call <category> <method> '<jsonArgs>'",
      "",
      "示例：",
      "  列出 contact 品类所有工具：wecom_mcp list contact",
      "  调用 contact 的 getContact：wecom_mcp call contact getContact '{}'",
    ].join("\n"),
    parameters: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["list", "call"],
          description: "操作类型：list（列出工具）或 call（调用工具）",
        },
        category: {
          type: "string",
          description: "MCP 品类名称，如 doc、contact 等，对应 mcpConfig 中的 key",
        },
        method: {
          type: "string",
          description: "要调用的 MCP 方法名（action=call 时必填）",
        },
        args: {
          type: ["string", "object"],
          description: "调用 MCP 方法的参数，可以是 JSON 字符串或对象（action=call 时使用，默认 {}）",
        },
      },
      required: ["action", "category"],
    },
    async execute(_toolCallId: string, params: unknown) {
      const p = params as WeComToolsParams;
      try {
        switch (p.action) {
          case "list":
            return textResult(await handleList(p.category));
          case "call": {
            if (!p.method) {
              return textResult({ error: "action 为 call 时必须提供 method 参数" });
            }
            const args = parseArgs(p.args);
            return textResult(await handleCall(p.category, p.method, args));
          }
          default:
            return textResult({ error: `未知操作类型: ${String(p.action)}，支持 list 和 call` });
        }
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}
