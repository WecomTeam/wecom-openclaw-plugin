/**
 * 企业微信 WebSocket 监控器主模块
 *
 * 负责：
 * - 建立和管理 WebSocket 连接
 * - 协调消息处理流程（解析→策略检查→下载图片→路由回复）
 * - 资源生命周期管理
 *
 * 子模块：
 * - message-parser.ts  : 消息内容解析
 * - message-sender.ts  : 消息发送（带超时保护）
 * - media-handler.ts   : 图片下载和保存（带超时保护）
 * - group-policy.ts    : 群组访问控制
 * - dm-policy.ts       : 私聊访问控制
 * - state-manager.ts   : 全局状态管理（带 TTL 清理）
 * - timeout.ts         : 超时工具
 */

import * as os from "os";
import * as path from "path";
import type { OpenClawConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import { WSClient, generateReqId } from "@wecom/aibot-node-sdk";
import type { WsFrame, Logger } from "@wecom/aibot-node-sdk";
import { getWeComRuntime } from "./runtime.js";
import { getDefaultMediaLocalRoots } from "./openclaw-compat.js";
import type { ResolvedWeComAccount, WeComConfig } from "./utils.js";
import {
  CHANNEL_ID,
  THINKING_MESSAGE,
  MEDIA_IMAGE_PLACEHOLDER,
  MEDIA_DOCUMENT_PLACEHOLDER,
  MESSAGE_PROCESS_TIMEOUT_MS,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_MAX_RECONNECT_ATTEMPTS,
} from "./const.js";
import type { WeComMonitorOptions, MessageState } from "./interface.js";
import { parseMessageContent, type MessageBody } from "./message-parser.js";
import { sendWeComReply } from "./message-sender.js";
import { downloadAndSaveImages, downloadAndSaveFiles } from "./media-handler.js";
import { uploadAndSendMedia } from "./media-uploader.js";
import { checkGroupPolicy } from "./group-policy.js";
import { checkDmPolicy } from "./dm-policy.js";
import {
  setWeComWebSocket,
  setMessageState,
  deleteMessageState,
  setReqIdForChat,
  warmupReqIdStore,
  startMessageStateCleanup,
  stopMessageStateCleanup,
  cleanupAccount,
} from "./state-manager.js";
import { withTimeout } from "./timeout.js";
import { fetchAndSaveMcpConfig } from "./mcp-config.js";

/**
 * 去除文本中的 `<think>...</think>` 标签（支持跨行），返回剩余可见文本。
 * 用于判断大模型回复中是否包含实际用户可见内容（而非仅有 thinking 推理过程）。
 */
function stripThinkTags(text: string): string {
  return text;
  // return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

// ============================================================================
// 媒体本地路径白名单扩展
// ============================================================================

/**
 * 解析 openclaw 状态目录（与 plugin-sdk 内部逻辑保持一致）
 */
function resolveStateDir(): string {
  const stateOverride = process.env.OPENCLAW_STATE_DIR?.trim() || process.env.CLAWDBOT_STATE_DIR?.trim();
  if (stateOverride) return stateOverride;
  return path.join(os.homedir(), ".openclaw");
}

/**
 * 在 getDefaultMediaLocalRoots() 基础上，将 stateDir 本身也加入白名单，
 * 并合并用户在 WeComConfig 中配置的自定义 mediaLocalRoots。
 *
 * getDefaultMediaLocalRoots() 仅包含 stateDir 下的子目录（media/agents/workspace/sandboxes），
 * 但 agent 生成的文件可能直接放在 stateDir 根目录下（如 ~/.openclaw-dev/1.png），
 * 因此需要将 stateDir 本身也加入白名单以避免 LocalMediaAccessError。
 *
 * 用户可在 openclaw.json 中配置：
 * {
 *   "channels": {
 *     "wecom": {
 *       "mediaLocalRoots": ["~/Downloads", "~/Documents"]
 *     }
 *   }
 * }
 */
async function getExtendedMediaLocalRoots(config?: WeComConfig): Promise<string[]> {
  // 从兼容层获取默认白名单（内部已处理低版本 SDK 的 fallback）
  const defaults = await getDefaultMediaLocalRoots();
  const roots: string[] = [...defaults];

  const stateDir = path.resolve(resolveStateDir());
  if (!roots.includes(stateDir)) {
    roots.push(stateDir);
  }
  // 合并用户在 WeComConfig 中配置的自定义路径
  if (config?.mediaLocalRoots) {
    for (const r of config.mediaLocalRoots) {
      const resolved = path.resolve(r.replace(/^~(?=\/|$)/, os.homedir()));
      if (!roots.includes(resolved)) {
        roots.push(resolved);
      }
    }
  }
  return roots;
}

// ============================================================================
// 媒体发送错误提示
// ============================================================================

/**
 * 根据媒体发送结果生成纯文本错误摘要（用于替换 thinking 流式消息展示给用户）。
 *
 * 使用纯文本而非 markdown 格式，因为 replyStream 只支持纯文本。
 */
function buildMediaErrorSummary(
  mediaUrl: string,
  result: { rejectReason?: string; error?: string },
): string {
  if (result.error?.includes("LocalMediaAccessError")) {
    return `⚠️ 文件发送失败：没有权限访问路径 ${mediaUrl}\n请在 openclaw.json 的 mediaLocalRoots 中添加该路径的父目录后重启生效。`;
  }
  if (result.rejectReason) {
    return `⚠️ 文件发送失败：${result.rejectReason}`;
  }
  return `⚠️ 文件发送失败：无法处理文件 ${mediaUrl}，请稍后再试。`;
}

// ============================================================================
// 重新导出（保持向后兼容）
// ============================================================================

export type { WeComMonitorOptions } from "./interface.js";
export { WeComCommand } from "./const.js";
export {
  getWeComWebSocket,
  setReqIdForChat,
  getReqIdForChatAsync,
  getReqIdForChat,
  deleteReqIdForChat,
  warmupReqIdStore,
  flushReqIdStore,
} from "./state-manager.js";
export { sendWeComReply } from "./message-sender.js";

// ============================================================================
// 消息上下文构建
// ============================================================================

/**
 * 构建消息上下文
 */
function buildMessageContext(
  frame: WsFrame,
  account: ResolvedWeComAccount,
  config: OpenClawConfig,
  text: string,
  mediaList: Array<{ path: string; contentType?: string }>,
  quoteContent?: string
) {
  const core = getWeComRuntime();
  const body = frame.body as MessageBody;
  const chatId = body.chatid || body.from.userid;
  const chatType = body.chattype === "group" ? "group" : "direct";

  // 解析路由信息
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: chatType,
      id: chatId,
    },
  });

  // 构建会话标签
  const fromLabel = chatType === "group" ? `group:${chatId}` : `user:${body.from.userid}`;

  // 当只有媒体没有文本时，使用占位符标识媒体类型
  const hasImages = mediaList.some((m) => m.contentType?.startsWith("image/"));
  const messageBody = text || (mediaList.length > 0 ? (hasImages ? MEDIA_IMAGE_PLACEHOLDER : MEDIA_DOCUMENT_PLACEHOLDER) : "");

  // 构建多媒体数组
  const mediaPaths = mediaList.length > 0 ? mediaList.map((m) => m.path) : undefined;
  const mediaTypes = mediaList.length > 0
    ? (mediaList.map((m) => m.contentType).filter(Boolean) as string[])
    : undefined;

  // 构建标准消息上下文
  return core.channel.reply.finalizeInboundContext({
    Body: messageBody,
    RawBody: messageBody,
    CommandBody: messageBody,

    MessageSid: body.msgid,

    From: chatType === "group" ? `${CHANNEL_ID}:group:${chatId}` : `${CHANNEL_ID}:${body.from.userid}`,
    To: `${CHANNEL_ID}:${chatId}`,
    SenderId: body.from.userid,

    SessionKey: route.sessionKey,
    AccountId: account.accountId,

    ChatType: chatType,
    ConversationLabel: fromLabel,

    Timestamp: Date.now(),

    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,

    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `${CHANNEL_ID}:${chatId}`,

    CommandAuthorized: true,

    ResponseUrl: body.response_url,
    ReqId: frame.headers.req_id,
    WeComFrame: frame,

    MediaPath: mediaList[0]?.path,
    MediaType: mediaList[0]?.contentType,
    MediaPaths: mediaPaths,
    MediaTypes: mediaTypes,
    MediaUrls: mediaPaths,

    ReplyToBody: quoteContent,
  });
}

