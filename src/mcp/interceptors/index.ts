/**
 * MCP call 拦截器注册表与调度入口
 *
 * 所有 call 拦截器在此注册，按注册顺序执行。
 * 新增拦截器只需：
 *   1. 在 interceptors/ 目录下新建文件，实现 CallInterceptor 接口
 *   2. 在下方 interceptors 数组中注册
 *
 * tool.ts 的 handleCall 无需任何改动。
 */

import { bizErrorInterceptor } from "./biz-error.js";
// docAuthErrorInterceptor 已停用：文档授权错误改为透传后台 MCP 返回的错误信息，
// 不再发送授权引导模板卡片，对齐其他品类错误的表现。实现文件保留以便回滚。
// import { docAuthErrorInterceptor } from "./doc-auth-error.js";
import { mediaInterceptor } from "./msg-media.js";
import { smartpageCreateInterceptor } from "./smartpage-create.js";
import { smartpageExportInterceptor } from "./smartpage-export.js";
import { smartsheetUploadInterceptor } from "./smartsheet-upload.js";
import type { CallContext, CallInterceptor, BeforeCallOptions } from "./types.js";
import type { SendJsonRpcOptions } from "../transport.js";

export type { CallContext, CallInterceptor, BeforeCallOptions } from "./types.js";

// ============================================================================
// 拦截器注册表（按注册顺序执行）
// ============================================================================

const interceptors: CallInterceptor[] = [
  bizErrorInterceptor,         // 业务错误码检查（所有 call 生效）
  // docAuthErrorInterceptor,  // 已停用：文档授权错误透传原始 MCP 错误信息，不再发送授权卡片
  mediaInterceptor,            // get_msg_media base64 拦截
  smartpageCreateInterceptor,  // smartpage_create 本地文件读取
  smartpageExportInterceptor,  // smartpage_get_export_result content → 本地文件
  smartsheetUploadInterceptor, // smartsheet_add_records / update_records 本地文件上传
];

// ============================================================================
// 调度 API
// ============================================================================

/** resolveBeforeCall 的返回值 */
export interface ResolvedBeforeCall {
  /** 合并后的 sendJsonRpc 选项（如超时时间） */
  options?: SendJsonRpcOptions;
  /** 替换后的 args（如从本地文件读取的请求体） */
  args?: Record<string, unknown>;
}

/**
 * 收集匹配的 beforeCall 配置，合并后返回
 *
 * 合并策略：
 * - timeoutMs: 取所有拦截器返回值中的最大值
 * - args: 后注册的拦截器覆盖前者（一般同一调用只有一个拦截器会返回 args）
 */
export async function resolveBeforeCall(ctx: CallContext): Promise<ResolvedBeforeCall> {
  let mergedTimeoutMs: number | undefined;
  let mergedArgs: Record<string, unknown> | undefined;

  for (const interceptor of interceptors) {
    if (!interceptor.match(ctx) || !interceptor.beforeCall) continue;

    const opts = await interceptor.beforeCall(ctx);
    if (opts?.timeoutMs !== undefined) {
      mergedTimeoutMs = mergedTimeoutMs === undefined
        ? opts.timeoutMs
        : Math.max(mergedTimeoutMs, opts.timeoutMs);
    }
    if (opts?.args !== undefined) {
      mergedArgs = opts.args;
    }
  }

  return {
    options: mergedTimeoutMs !== undefined ? { timeoutMs: mergedTimeoutMs } : undefined,
    args: mergedArgs,
  };
}

/**
 * 依次执行匹配的 afterCall 拦截器，管道式传递 result
 *
 * 前一个拦截器的返回值作为下一个拦截器的输入。
 * 拦截器若不需要修改 result，应原样返回。
 */
export async function runAfterCall(ctx: CallContext, result: unknown): Promise<unknown> {
  let current = result;

  for (const interceptor of interceptors) {
    if (!interceptor.match(ctx) || !interceptor.afterCall) continue;
    current = await interceptor.afterCall(ctx, current);
  }

  return current;
}
