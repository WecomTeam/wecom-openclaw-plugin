/**
 * wecom_ask_user_question 工具 — AI Agent 通过企业微信交互式模板卡片主动向用户提问并等待回答。
 *
 * 流程（非阻塞 synthetic message 模式：工具立即返回 pending，答案随后以新消息到达）：
 * 1. AI 调用工具，传入 1-6 个问题（每个问题可带选项）
 * 2. 有选项的问题 → 逐个发送交互式模板卡片：
 *    - 单选且选项 ≤6：button_interaction（每个选项一个按钮）
 *    - 多选或选项 >6：vote_interaction（选择题 + 提交按钮）
 *    无选项的问题 → 企业微信模板卡片不支持文本输入控件，降级为普通 markdown 提问，
 *    用户直接回复文本即可（答案以普通消息形式到达，不做拦截）
 * 3. execute() 发送成功后立即返回 { status: "pending" }，并 abort 当前 Agent Run
 * 4. 用户点击按钮 / 提交选择 → template_card_event 回调
 * 5. handleWeComAskUserCardEvent 校验（归属 / TTL / 重复提交）并解析答案；
 *    多张卡片全部回答完成后，由调用方（monitor.ts）将回调体改写为答案文本，
 *    沿现有入站消息通道注入 Agent 新一轮对话
 *
 * 约束与限制：
 * - 卡片 task_id 格式：ask_user_<questionId>_q<questionIndex>（仅数字/字母/_-@，≤128 字节）
 * - 按钮 / 提交按钮 key 格式：wecom_ask_user:<questionId>:q<questionIndex>[:opt<optionIndex>]，
 *   同时充当通用交互分发的 event_key（命名空间 wecom_ask_user 由本工具优先消费）
 * - pending 注册表为内存态，进程重启后未回答的提问丢失（卡片仍可见，点击不再生效；如需跨重启可后续扩展持久化）
 * - Bot WebSocket 未连接时无法主动发卡，工具直接报错
 * - 过期卡片无法原地更新 UI（updateTemplateCard 需回调 frame 路由），
 *   TTL 到期时改为主动向会话推送一条过期提示消息
 * - 宿主 openclaw 未导出 abortAgentHarnessRun 时降级：不中止 Run，
 *   Run 自然结束，回答消息仍会到达（见 getAbortAgentHarnessRun 懒探测）
 */

import { randomUUID } from "node:crypto";
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
import { createNonExitingRuntime } from "openclaw/plugin-sdk/runtime-env";
import type { TemplateCard } from "@wecom/aibot-node-sdk";
import type { MessageBody } from "../message-parser.js";
import { CHANNEL_ID } from "../const.js";
import { DEFAULT_ACCOUNT_ID } from "../openclaw-compat.js";
import { getWeComWebSocket, getSessionChatInfo } from "../state-manager.js";
import { saveTemplateCardToCache } from "../template-card-manager.js";
import type { WeComInteractiveLogger } from "../interactive-dispatch.js";

// ============================================================================
// abortAgentHarnessRun 懒加载兼容探测
// ============================================================================

/**
 * abortAgentHarnessRun 在不同 openclaw 版本中位于不同子路径：
 * - 较新版本（2026.5.x+）：openclaw/plugin-sdk/agent-harness-runtime
 * - 较老版本（如 2026.4.x）：openclaw/plugin-sdk/agent-harness（abortEmbeddedPiRun 别名）
 *
 * 静态 import 任一子路径都会让插件在另一种版本的宿主上整体加载失败，
 * 因此运行时懒加载探测并缓存；两者都不可用时降级：不中止 Agent Run，
 * Run 自然结束，用户回答仍会以新消息到达本会话。
 */
type AbortAgentHarnessRunFn = (sessionId: string) => boolean;

let abortRunProbe: Promise<AbortAgentHarnessRunFn | undefined> | undefined;