// ============================================================================
// 消息处理和回复
// ============================================================================

/** deliver 回调所需的上下文 */
interface DeliverContext {
  wsClient: WSClient;
  frame: WsFrame;
  state: MessageState;
  account: ResolvedWeComAccount;
  runtime: RuntimeEnv;
}

/**
 * 发送"思考中"消息
 */
async function sendThinkingReply(params: {
  wsClient: WSClient;
  frame: WsFrame;
  streamId: string;
  runtime: RuntimeEnv;
}): Promise<void> {
  const { wsClient, frame, streamId, runtime } = params;
  try {
    await sendWeComReply({
      wsClient,
      frame,
      text: THINKING_MESSAGE,
      runtime,
      finish: false,
      streamId,
    });
  } catch (err) {
    runtime.error?.(`[wecom] Failed to send thinking message: ${String(err)}`);
  }
}

/**
 * 累积文本并判断是否有可见内容（去除 <think> 标签后）
 */
function accumulateText(state: MessageState, text: string): void {
  state.accumulatedText += text;
  if (!state.hasText && stripThinkTags(state.accumulatedText)) {
    state.hasText = true;
  }
}

/**
 * 上传并发送一批媒体文件（统一走主动发送通道）
 *
 * replyMedia（被动回复）无法覆盖 replyStream 发出的 thinking 流式消息，
 * 因此所有媒体统一走 aibot_send_msg 主动发送。
 */
