/**
 * 企业微信消息发送模块
 *
 * 负责通过 WSClient 发送回复消息，包含超时保护
 * 支持 WebSocket 断开时将消息加入待发送队列，重连后自动重发
 */

import type { RuntimeEnv } from "openclaw/plugin-sdk";
import { type WSClient, type WsFrame, generateReqId } from "@wecom/aibot-node-sdk";
import { REPLY_SEND_TIMEOUT_MS } from "./const.js";
import { withTimeout } from "./timeout.js";
import { addPendingMessage, type PendingMessage } from "./state-manager.js";

// ============================================================================
// 消息发送
// ============================================================================

/**
 * 发送企业微信回复消息
 * 供 monitor 内部和 channel outbound 使用
 *
 * 当 WebSocket 断开时，消息会被加入待发送队列，等待重连后重发
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
  /** 账户 ID（用于待发送队列） */
  accountId: string;
}): Promise<string> {
  const { wsClient, frame, text, runtime, finish = true, streamId: existingStreamId, accountId } = params;

  if (!text) {
    return "";
  }

  const streamId = existingStreamId || generateReqId("stream");

  if (!wsClient.isConnected) {
    // WebSocket 断开时，将消息加入待发送队列
    runtime.log?.(`[WeCom] WSClient not connected, queuing message for retry (streamId=${streamId})`);

    const pendingMessage: PendingMessage = {
      id: `${streamId}-${Date.now()}`,
      accountId,
      payload: {
        frame,
        text,
        finish,
        streamId,
      },
      createdAt: Date.now(),
    };

    addPendingMessage(pendingMessage);

    // 返回 streamId，但调用方应该知道消息尚未发送
    // 通过检查 wsClient.isConnected 可以判断是否真正发送
    return streamId;
  }

  // 使用 SDK 的 replyStream 方法发送消息，带超时保护
  await withTimeout(
    wsClient.replyStream(frame, streamId, text, finish),
    REPLY_SEND_TIMEOUT_MS,
    `Reply send timed out (streamId=${streamId})`,
  );
  runtime.log?.(`[WeCom] Sent reply: streamId=${streamId}, finish=${finish}`);

  return streamId;
}