function getAbortAgentHarnessRun(): Promise<AbortAgentHarnessRunFn | undefined> {
  if (!abortRunProbe) {
    abortRunProbe = (async () => {
      try {
        const sdk = await import("openclaw/plugin-sdk/agent-harness-runtime");
        if (typeof sdk.abortAgentHarnessRun === "function") {
          return sdk.abortAgentHarnessRun;
        }
      } catch {
        // 宿主 openclaw 无 agent-harness-runtime 子路径，尝试老路径
      }
      try {
        const sdk: unknown = await import("openclaw/plugin-sdk/agent-harness");
        const fn = (sdk as { abortAgentHarnessRun?: unknown }).abortAgentHarnessRun;
        if (typeof fn === "function") {
          return fn as AbortAgentHarnessRunFn;
        }
      } catch {
        // 宿主 openclaw 也无 agent-harness 子路径
      }
      return undefined;
    })();
  }
  return abortRunProbe;
}

// ============================================================================
// 常量
// ============================================================================

const TOOL_NAME = "wecom_ask_user_question";

/** 卡片 task_id 前缀（task_id 仅允许数字、字母和 _-@） */
const TASK_ID_PREFIX = "ask_user_";

/** 按钮 / 提交按钮 key 前缀（回调时作为 event_key 返回） */
const EVENT_KEY_PREFIX = "wecom_ask_user:";

/** pending 问题 TTL：5 分钟未回答自动过期 */
const PENDING_QUESTION_TTL_MS = 5 * 60 * 1000;

/** 单个问题最多选项数（上限 10；vote 卡片硬上限为 20） */
const MAX_OPTIONS_PER_QUESTION = 10;

/** 单次工具调用最多问题数 */
const MAX_QUESTIONS = 6;

/** button_interaction 卡片按钮数上限（企微硬上限 6） */
const BUTTON_CARD_MAX_OPTIONS = 6;

/** 按钮文案建议不超过 10 字，这里放宽到 26 字并截断，避免信息丢失过多 */
const MAX_OPTION_LABEL_CHARS = 26;

/** 供 saveTemplateCardToCache 使用的 RuntimeEnv（日志走 console） */
const toolRuntime = createNonExitingRuntime();

// ============================================================================
// 类型定义
// ============================================================================

interface AskUserOptionItem {
  label: string;
  description: string;
}

interface AskUserQuestionItem {
  question: string;
  header: string;
  options: AskUserOptionItem[];
  multiSelect: boolean;
}

/** 单个问题对应的已发送卡片 */
interface PendingQuestionCard {
  questionIndex: number;
  taskId: string;
  cardType: string;
}

interface PendingQuestionContext {
  questionId: string;
  accountId: string;
  chatId: string;
  chatType: "single" | "group";
  /** 被提问的用户 userid（群聊中仅该用户可回答） */
  senderUserId?: string;
  questions: AskUserQuestionItem[];
  /** 通过卡片提问的问题（需要等待回调回答） */
  cards: PendingQuestionCard[];
  /** questionIndex → 已收集的答案文本 */
  answers: Map<number, string>;
  submitted: boolean;
  createdAt: number;
  ttlTimer: ReturnType<typeof setTimeout>;
}

/** handleWeComAskUserCardEvent 的处理结果 */
export type AskUserCardEventOutcome =
  | { status: "answered"; answerText: string }
  | { status: "consumed"; reason: "expired_or_answered" | "not_owner" | "already_submitted" | "empty_selection" | "partial_answer" }
  | undefined;

// ============================================================================
// Pending 问题注册表（内存态）
// ============================================================================

const pendingQuestions = new Map<string, PendingQuestionContext>();

function armTtlTimer(ctx: PendingQuestionContext, delayMs: number): void {
  clearTimeout(ctx.ttlTimer);
  ctx.ttlTimer = setTimeout(() => {
    if (!pendingQuestions.has(ctx.questionId)) return;
    if (ctx.submitted) return;
    console.log(
      `[wecom][ask-user] question ${ctx.questionId} expired (TTL ${delayMs}ms)`,
    );
    consumePendingQuestion(ctx.questionId);
    // 过期卡片无法原地更新 UI（updateTemplateCard 需回调 frame 路由），
    // 改为主动推送一条过期提示消息，避免用户不知情地点击已失效的卡片
    setImmediate(() => {
      sendExpiredNotice(ctx).catch((err) => {
        console.error(`[wecom][ask-user] failed to send expired notice: ${String(err)}`);
      });
    });
  }, delayMs);
}