async function sendMediaBatch(
  ctx: DeliverContext,
  mediaUrls: string[],
): Promise<void> {
  const { wsClient, frame, state, account, runtime } = ctx;
  const body = frame.body as MessageBody;
  const chatId = body.chatid || body.from.userid;
  const mediaLocalRoots = await getExtendedMediaLocalRoots(account.config);

  runtime.log?.(`[wecom][debug] mediaLocalRoots=${JSON.stringify(mediaLocalRoots)}, mediaUrls=${JSON.stringify(mediaUrls)}, hasText=${!!state.hasText}`);

  for (const mediaUrl of mediaUrls) {
    const result = await uploadAndSendMedia({
      wsClient,
      mediaUrl,
      chatId,
      mediaLocalRoots,
      log: (...args: any[]) => runtime.log?.(...args),
      errorLog: (...args: any[]) => runtime.error?.(...args),
    });

    if (result.ok) {
      state.hasMedia = true;
    } else {
      state.hasMediaFailed = true;
      runtime.error?.(`[wecom] Media send failed: url=${mediaUrl}, reason=${result.rejectReason || result.error}`);
      // 收集错误摘要，后续在 finishThinkingStream 中直接替换 thinking 流展示给用户
      const summary = buildMediaErrorSummary(mediaUrl, result);
      state.mediaErrorSummary = state.mediaErrorSummary
        ? `${state.mediaErrorSummary}\n\n${summary}`
        : summary;
    }
  }
}

/**
 * 关闭 thinking 流（发送 finish=true 的流式消息）
 *
 * thinking 是通过 replyStream 用 streamId 发的流式消息，
 * 只有同一 streamId 的 replyStream(finish=true) 才能关闭它。
 *
 * ⚠️ 注意：企微会忽略空格等不可见内容，必须用有可见字符的文案才能真正
 *    替换掉 thinking 动画，否则 thinking 会一直残留。
 *
 * 关闭策略（按优先级）：
 * 1. 有可见文本 → 用完整文本关闭
 * 2. 有媒体成功发送（通过 deliver 回调） → 用友好提示"文件已发送"
 * 3. 媒体发送失败 → 直接用错误摘要替换 thinking
 * 4. 其他 → 用通用"处理完成"提示
 *    （agent 可能已通过内置 message 工具直接发送了文件，
 *    该路径走 outbound.sendMedia 完全绕过 deliver 回调，
 *    所以 state 中无记录，但文件已实际送达）
 */
