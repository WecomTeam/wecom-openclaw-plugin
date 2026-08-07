/**
 * 企业微信模板卡片交互事件分发模块
 *
 * 将企业微信 `template_card_event` 回调适配到 OpenClaw 标准交互分发管线：
 * - 业务插件通过 `api.registerInteractiveHandler({ channel: "wecom", namespace, handler })` 注册
 * - 本模块以回调的 `event_key`（约定格式 `namespace:payload`）做命名空间匹配，
 *   通过 `dispatchPluginInteractiveHandler()` 转发给对应业务插件
 *
 * 设计（通用交互事件分发适配层）：
 * 不在此维护任何 channel 本地全局注册表，注册与去重均由 OpenClaw core 负责。
 */

import { dispatchPluginInteractiveHandler } from "openclaw/plugin-sdk/plugin-runtime";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import type { MessageBody } from "./message-parser.js";

// ============================================================================
// 类型定义
// ============================================================================

/** 最小日志接口（同时兼容 RuntimeEnv 与 webhook 侧的 WecomRuntimeEnv） */
export interface WeComInteractiveLogger {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

/** 归一化后的选择项（来自 selected_items.selected_item） */
export interface WeComInteractiveSelectedItem {
  questionKey: string;
  optionIds: string[];
}

export type WeComInteractiveHandlerResult = { handled?: boolean } | void;

export interface WeComInteractiveHandlerContext {
  channel: "wecom";
  accountId: string;
  /** 点击卡片的企业微信 userid */
  senderId?: string;
  /** 会话 ID（群聊为 chatid，单聊为 userid） */
  chatId?: string;
  chatType?: "single" | "group";
  /** 回调消息 msgid */
  messageId?: string;
  /** 命中的注册命名空间 */
  namespace: string;
  /** event_key 去掉命名空间前缀后的剩余部分 */
  payload: string;
  /** 完整 event_key */
  action: string;
  /** 模板卡片 task_id */
  taskId?: string;
  /** 卡片类型（button_interaction / vote_interaction / multiple_interaction 等） */
  cardType?: string;
  selectedItems: WeComInteractiveSelectedItem[];
  /** 原始 template_card_event 回调体 */
  rawEvent: unknown;
  respond: {
    /** 向当前会话发送一条新的 markdown 消息 */
    reply: (args: { text: string }) => Promise<void>;
    /** 追加消息（企业微信无线程概念，等价于 reply） */
    followUp: (args: { text: string }) => Promise<void>;
    /**
     * 尽力更新当前交互卡片（最佳映射）。
     * 企业微信模板卡片只能按原卡片结构整体更新，这里将文本写入 sub_title_text；
     * 无法更新时回退为 reply。
     */
    editMessage: (args: { text?: string }) => Promise<void>;
  };
}

export interface WeComInteractiveDispatchParams {
  accountId: string;
  /** 完整的回调消息体（msgtype=event, event.eventtype=template_card_event） */
  body: MessageBody;
  runtime: WeComInteractiveLogger;
  /** 由调用方按运行模式（Bot WS / Bot Webhook）构造的出站能力 */
  respond: WeComInteractiveHandlerContext["respond"];
}

export interface WeComInteractiveDispatchResult {
  matched: boolean;
  handled: boolean;
  duplicate: boolean;
}

// ============================================================================
// 分发实现
// ============================================================================

/** 归一化 selected_items 结构 */
export function parseWeComSelectedItems(
  body: MessageBody,
): WeComInteractiveSelectedItem[] {
  const selectedItems = body.event?.template_card_event?.selected_items?.selected_item ?? [];
  return selectedItems
    .map((item) => ({
      questionKey: item.question_key?.trim() ?? "",
      optionIds: item.option_ids?.option_id?.filter(Boolean) ?? [],
    }))
    .filter((item) => item.questionKey.length > 0);
}

/**
 * 将企业微信模板卡片交互回调分发给已注册的业务插件处理器。
 *
 * 约定：`event_key` 采用 `namespace:payload` 格式（按第一个 `:` 拆分，
 * 由 OpenClaw core 的 dispatchPluginInteractiveHandler 完成）。
 *
 * @returns matched=false 表示 event_key 缺失或没有对应命名空间的注册处理器，
 *          调用方应继续走默认处理流程。
 */
export async function dispatchWeComPluginInteractiveHandler(
  params: WeComInteractiveDispatchParams,
): Promise<WeComInteractiveDispatchResult> {
  const { accountId, body, runtime, respond } = params;
  const cardEvent = body.event?.template_card_event;
  const eventKey = cardEvent?.event_key?.trim();

  if (body.msgtype !== "event" || body.event?.eventtype !== "template_card_event" || !eventKey) {
    return { matched: false, handled: false, duplicate: false };
  }

  const chatId = body.chatid || body.from?.userid;
  const senderUserId = body.from?.userid;
  // msgid 唯一标识一次回调，作为去重键的一部分，防止 SDK 重发导致重复处理
  const dedupeId = [
    "wecom",
    accountId,
    chatId ?? "-",
    body.msgid ?? "-",
    senderUserId ?? "-",
    eventKey,
  ].join(":");

  const selectedItems = parseWeComSelectedItems(body);

  try {
    const result = await dispatchPluginInteractiveHandler<{
      channel: "wecom";
      namespace: string;
      handler: (
        ctx: WeComInteractiveHandlerContext,
      ) => Promise<WeComInteractiveHandlerResult> | WeComInteractiveHandlerResult;
    }>({
      channel: "wecom",
      data: eventKey,
      dedupeId,
      invoke: async (match) => {
        const { registration, namespace, payload } = match;
        const handlerCtx: WeComInteractiveHandlerContext = {
          channel: "wecom",
          accountId,
          senderId: senderUserId,
          chatId,
          chatType: body.chattype === "group" ? "group" : "single",
          messageId: body.msgid,
          namespace,
          payload,
          action: eventKey,
          taskId: cardEvent?.task_id,
          cardType: cardEvent?.card_type,
          selectedItems,
          rawEvent: cardEvent,
          respond,
        };
        const handlerResult = await registration.handler(handlerCtx);
        return { handled: handlerResult?.handled ?? true };
      },
    });
    return result;
  } catch (err) {
    runtime.error?.(`[wecom][interactive] dispatch failed: event_key=${eventKey}, error=${String(err)}`);
    return { matched: true, handled: false, duplicate: false };
  }
}

// ============================================================================
// Bot WebSocket 模式的 respond 能力构造
// ============================================================================

import type { WSClient, WsFrame } from "@wecom/aibot-node-sdk";
import {
  getTemplateCardFromCache,
  saveTemplateCardToCache,
} from "./template-card-manager.js";

/**
 * 构造 Bot WebSocket 模式下的 respond 三件套：
 * - reply / followUp：通过 wsClient.sendMessage 向当前会话主动推送 markdown
 * - editMessage：尽力更新当前交互卡片（按 task_id 取缓存卡片，文本写入 sub_title_text，
 *   对所有用户可见）；无法更新时回退为 reply
 */
export function buildWsInteractiveRespond(params: {
  wsClient: WSClient;
  frame: WsFrame;
  accountId: string;
  body: MessageBody;
  runtime: RuntimeEnv;
}): WeComInteractiveHandlerContext["respond"] {
  const { wsClient, frame, accountId, body, runtime } = params;
  const chatId = body.chatid || body.from?.userid;
  const taskId = body.event?.template_card_event?.task_id;

  const sendMarkdown = async (text: string | undefined): Promise<void> => {
    const trimmed = text?.trim();
    if (!trimmed || !chatId) return;
    await wsClient.sendMessage(chatId, {
      msgtype: "markdown",
      markdown: { content: trimmed },
    });
  };

  return {
    reply: async ({ text }) => {
      await sendMarkdown(text);
    },
    followUp: async ({ text }) => {
      await sendMarkdown(text);
    },
    editMessage: async ({ text }) => {
      const trimmed = text?.trim();
      if (!taskId || !trimmed) {
        if (trimmed) await sendMarkdown(trimmed);
        return;
      }
      const cachedCard = getTemplateCardFromCache(accountId, taskId);
      if (!cachedCard) {
        runtime.log?.(
          `[wecom][interactive] editMessage fallback to reply: task_id=${taskId} not in cache`,
        );
        await sendMarkdown(trimmed);
        return;
      }
      cachedCard.sub_title_text = trimmed;
      // 不传 userids：更新对所有用户可见
      await wsClient.updateTemplateCard(frame, cachedCard);
      saveTemplateCardToCache({ accountId, templateCard: cachedCard, runtime });
    },
  };
}