/** 构造过期提示文本（只列出尚未回答的卡片问题） */
function buildExpiredNoticeText(ctx: PendingQuestionContext): string {
  const unansweredHeaders = ctx.cards
    .filter((card) => !ctx.answers.has(card.questionIndex))
    .map((card) => {
      const question = ctx.questions[card.questionIndex];
      return question?.header?.trim() || `问题 ${card.questionIndex + 1}`;
    });
  const subject = unansweredHeaders.length > 0 ? unansweredHeaders.join("、") : "交互卡片提问";
  return [
    `⏱ **问题已过期**`,
    `提问「${subject}」未在规定时间内回答，已自动失效。如仍需要，请让我重新向你提问。`,
  ].join("\n");
}

/**
 * 问题过期后主动向会话推送过期提示消息。
 *
 * 过期卡片的 UI 无法原地更新（updateTemplateCard 需要回调 frame 路由），
 * 通过 wsClient.sendMessage 主动推送不依赖 frame，可以正常触达。
 * 尽力而为：WS 未连接或发送失败仅记录日志，不重试。
 */
async function sendExpiredNotice(ctx: PendingQuestionContext): Promise<void> {
  const wsClient = getWeComWebSocket(ctx.accountId);
  if (!wsClient?.isConnected) {
    console.log(
      `[wecom][ask-user] expired notice skipped: wsClient not connected (account=${ctx.accountId}, question=${ctx.questionId})`,
    );
    return;
  }
  await wsClient.sendMessage(ctx.chatId, {
    msgtype: "markdown",
    markdown: { content: buildExpiredNoticeText(ctx) },
  });
  console.log(
    `[wecom][ask-user] expired notice sent: question=${ctx.questionId}, chat=${ctx.chatId}`,
  );
}

function storePendingQuestion(init: Omit<PendingQuestionContext, "ttlTimer" | "answers" | "submitted" | "createdAt">): PendingQuestionContext {
  const ctx: PendingQuestionContext = {
    ...init,
    answers: new Map(),
    submitted: false,
    createdAt: Date.now(),
    ttlTimer: undefined as unknown as ReturnType<typeof setTimeout>,
  };
  pendingQuestions.set(ctx.questionId, ctx);
  armTtlTimer(ctx, PENDING_QUESTION_TTL_MS);
  return ctx;
}

function consumePendingQuestion(questionId: string): void {
  const ctx = pendingQuestions.get(questionId);
  if (!ctx) return;
  clearTimeout(ctx.ttlTimer);
  pendingQuestions.delete(questionId);
}

// ============================================================================
// 卡片构造
// ============================================================================

function buildTaskId(questionId: string, questionIndex: number): string {
  return `${TASK_ID_PREFIX}${questionId}_q${questionIndex}`;
}

function truncateLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length <= MAX_OPTION_LABEL_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_OPTION_LABEL_CHARS - 1)}…`;
}

/**
 * 为单个带选项的问题构造交互卡片：
 * - 单选且选项 ≤6 → button_interaction（点击即提交，回调 event_key 携带选项）
 * - 其余 → vote_interaction（选择题 + 提交按钮，回调 selected_items 携带选项）
 */
function buildAskUserCard(params: {
  questionId: string;
  questionIndex: number;
  question: AskUserQuestionItem;
}): TemplateCard {
  const { questionId, questionIndex, question } = params;
  const taskId = buildTaskId(questionId, questionIndex);
  const title = question.header?.trim() || "请回答";
  const desc = question.question.trim();

  if (!question.multiSelect && question.options.length <= BUTTON_CARD_MAX_OPTIONS) {
    return {
      card_type: "button_interaction",
      main_title: { title, desc },
      task_id: taskId,
      button_list: question.options.map((option, optionIndex) => ({
        text: truncateLabel(option.label),
        style: 1,
        key: `${EVENT_KEY_PREFIX}${questionId}:q${questionIndex}:opt${optionIndex}`,
      })),
    };
  }

  return {
    card_type: "vote_interaction",
    main_title: { title, desc },
    task_id: taskId,
    checkbox: {
      question_key: taskId,
      mode: question.multiSelect ? 1 : 0,
      option_list: question.options.map((option, optionIndex) => ({
        id: `opt${optionIndex}`,
        text: truncateLabel(option.label),
      })),
    },
    submit_button: {
      text: "提交",
      key: `${EVENT_KEY_PREFIX}${questionId}:q${questionIndex}`,
    },
  };
}

// ============================================================================
// 回调匹配与答案解析
// ============================================================================

/** 从 task_id 或 event_key 判断是否为 ask-user 卡片回调 */
function looksLikeAskUserEvent(taskId?: string, eventKey?: string): boolean {
  return Boolean(taskId?.startsWith(TASK_ID_PREFIX) || eventKey?.startsWith(EVENT_KEY_PREFIX));
}

interface AskUserEventMatch {
  ctx: PendingQuestionContext;
  questionIndex: number;
  kind: "button" | "submit";
  /** button 点击时解析出的选项下标 */
  buttonOptionIndex?: number;
}

/**
 * 将 template_card_event 与 pending 问题匹配：
 * 优先 task_id（ask_user_<questionId>_q<i>），其次 event_key 前缀。
 */
function matchAskUserEvent(body: MessageBody): AskUserEventMatch | undefined {
  const cardEvent = body.event?.template_card_event;
  const taskId = cardEvent?.task_id ?? "";
  const eventKey = cardEvent?.event_key ?? "";

  let questionId: string | undefined;
  let questionIndex: number | undefined;
  let kind: "button" | "submit" | undefined;
  let buttonOptionIndex: number | undefined;

  const taskMatch = /^ask_user_(.+)_q(\d+)$/.exec(taskId);
  if (taskMatch) {
    questionId = taskMatch[1];
    questionIndex = Number(taskMatch[2]);
  }

  if (eventKey.startsWith(EVENT_KEY_PREFIX)) {
    // wecom_ask_user:<questionId>:q<i>[:opt<n>]
    const parts = eventKey.slice(EVENT_KEY_PREFIX.length).split(":");
    const [keyQuestionId, qPart, optPart] = parts;
    const qMatch = /^q(\d+)$/.exec(qPart ?? "");
    if (keyQuestionId && qMatch) {
      questionId = questionId ?? keyQuestionId;
      questionIndex = questionIndex ?? Number(qMatch[1]);
      const optMatch = /^opt(\d+)$/.exec(optPart ?? "");
      if (optMatch) {
        kind = "button";
        buttonOptionIndex = Number(optMatch[1]);
      } else {
        kind = kind ?? "submit";
      }
    }
  }

  if (!questionId || questionIndex === undefined || Number.isNaN(questionIndex)) {
    return undefined;
  }

  const ctx = pendingQuestions.get(questionId);
  if (!ctx) return undefined;
  if (questionIndex >= ctx.questions.length) return undefined;

  // 无 event_key 信息时（仅 task_id），按卡片类型推断提交方式
  if (!kind) {
    const card = ctx.cards.find((c) => c.questionIndex === questionIndex);
    kind = card?.cardType === "button_interaction" ? "button" : "submit";
  }

  return { ctx, questionIndex, kind, buttonOptionIndex };
}

/** 将选项 id（opt<n>）映射为选项文案；未知 id 原样保留 */
function resolveOptionLabels(question: AskUserQuestionItem, optionIds: string[]): string[] {
  return optionIds.map((id) => {
    const optMatch = /^opt(\d+)$/.exec(id);
    if (optMatch) {
      const index = Number(optMatch[1]);
      const option = question.options[index];
      if (option) return option.label;
    }
    return id;
  });
}

/** 从回调中提取单个问题的答案文本；无法提取时返回 undefined */
function extractAnswer(match: AskUserEventMatch, body: MessageBody): string | undefined {
  const { ctx, questionIndex, kind, buttonOptionIndex } = match;
  const question = ctx.questions[questionIndex];

  if (kind === "button" && buttonOptionIndex !== undefined) {
    const option = question.options[buttonOptionIndex];
    return option ? option.label : undefined;
  }

  // submit：从 selected_items 中找本卡片 question_key（= task_id）对应的选项
  const taskId = buildTaskId(ctx.questionId, questionIndex);
  const selectedItems = body.event?.template_card_event?.selected_items?.selected_item ?? [];
  const target = selectedItems.find((item) => item.question_key === taskId);
  const optionIds = target?.option_ids?.option_id?.filter(Boolean) ?? [];
  if (optionIds.length === 0) return undefined;

  return resolveOptionLabels(question, optionIds).join(", ");
}

/** 汇总所有卡片答案为注入 Agent 的文本 */
function buildAnswerText(ctx: PendingQuestionContext): string {
  const lines: string[] = [];
  for (const card of ctx.cards) {
    const question = ctx.questions[card.questionIndex];
    const answer = ctx.answers.get(card.questionIndex);
    if (!answer) continue;
    const header = question.header?.trim() || question.question.trim();
    lines.push(`- ${header}: ${answer}`);
  }
  return [`用户回答了你的问题（通过企业微信交互卡片）:`, ...lines].join("\n");
}

// ============================================================================
// 卡片回调处理入口（供 monitor.ts / webhook/monitor.ts 调用）
// ============================================================================

/**
 * 处理 template_card_event 回调中的 ask-user 应答。
 *
 * @returns
 * - `{ status: "answered", answerText }`：所有卡片问题已回答完毕，
 *   调用方应更新卡片 UI 并把 answerText 注入 Agent（WS 模式下改写 frame.body 后走正常入站流程）；
 * - `{ status: "consumed", reason }`：本回调已被消费，不应再转发给 Agent
 *   （部分回答 / 过期 / 非提问人 / 重复提交 / 空选择）；
 * - `undefined`：非 ask-user 回调，调用方继续默认流程。
 */
export function handleWeComAskUserCardEvent(params: {
  accountId: string;
  body: MessageBody;
  runtime: WeComInteractiveLogger;
}): AskUserCardEventOutcome {
  const { accountId, body, runtime } = params;
  const cardEvent = body.event?.template_card_event;

  if (body.msgtype !== "event" || body.event?.eventtype !== "template_card_event" || !cardEvent) {
    return undefined;
  }

  if (!looksLikeAskUserEvent(cardEvent.task_id, cardEvent.event_key)) {
    return undefined;
  }

  const match = matchAskUserEvent(body);
  if (!match) {
    runtime.log?.(
      `[${accountId}] [ask-user] callback for unknown/expired question: task_id=${cardEvent.task_id ?? ""}, event_key=${cardEvent.event_key ?? ""}`,
    );
    return { status: "consumed", reason: "expired_or_answered" };
  }

  const { ctx, questionIndex } = match;
  const senderUserId = body.from?.userid;

  if (ctx.senderUserId && senderUserId && senderUserId !== ctx.senderUserId) {
    runtime.log?.(
      `[${accountId}] [ask-user] ignored click from non-owner: sender=${senderUserId}, owner=${ctx.senderUserId}`,
    );
    return { status: "consumed", reason: "not_owner" };
  }

  if (ctx.submitted) {
    return { status: "consumed", reason: "already_submitted" };
  }

  // 同一问题卡片重复回调（已收集过答案）→ 视为部分回答流程中的重复点击
  if (ctx.answers.has(questionIndex)) {
    return { status: "consumed", reason: "partial_answer" };
  }

  const answer = extractAnswer(match, body);
  if (!answer) {
    runtime.log?.(
      `[${accountId}] [ask-user] empty selection for question ${ctx.questionId} q${questionIndex}, keep pending`,
    );
    return { status: "consumed", reason: "empty_selection" };
  }

  ctx.answers.set(questionIndex, answer);
  runtime.log?.(
    `[${accountId}] [ask-user] collected answer for question ${ctx.questionId} q${questionIndex}: ${answer}`,
  );

  // 仍有卡片问题未回答 → 等待其余回调
  const allAnswered = ctx.cards.every((card) => ctx.answers.has(card.questionIndex));
  if (!allAnswered) {
    return { status: "consumed", reason: "partial_answer" };
  }

  ctx.submitted = true;
  consumePendingQuestion(ctx.questionId);

  return { status: "answered", answerText: buildAnswerText(ctx) };
}

// ============================================================================
// 工具注册
// ============================================================================

const ASK_USER_QUESTION_PARAMETERS = {
  type: "object" as const,
  properties: {
    questions: {
      type: "array" as const,
      description: `要向用户提问的问题列表（1-${MAX_QUESTIONS} 个）`,
      minItems: 1,
      maxItems: MAX_QUESTIONS,
      items: {
        type: "object" as const,
        properties: {
          question: { type: "string" as const, description: "完整问题内容" },
          header: { type: "string" as const, description: "问题短标题（建议不超过 12 个字，展示在卡片标题）" },
          options: {
            type: "array" as const,
            description:
              `可选项列表（最多 ${MAX_OPTIONS_PER_QUESTION} 个）。提供选项时渲染为交互式卡片；` +
              "留空（[]）时以普通文本消息提问，用户直接回复文本作答。",
            maxItems: MAX_OPTIONS_PER_QUESTION,
            items: {
              type: "object" as const,
              properties: {
                label: { type: "string" as const, description: "选项展示文案" },
                description: { type: "string" as const, description: "选项含义说明" },
              },
              required: ["label", "description"],
            },
          },
          multiSelect: {
            type: "boolean" as const,
            description: "是否允许多选（options 为空时忽略）",
          },
        },
        required: ["question", "header", "options", "multiSelect"],
      },
    },
  },
  required: ["questions"],
};

function formatToolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

function formatToolError(message: string) {
  return formatToolResult({ error: message });
}

/** 校验并归一化工具入参 */
function normalizeQuestions(params: unknown): { ok: true; questions: AskUserQuestionItem[] } | { ok: false; error: string } {
  const questions = (params as { questions?: unknown })?.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    return { ok: false, error: "questions 不能为空" };
  }
  if (questions.length > MAX_QUESTIONS) {
    return { ok: false, error: `一次最多提问 ${MAX_QUESTIONS} 个问题` };
  }

  const normalized: AskUserQuestionItem[] = [];
  for (let i = 0; i < questions.length; i++) {
    const raw = questions[i] as Partial<AskUserQuestionItem> | undefined;
    const question = raw?.question?.trim();
    if (!question) {
      return { ok: false, error: `questions[${i}].question 不能为空` };
    }
    const options: AskUserOptionItem[] = [];
    if (raw?.options !== undefined && !Array.isArray(raw.options)) {
      return { ok: false, error: `questions[${i}].options 必须是数组` };
    }
    for (const option of raw?.options ?? []) {
      const label = (option as { label?: unknown })?.label;
      if (typeof label !== "string" || !label.trim()) {
        return { ok: false, error: `questions[${i}].options 中存在缺少 label 的选项` };
      }
      options.push({
        label: label.trim(),
        description: String((option as { description?: unknown })?.description ?? "").trim(),
      });
    }
    if (options.length > MAX_OPTIONS_PER_QUESTION) {
      return { ok: false, error: `questions[${i}] 选项不能超过 ${MAX_OPTIONS_PER_QUESTION} 个` };
    }
    normalized.push({
      question,
      header: String(raw?.header ?? "").trim() || `问题 ${i + 1}`,
      options,
      multiSelect: Boolean(raw?.multiSelect),
    });
  }

  return { ok: true, questions: normalized };
}

export function registerWeComAskUserQuestionTool(api: OpenClawPluginApi): void {
  api.registerTool(
    (ctx: OpenClawPluginToolContext) => ({
      name: TOOL_NAME,
      label: "Ask User Question (WeCom)",
      description:
        "通过企业微信交互式卡片向用户提问。" +
        "发送成功后立即返回 pending 状态，用户的回答会作为后续消息到达本会话。" +
        "不要轮询或重复调用本工具——等待回答消息即可。" +
        "选择题请提供 options（渲染为按钮/投票卡片）；" +
        "开放式问题将 options 置为空数组（以普通文本提问，用户直接回复）。",
      parameters: ASK_USER_QUESTION_PARAMETERS,

      async execute(_toolCallId: string, params: unknown) {
        if (ctx.messageChannel !== CHANNEL_ID) {
          return formatToolError(`${TOOL_NAME} 仅支持在企业微信（${CHANNEL_ID}）会话中使用`);
        }

        const normalized = normalizeQuestions(params);
        if (!normalized.ok) {
          return formatToolError(normalized.error);
        }
        const questions = normalized.questions;

        const accountId = ctx.agentAccountId?.trim() || DEFAULT_ACCOUNT_ID;
        const sessionChat = getSessionChatInfo(ctx.sessionKey);
        const chatId = sessionChat?.chatId?.trim();
        if (!chatId) {
          return formatToolError("无法解析当前会话的企业微信 chatId（缺少 sessionKey → chatId 映射）");
        }

        const wsClient = getWeComWebSocket(accountId);
        if (!wsClient?.isConnected) {
          return formatToolError(
            "Bot WebSocket 未连接，无法主动发送交互卡片。ask-user 目前仅支持 Bot WebSocket 模式。",
          );
        }

        const questionId = randomUUID();
        const senderUserId = ctx.requesterSenderId?.trim() || undefined;
        const chatType: "single" | "group" = sessionChat?.chatType === "group" ? "group" : "single";
        console.log(
          `[wecom][ask-user] creating: id=${questionId}, questions=${questions.length}, chat=${chatId}, account=${accountId}`,
        );

        // ── 1. 发送交互卡片（有选项的问题，逐个发送，全部成功才登记 pending）──
        const cards: PendingQuestionCard[] = [];
        const builtCards: Array<{ questionIndex: number; card: TemplateCard }> = [];
        questions.forEach((question, questionIndex) => {
          if (question.options.length === 0) return;
          builtCards.push({
            questionIndex,
            card: buildAskUserCard({ questionId, questionIndex, question }),
          });
        });

        for (const { questionIndex, card } of builtCards) {
          try {
            await wsClient.sendMessage(chatId, {
              msgtype: "template_card",
              template_card: card,
            });
            saveTemplateCardToCache({ accountId, templateCard: card, runtime: toolRuntime });
            cards.push({
              questionIndex,
              taskId: card.task_id ?? buildTaskId(questionId, questionIndex),
              cardType: card.card_type,
            });
          } catch (err) {
            console.error(`[wecom][ask-user] failed to send card q${questionIndex}: ${String(err)}`);
            return formatToolError(`发送提问卡片失败: ${String(err)}`);
          }
        }

        // ── 2. 无选项的问题降级为普通 markdown 提问（答案以普通消息到达）──
        let textQuestionCount = 0;
        for (const [questionIndex, question] of questions.entries()) {
          if (question.options.length > 0) continue;
          try {
            await wsClient.sendMessage(chatId, {
              msgtype: "markdown",
              markdown: { content: question.question },
            });
            textQuestionCount++;
          } catch (err) {
            console.error(`[wecom][ask-user] failed to send text question q${questionIndex}: ${String(err)}`);
          }
        }

        // ── 3. 登记 pending（等待卡片回调）──
        if (cards.length > 0) {
          storePendingQuestion({
            questionId,
            accountId,
            chatId,
            chatType,
            senderUserId,
            questions,
            cards,
          });
        }
        console.log(
          `[wecom][ask-user] question ${questionId} sent: cards=${cards.length}, textQuestions=${textQuestionCount}`,
        );

        // ── 4. abort 当前 Agent Run（pending 工具结果不会挂起 Run，需显式中止）──
        const sessionId = ctx.sessionId?.trim();
        setImmediate(async () => {
          if (!sessionId) return;
          const abortRun = await getAbortAgentHarnessRun();
          if (!abortRun) {
            console.error(
              `[wecom][ask-user] abortAgentHarnessRun unavailable (host openclaw exports neither agent-harness-runtime nor agent-harness), degraded: Agent Run ends naturally, answer still arrives. session=${sessionId}`,
            );
            return;
          }
          try {
            if (!abortRun(sessionId)) {
              console.error(`[wecom][ask-user] abort Agent Run failed: session=${sessionId}, reason=no_active_run`);
            }
          } catch (err) {
            console.error(`[wecom][ask-user] abort Agent Run error: session=${sessionId}, error=${String(err)}`);
          }
        });

        // ── 5. 立即返回 pending，答案随后以新消息到达 ──
        return formatToolResult({
          status: "pending",
          questionId,
          message:
            cards.length > 0
              ? "提问卡片已发送给用户。用户的回答将作为后续消息到达本会话，请勿重复调用本工具，等待回答消息即可。"
              : "提问已发送给用户（纯文本问题）。用户将直接回复文本，答案会以普通消息到达，请等待。",
        });
      },
    }),
    { name: TOOL_NAME },
  );
}

/** @internal 测试专用：暴露内部状态与构造函数（对齐 chat-queue 的 _resetChatQueueState 模式） */
export const _testing = {
  storePendingQuestion,
  consumePendingQuestion,
  buildAskUserCard,
  buildTaskId,
  buildExpiredNoticeText,
  sendExpiredNotice,
  resetState: (): void => {
    for (const questionId of [...pendingQuestions.keys()]) {
      consumePendingQuestion(questionId);
    }
  },
};