async function finishThinkingStream(ctx: DeliverContext): Promise<void> {
  const { wsClient, frame, state, runtime } = ctx;
  const visibleText = stripThinkTags(state.accumulatedText);

  let finishText: string;
  if (visibleText) {
    // 有可见文本：用完整文本关闭流（覆盖 thinking 为真实内容）
    finishText = state.accumulatedText;
  } else if (state.hasMedia) {
    // 媒体成功发送：用友好提示告知用户
    finishText = "📎 文件已发送，请查收。";
  } else if (state.hasMediaFailed && state.mediaErrorSummary) {
    // 媒体发送失败：直接用错误摘要替换 thinking 流（不再额外发 sendMessage）
    finishText = state.mediaErrorSummary;
  } else {
    // 核心无可见文本且 deliver 中未处理过媒体。
    //
    // 不使用错误提示，因为 agent 可能已通过内置 message 工具直接调用
    // outbound.sendMedia 成功发送了文件——该路径完全绕过 monitor 的 deliver
    // 回调，所以 state.deliverCalled / state.hasMedia 均为 false，但文件
    // 实际已送达用户。此时显示 "未生成回复" 会误导用户。
    finishText = "✅ 处理完成。";
  }

  await sendWeComReply({ wsClient, frame, text: finishText, runtime, finish: true, streamId: state.streamId });
}

/**
 * 路由消息到核心处理流程并处理回复
 */
async function routeAndDispatchMessage(params: {
  ctxPayload: ReturnType<typeof buildMessageContext>;
  config: OpenClawConfig;
  account: ResolvedWeComAccount;
  wsClient: WSClient;
  frame: WsFrame;
  state: MessageState;
  runtime: RuntimeEnv;
  onCleanup: () => void;
}): Promise<void> {
  const { ctxPayload, config, account, wsClient, frame, state, runtime, onCleanup } = params;
  const core = getWeComRuntime();
  const ctx: DeliverContext = { wsClient, frame, state, account, runtime };

  // 防止 onCleanup 被多次调用（onError 回调与 catch 块可能重复触发）
  let cleanedUp = false;
  const safeCleanup = () => {
    if (!cleanedUp) { cleanedUp = true; onCleanup(); }
  };

  try {
    await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: ctxPayload,
      cfg: config,
      dispatcherOptions: {
        deliver: async (payload, info) => {
          state.deliverCalled = true;
          runtime.log?.(`[openclaw -> plugin] kind=${info.kind}, text=${payload.text ?? ''}, mediaUrl=${payload.mediaUrl ?? ''}, mediaUrls=${JSON.stringify(payload.mediaUrls ?? [])}`);

          // 累积文本
          if (payload.text) {
            accumulateText(state, payload.text);
          }

          // 发送媒体（统一走主动发送）
          const mediaUrls = payload.mediaUrls?.length ? payload.mediaUrls : payload.mediaUrl ? [payload.mediaUrl] : [];
          if (mediaUrls.length > 0) {
            try {
              await sendMediaBatch(ctx, mediaUrls);
            } catch (mediaErr) {
              // sendMediaBatch 内部异常（如 getDefaultMediaLocalRoots 不可用等）
              // 必须标记 state，否则 finishThinkingStream 会显示"处理完成"误导用户
              state.hasMediaFailed = true;
              const errMsg = String(mediaErr);
              const summary = `⚠️ 文件发送失败：内部处理异常，请升级 openclaw 到最新版本后重试。\n错误详情：${errMsg}`;
              state.mediaErrorSummary = state.mediaErrorSummary
                ? `${state.mediaErrorSummary}\n\n${summary}`
                : summary;
              runtime.error?.(`[wecom] sendMediaBatch threw: ${errMsg}`);
            }
          }

          // 中间帧：有可见文本时流式更新
          if (info.kind !== "final" && state.hasText && state.accumulatedText) {
            await sendWeComReply({ wsClient, frame, text: state.accumulatedText, runtime, finish: false, streamId: state.streamId });
          }
        },
        onError: (err, info) => {
          runtime.error?.(`[wecom] ${info.kind} reply failed: ${String(err)}`);
        },
      },
    });

    // 关闭 thinking 流
    await finishThinkingStream(ctx);
    safeCleanup();
  } catch (err) {
    runtime.error?.(`[wecom][plugin] Failed to process message: ${String(err)}`);
    // 即使 dispatch 抛异常，也需要关闭 thinking 流，
    // 避免 deliver 已成功发送媒体但后续出错时 thinking 消息残留或被错误文案覆盖
    try {
      await finishThinkingStream(ctx);
    } catch (finishErr) {
      runtime.error?.(`[wecom] Failed to finish thinking stream after dispatch error: ${String(finishErr)}`);
    }
    safeCleanup();
  }
}

