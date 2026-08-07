/**
 * 企业微信消息发送模块
 *
 * 负责通过 WSClient 发送回复消息，包含超时保护
 */

import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { type WSClient, type WsFrame, generateReqId } from "@wecom/aibot-node-sdk";
import { REPLY_SEND_TIMEOUT_MS } from "./const.js";
import { withTimeout } from "./timeout.js";

// ============================================================================
// 流式过期错误（errcode 846608）
// ============================================================================

/** 流式回复超时错误码（>6分钟未更新，服务端拒绝继续流式更新） */
export const STREAM_EXPIRED_ERRCODE = 846608;

/**
 * 流式回复过期错误
 * 当服务端返回 errcode=846608 时抛出，表示流式消息已超过6分钟无法更新，
 * 调用方需降级为主动发送（sendMessage）方式回复。
 */
export class StreamExpiredError extends Error {
  readonly errcode: number = STREAM_EXPIRED_ERRCODE;
  constructor(message?: string) {
    super(message ?? `Stream message update expired (errcode=${STREAM_EXPIRED_ERRCODE})`);
    this.name = "StreamExpiredError";
  }
}

/** 被动回复 req_id 无效/已消费错误码（事件回调帧的 req_id 只能消费一次） */
export const INVALID_REQ_ID_ERRCODE = 846605;

/**
 * 被动回复使用的 req_id 已失效（errcode=846605 invalid req_id）。
 * 典型场景：事件回调帧的 req_id 已被卡片更新回复消费后又被复用。
 * 语义与 StreamExpiredError 相同：被动回复通道不可用，调用方降级为主动发送。
 * 继承 StreamExpiredError 以复用既有 `instanceof StreamExpiredError` 降级逻辑。
 */
export class InvalidReqIdError extends StreamExpiredError {
  override readonly errcode = INVALID_REQ_ID_ERRCODE;
  constructor(message?: string) {
    super(message ?? `Passive reply req_id invalid or consumed (errcode=${INVALID_REQ_ID_ERRCODE})`);
    this.name = "InvalidReqIdError";
  }
}

// ============================================================================
// 消息发送
// ============================================================================

/**
 * 发送企业微信回复消息
 * 供 monitor 内部和 channel outbound 使用
 *
 * @returns messageId (streamId)
 */
export async function sendWeComReply(params: {
  wsClient: WSClient;
  frame: WsFrame;
  text?: string;
  runtime: RuntimeEnv;
  /** 是否为流式回复的最终消息，默认为 true */
  finish?: boolean;
  /** 指定 streamId，用于流式回复时保持相同的 streamId */
  streamId?: string;
}): Promise<string> {
  const { wsClient, frame, text, runtime, finish = true, streamId: existingStreamId } = params;

  if (!text) {
    return "";
  }

  const streamId = existingStreamId || generateReqId("stream");

  if (!wsClient.isConnected) {
    runtime.error?.(`[wecom] WSClient not connected, cannot send reply`);
    throw new Error("WSClient not connected");
  }

  const body = frame.body as {
    msgtype?: string;
    chatid?: string;
    from?: {
      userid?: string;
    };
    /** 由 monitor 注入：该帧的 req_id 已被消费（如卡片更新回复），回复必须走主动发送 */
    __wecomReplyViaActiveSend?: boolean;
  };

  // 事件回调（aibot_event_callback）没有可用于 replyStream 的有效 req_id，
  // 对该场景改用主动发送 sendMessage，避免 846605 invalid req_id。
  // 同理：被改写为 text 注入 Agent 的答案帧（__wecomReplyViaActiveSend 标记）。
  if (body.msgtype === "event" || body.__wecomReplyViaActiveSend === true) {
    // 中间帧（thinking / 流式增量）直接跳过，仅在最终帧主动发一次文本。
    if (!finish) {
      runtime.log?.(`[plugin -> server] skip non-final stream for event callback, streamId=${streamId}`);
      return streamId;
    }

    const chatId = body.chatid || body.from?.userid;
    if (!chatId) {
      throw new Error("Missing chatId for event callback reply");
    }

    await withTimeout(
      wsClient.sendMessage(chatId, {
        msgtype: "markdown",
        markdown: { content: text },
      }),
      REPLY_SEND_TIMEOUT_MS,
      `Event reply send timed out (streamId=${streamId})`,
    );
    runtime.log?.(`[plugin -> server] event-active-send chatId=${chatId}, finish=${finish}`);
    return streamId;
  }

  // 非事件消息，继续使用 replyStream（被动回复）
  // 使用 SDK 的 replyStream 方法发送消息，带超时保护
  try {
    await withTimeout(
      wsClient.replyStream(frame, streamId, text, finish),
      REPLY_SEND_TIMEOUT_MS,
      `Reply send timed out (streamId=${streamId})`,
    );
  } catch (err: any) {
    // 服务端返回 846608：流式消息超过6分钟无法更新，需降级为主动发送
    const errMsg = err?.errmsg || err?.message || String(err);
    if (
      err?.errcode === STREAM_EXPIRED_ERRCODE ||
      errMsg.includes(String(STREAM_EXPIRED_ERRCODE))
    ) {
      throw new StreamExpiredError(errMsg);
    }
    // 服务端返回 846605：req_id 无效/已消费，同样降级为主动发送
    if (
      err?.errcode === INVALID_REQ_ID_ERRCODE ||
      errMsg.includes(String(INVALID_REQ_ID_ERRCODE))
    ) {
      throw new InvalidReqIdError(errMsg);
    }
    throw err;
  }
  runtime.log?.(`[plugin -> server] streamId=${streamId}, finish=${finish}`);

  return streamId;
}

// ============================================================================
// 非阻塞流式发送（用于 onPartialReply 场景）
// ============================================================================

/**
 * 非阻塞流式文本回复
 *
 * 基于 SDK 的 replyStreamNonBlocking 方法：
 * - 如果上一条同 reqId 的消息尚未收到 ack，则跳过本次发送（返回 'skipped'），
 *   避免流式中间帧排队积压导致延迟。
 * - finish=true 的最终帧不受此限制，始终保证发送。
 *
 * @returns 'skipped' 表示被跳过，否则返回 streamId
 */
export async function sendWeComReplyNonBlocking(params: {
  wsClient: WSClient;
  frame: WsFrame;
  text: string;
  runtime: RuntimeEnv;
  streamId: string;
  finish?: boolean;
}): Promise<string | 'skipped'> {
  const { wsClient, frame, text, runtime, streamId, finish = false } = params;

  if (!text) {
    return 'skipped';
  }

  if (!wsClient.isConnected) {
    return 'skipped';
  }

  try {
    const result = await wsClient.replyStreamNonBlocking(frame, streamId, text, finish);
    if (result === 'skipped') {
      return 'skipped';
    }
    return streamId;
  } catch (err: any) {
    // 服务端返回 846608：流式消息超过6分钟无法更新，需降级为主动发送
    const errMsg = err?.errmsg || err?.message || String(err);
    if (
      err?.errcode === STREAM_EXPIRED_ERRCODE ||
      errMsg.includes(String(STREAM_EXPIRED_ERRCODE))
    ) {
      throw new StreamExpiredError(errMsg);
    }
    throw err;
  }
}