/**
 * 处理企业微信消息（主函数）
 *
 * 处理流程：
 * 1. 解析消息内容（文本、图片、引用）
 * 2. 群组策略检查（仅群聊）
 * 3. DM Policy 访问控制检查（仅私聊）
 * 4. 下载并保存图片
 * 5. 初始化消息状态
 * 6. 发送"思考中"消息
 * 7. 路由消息到核心处理流程
 *
 * 整体带超时保护，防止单条消息处理阻塞过久
 */
async function processWeComMessage(params: {
  frame: WsFrame;
  account: ResolvedWeComAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  wsClient: WSClient;
}): Promise<void> {
  const { frame, account, config, runtime, wsClient } = params;
  const body = frame.body as MessageBody;
  const chatId = body.chatid || body.from.userid;
  const chatType = body.chattype === "group" ? "group" : "direct";
  const messageId = body.msgid;
  const reqId = frame.headers.req_id;

  // Step 1: 解析消息内容
  const { textParts, imageUrls, imageAesKeys, fileUrls, fileAesKeys, quoteContent } = parseMessageContent(body);
  let text = textParts.join("\n").trim();

  // // 群聊中移除 @机器人 的提及标记
  // if (body.chattype === "group") {
  //   text = text.replace(/@\S+/g, "").trim();
  // }

  // 如果文本为空但存在引用消息，使用引用消息内容
  if (!text && quoteContent) {
    text = quoteContent;
    runtime.log?.("[wecom][plugin] Using quote content as message body (user only mentioned bot)");
  }

  // 如果既没有文本也没有图片也没有文件也没有引用内容，则跳过
  if (!text && imageUrls.length === 0 && fileUrls.length === 0) {
    runtime.log?.("[wecom][plugin] Skipping empty message (no text, image, file or quote)");
    return;
  }

  // Step 2: 群组策略检查（仅群聊）
  if (chatType === "group") {
    const groupPolicyResult = checkGroupPolicy({
      chatId,
      senderId: body.from.userid,
      account,
      config,
      runtime,
    });

    if (!groupPolicyResult.allowed) {
      return;
    }
  }

  // Step 3: DM Policy 访问控制检查（仅私聊）
  const dmPolicyResult = await checkDmPolicy({
    senderId: body.from.userid,
    isGroup: chatType === "group",
    account,
    wsClient,
    frame,
    runtime,
  });

  if (!dmPolicyResult.allowed) {
    return;
  }

  // Step 4: 下载并保存图片和文件
  const [imageMediaList, fileMediaList] = await Promise.all([
    downloadAndSaveImages({
      imageUrls,
      imageAesKeys,
      account,
      config,
      runtime,
      wsClient,
    }),
    downloadAndSaveFiles({
      fileUrls,
      fileAesKeys,
      account,
      config,
      runtime,
      wsClient,
    }),
  ]);
  const mediaList = [...imageMediaList, ...fileMediaList];

  // Step 5: 初始化消息状态
  setReqIdForChat(chatId, reqId, account.accountId);

  const streamId = generateReqId("stream");
  const state: MessageState = { accumulatedText: "", streamId };
  setMessageState(messageId, state);

  const cleanupState = () => {
    deleteMessageState(messageId);
  };

  // Step 6: 发送"思考中"消息
  const shouldSendThinking = account.sendThinkingMessage ?? true;
  if (shouldSendThinking) {
    await sendThinkingReply({ wsClient, frame, streamId, runtime });
  }

  // Step 7: 构建上下文并路由到核心处理流程（带整体超时保护）
  const ctxPayload = buildMessageContext(frame, account, config, text, mediaList, quoteContent);
  runtime.log?.(`[plugin -> openclaw] body=${text}, mediaPaths=${JSON.stringify(mediaList.map(m => m.path))}${quoteContent ? `, quote=${quoteContent}` : ''}`);

  try {
    await withTimeout(
      routeAndDispatchMessage({
        ctxPayload,
        config,
        account,
        wsClient,
        frame,
        state,
        runtime,
        onCleanup: cleanupState,
      }),
      MESSAGE_PROCESS_TIMEOUT_MS,
      `Message processing timed out (msgId=${messageId})`,
    );
  } catch (err) {
    runtime.error?.(`[wecom][plugin] Message processing failed or timed out: ${String(err)}`);
    // 确保 thinking 流被关闭，防止异常/超时时 thinking 消息一直残留
    try {
      if (shouldSendThinking) {
        await sendWeComReply({
          wsClient,
          frame,
          text: "处理消息时出现异常，请稍后重试。",
          runtime,
          finish: true,
          streamId: state.streamId,
        });
      }
    } catch (finishErr) {
      runtime.error?.(`[wecom] Failed to finish thinking stream on error: ${String(finishErr)}`);
    }
    cleanupState();
  }
}

// ============================================================================
// 创建 SDK Logger 适配器
// ============================================================================

/**
 * 创建适配 RuntimeEnv 的 Logger
 */
function createSdkLogger(runtime: RuntimeEnv, accountId: string): Logger {
  return {
    debug: (message: string, ...args: any[]) => {
      runtime.log?.(`[${accountId}] ${message}`, ...args);
    },
    info: (message: string, ...args: any[]) => {
      runtime.log?.(`[${accountId}] ${message}`, ...args);
    },
    warn: (message: string, ...args: any[]) => {
      runtime.log?.(`[${accountId}] WARN: ${message}`, ...args);
    },
    error: (message: string, ...args: any[]) => {
      runtime.error?.(`[${accountId}] ${message}`, ...args);
    },
  };
}

// ============================================================================
// 主函数
// ============================================================================

/**
 * 监听企业微信 WebSocket 连接
 * 使用 aibot-node-sdk 简化连接管理
 */
export async function monitorWeComProvider(options: WeComMonitorOptions): Promise<void> {
  const { account, config, runtime, abortSignal } = options;
  const EVENT_RECONNECT_COOLDOWN_MS = 5_000;

  runtime.log?.(`[${account.accountId}] Initializing WSClient with SDK...`);

  // 启动消息状态定期清理
  startMessageStateCleanup();

  return new Promise((resolve, reject) => {
    const logger = createSdkLogger(runtime, account.accountId);
    let lastEventReconnectAt = 0;
    let eventReconnectTimer: NodeJS.Timeout | null = null;

    const wsClient = new WSClient({
      botId: account.botId,
      secret: account.secret,
      wsUrl: account.websocketUrl,
      logger,
      heartbeatInterval: WS_HEARTBEAT_INTERVAL_MS,
      maxReconnectAttempts: WS_MAX_RECONNECT_ATTEMPTS,
    });

    // 清理函数：确保所有资源被释放
    const cleanup = async () => {
      if (eventReconnectTimer) {
        clearTimeout(eventReconnectTimer);
        eventReconnectTimer = null;
      }
      stopMessageStateCleanup();
      await cleanupAccount(account.accountId);
    };

    const scheduleReconnectForDisconnectedEvent = () => {
      if (eventReconnectTimer) {
        runtime.log?.(`[${account.accountId}] disconnected_event reconnect already scheduled`);
        return;
      }

      const now = Date.now();
      if (now - lastEventReconnectAt < EVENT_RECONNECT_COOLDOWN_MS) {
        runtime.log?.(
          `[${account.accountId}] disconnected_event reconnect suppressed by cooldown (${EVENT_RECONNECT_COOLDOWN_MS}ms)`,
        );
        return;
      }

      lastEventReconnectAt = now;
      eventReconnectTimer = setTimeout(() => {
        eventReconnectTimer = null;
        runtime.log?.(`[${account.accountId}] forcing reconnect after disconnected_event`);
        try {
          wsClient.connect();
        } catch (err) {
          runtime.error?.(
            `[${account.accountId}] forced reconnect after disconnected_event failed: ${String(err)}`,
          );
        }
      }, 0);
      eventReconnectTimer.unref?.();
    };

    // 处理中止信号
    if (abortSignal) {
      abortSignal.addEventListener("abort", async () => {
        runtime.log?.(`[${account.accountId}] Connection aborted`);
        await cleanup();
        resolve();
      });
    }

    // 监听连接事件
    wsClient.on("connected", () => {
      runtime.log?.(`[${account.accountId}] WebSocket connected`);
    });

    // 监听认证成功事件
    wsClient.on("authenticated", () => {
      runtime.log?.(`[${account.accountId}] Authentication successful`);
      setWeComWebSocket(account.accountId, wsClient);

      // 认证成功后自动拉取 MCP 配置（异步，失败不影响主流程）
      fetchAndSaveMcpConfig(wsClient, account.accountId, runtime);
    });

    // 监听断开事件
    wsClient.on("disconnected", (reason) => {
      runtime.log?.(`[${account.accountId}] WebSocket disconnected: ${reason}`);
    });

    // 监听重连事件
    wsClient.on("reconnecting", (attempt) => {
      runtime.log?.(`[${account.accountId}] Reconnecting attempt ${attempt}...`);
    });

    // 监听错误事件
    wsClient.on("error", (error) => {
      runtime.error?.(`[${account.accountId}] WebSocket error: ${error.message}`);
      // 认证失败时拒绝 Promise
      if (error.message.includes("Authentication failed")) {
        cleanup().finally(() => reject(error));
      }
    });

    // 监听所有消息
    wsClient.on("message", async (frame: WsFrame) => {
      const eventType = String((frame.body as { event?: { eventtype?: string } } | undefined)?.event?.eventtype ?? "")
        .trim()
        .toLowerCase();
      if (frame.cmd === "aibot_event_callback" && eventType === "disconnected_event") {
        runtime.log?.(`[${account.accountId}] received disconnected_event from wecom ws server`);
        scheduleReconnectForDisconnectedEvent();
        return;
      }
      try {
        await processWeComMessage({
          frame,
          account,
          config,
          runtime,
          wsClient,
        });
      } catch (err) {
        runtime.error?.(`[${account.accountId}] Failed to process message: ${String(err)}`);
      }
    });

    // 启动前预热 reqId 缓存，确保完成后再建立连接，避免 getSync 在预热完成前返回 undefined
    warmupReqIdStore(account.accountId, (...args) => runtime.log?.(...args))
      .then((count) => {
        runtime.log?.(`[${account.accountId}] Warmed up ${count} reqId entries from disk`);
      })
      .catch((err) => {
        runtime.error?.(`[${account.accountId}] Failed to warmup reqId store: ${String(err)}`);
      })
      .finally(() => {
        // 无论预热成功或失败，都建立连接
        wsClient.connect();
      });
  });
}
