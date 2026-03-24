import {
  type ChannelPlugin,
  type ChannelStatusIssue,
  type OpenClawConfig,
} from "openclaw/plugin-sdk";
import type { ChannelSetupWizard } from "openclaw/plugin-sdk/setup";
import {
  DEFAULT_ACCOUNT_ID,
  formatPairingApproveHint,
} from "openclaw/plugin-sdk/core";

import { getWeComRuntime } from "./runtime.js";
import { monitorWeComProvider } from "./monitor.js";
import { getWeComWebSocket } from "./state-manager.js";
import { wecomOnboardingAdapter } from "./onboarding.js";
import type { WeComConfig, ResolvedWeComAccount } from "./utils.js";
import { resolveWeComAccount } from "./utils.js";
import { CHANNEL_ID, TEXT_CHUNK_LIMIT } from "./const.js";
import { uploadAndSendMedia } from "./media-uploader.js";

/**
 * 使用 SDK 的 sendMessage 主动发送企业微信消息
 * 无需依赖 reqId，直接向指定会话推送消息
 */
async function sendWeComMessage({
                                  to,
                                  content,
                                  accountId,
                                }: {
  to: string;
  content: string;
  accountId?: string;
}): Promise<{ channel: string; messageId: string; chatId: string }> {
  const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;

  // 从 to 中提取 chatId（格式是 "${CHANNEL_ID}:chatId" 或直接是 chatId）
  const channelPrefix = new RegExp(`^${CHANNEL_ID}:`, "i");
  const chatId = to.replace(channelPrefix, "");

  // 获取 WSClient 实例
  const wsClient = getWeComWebSocket(resolvedAccountId);
  if (!wsClient) {
    throw new Error(`WSClient not connected for account ${resolvedAccountId}`);
  }

  // 使用 SDK 的 sendMessage 主动发送 markdown 消息
  const result = await wsClient.sendMessage(chatId, {
    msgtype: 'markdown',
    markdown: { content },
  });

  const messageId = result?.headers?.req_id ?? `wecom-${Date.now()}`;

  return {
    channel: CHANNEL_ID,
    messageId,
    chatId,
  };
}

// 企业微信频道元数据
const meta = {
  id: CHANNEL_ID,
  label: "企业微信",
  selectionLabel: "企业微信 (WeCom)",
  detailLabel: "企业微信智能机器人",
  docsPath: `/channels/${CHANNEL_ID}`,
  docsLabel: CHANNEL_ID,
  blurb: "企业微信智能机器人接入插件",
  systemImage: "message.fill",
};
export const wecomPlugin: ChannelPlugin<ResolvedWeComAccount> = {
  id: CHANNEL_ID,
  meta: {
    ...meta,
    quickstartAllowFrom: true,
  },
  pairing: {
    idLabel: "wecomUserId",
    normalizeAllowEntry: (entry) => entry.replace(new RegExp(`^(${CHANNEL_ID}|user):`, "i"), "").trim(),
    notifyApproval: async ({ cfg, id }) => {
      // sendWeComMessage({
      //   to: id,
      //   content: " pairing approved",
      //   accountId: cfg.accountId,
      // });
      // Pairing approved for user
    },
  },
  setupWizard: wecomOnboardingAdapter as unknown as ChannelSetupWizard,
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: {configPrefixes: [`channels.${CHANNEL_ID}`]},
  config: {
    // 列出所有账户 ID（最小实现只支持默认账户）
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],

    // 解析账户配置
    resolveAccount: (cfg) => resolveWeComAccount(cfg),

    // 获取默认账户 ID
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,

    // 设置账户启用状态
    setAccountEnabled: ({cfg, enabled}) => {
      const wecomConfig = (cfg.channels?.[CHANNEL_ID] ?? {}) as WeComConfig;
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          [CHANNEL_ID]: {
            ...wecomConfig,
            enabled,
          },
        },
      };
    },

    // 删除账户
    deleteAccount: ({cfg}) => {
      const wecomConfig = (cfg.channels?.[CHANNEL_ID] ?? {}) as WeComConfig;
      const {botId, secret, ...rest} = wecomConfig;
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          [CHANNEL_ID]: rest,
        },
      };
    },

    // 检查是否已配置
    isConfigured: (account) =>
      Boolean(account.botId?.trim() && account.secret?.trim()),

    // 描述账户信息
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.botId?.trim() && account.secret?.trim()),
      botId: account.botId,
      websocketUrl: account.websocketUrl,
    }),

    // 解析允许来源列表
    resolveAllowFrom: ({cfg}) => {
      const account = resolveWeComAccount(cfg);
      return (account.config.allowFrom ?? []).map((entry) => String(entry));
    },

    // 格式化允许来源列表
    formatAllowFrom: ({allowFrom}) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean),
  },
  security: {
    resolveDmPolicy: ({account}) => {
      const basePath = `channels.${CHANNEL_ID}.`;
      return {
        policy: account.config.dmPolicy ?? "open",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: formatPairingApproveHint(CHANNEL_ID),
        normalizeEntry: (raw) => raw.replace(new RegExp(`^${CHANNEL_ID}:`, "i"), "").trim(),
      };
    },
    collectWarnings: ({account, cfg}) => {
      const warnings: string[] = [];

      // DM 策略警告
      const dmPolicy = account.config.dmPolicy ?? "open";
      if (dmPolicy === "open") {
        const hasWildcard = (account.config.allowFrom ?? []).some(
          (entry) => String(entry).trim() === "*"
        );
        if (!hasWildcard) {
          warnings.push(
            `- 企业微信私信：dmPolicy="open" 但 allowFrom 未包含 "*"。任何人都可以发消息，但允许列表为空可能导致意外行为。建议设置 channels.${CHANNEL_ID}.allowFrom=["*"] 或使用 dmPolicy="pairing"。`,
          );
        }
      }

      // 群组策略警告
      const defaultGroupPolicy = cfg.channels?.defaults?.groupPolicy;
      const groupPolicy = account.config.groupPolicy ?? defaultGroupPolicy ?? "open"
      // const { groupPolicy } = resolveOpenProviderRuntimeGroupPolicy({
      //   providerConfigPresent: true,
      //   groupPolicy: account.config.groupPolicy,
      //   defaultGroupPolicy,
      // });
      if (groupPolicy === "open") {
        warnings.push(
          `- 企业微信群组：groupPolicy="open" 允许所有群组中的成员触发。设置 channels.${CHANNEL_ID}.groupPolicy="allowlist" + channels.${CHANNEL_ID}.groupAllowFrom 来限制群组。`,
        );
      }

      return warnings;
    },
  },
  messaging: {
    normalizeTarget: (target) => {
      const trimmed = target.trim();
      if (!trimmed) return undefined;
      return trimmed;
    },
    targetResolver: {
      looksLikeId: (id) => {
        const trimmed = id?.trim();
        return Boolean(trimmed);
      },
      hint: "<userId|groupId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async () => [],
    listGroups: async () => [],
  },
  outbound: {
    deliveryMode: "gateway",
    chunker: (text, limit) => getWeComRuntime().channel.text.chunkMarkdownText(text, limit),
    textChunkLimit: TEXT_CHUNK_LIMIT,
    sendText: async ({to, text, accountId}) => {
      return sendWeComMessage({to, content: text, accountId: accountId ?? undefined});
    },
    sendMedia: async ({to, text, mediaUrl, mediaLocalRoots, accountId}) => {
      const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;
      const channelPrefix = new RegExp(`^${CHANNEL_ID}:`, "i");
      const chatId = to.replace(channelPrefix, "");

      // 获取 WSClient 实例
      const wsClient = getWeComWebSocket(resolvedAccountId);
      if (!wsClient) {
        throw new Error(`WSClient not connected for account ${resolvedAccountId}`);
      }

      // 如果没有 mediaUrl，fallback 为纯文本
      if (!mediaUrl) {
        return sendWeComMessage({to, content: text || "", accountId: resolvedAccountId});
      }

      const result = await uploadAndSendMedia({
        wsClient,
        mediaUrl,
        chatId,
        mediaLocalRoots,
      });

      if (result.rejected) {
        return sendWeComMessage({to, content: `⚠️ ${result.rejectReason}`, accountId: resolvedAccountId});
      }

      if (!result.ok) {
        // 上传/发送失败，fallback 为文本 + URL
        const fallbackContent = text
          ? `${text}\n📎 ${mediaUrl}`
          : `📎 ${mediaUrl}`;
        return sendWeComMessage({to, content: fallbackContent, accountId: resolvedAccountId});
      }

      // 如有伴随文本，额外发送一条 markdown
      if (text) {
        await sendWeComMessage({to, content: text, accountId: resolvedAccountId});
      }

      // 如果有降级说明，额外发送提示
      if (result.downgradeNote) {
        await sendWeComMessage({to, content: `ℹ️ ${result.downgradeNote}`, accountId: resolvedAccountId});
      }

      return {
        channel: CHANNEL_ID,
        messageId: result.messageId!,
        chatId,
      };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: (accounts): ChannelStatusIssue[] =>
      accounts.flatMap((entry) => {
        const accountId = String(entry.accountId ?? DEFAULT_ACCOUNT_ID);
        const enabled = entry.enabled !== false;
        const configured = entry.configured === true;
        if (!enabled) {
          return [];
        }
        const issues: ChannelStatusIssue[] = [];
        if (!configured) {
          issues.push({
            channel: CHANNEL_ID,
            accountId,
            kind: "config",
            message: "企业微信机器人 ID 或 Secret 未配置",
            fix: "Run: openclaw channels add wecom --bot-id <id> --secret <secret>",
          });
        }
        return issues;
      }),
    buildChannelSummary: ({snapshot}) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
    probeAccount: async () => {
      return {ok: true, status: 200};
    },
    buildAccountSnapshot: ({account, runtime}) => {
      const configured = Boolean(
        account.botId?.trim() &&
        account.secret?.trim()
      );
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured,
        running: runtime?.running ?? false,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
      };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;

      // 启动 WebSocket 监听
      return monitorWeComProvider({
        account,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        setStatus: ctx.setStatus,
      });
    },
    logoutAccount: async ({cfg}) => {
      const nextCfg = {...cfg} as OpenClawConfig;
      const wecomConfig = (cfg.channels?.[CHANNEL_ID] ?? {}) as WeComConfig;
      const nextWecom = {...wecomConfig};
      let cleared = false;
      let changed = false;

      if (nextWecom.botId || nextWecom.secret) {
        delete nextWecom.botId;
        delete nextWecom.secret;
        cleared = true;
        changed = true;
      }

      if (changed) {
        if (Object.keys(nextWecom).length > 0) {
          nextCfg.channels = {...nextCfg.channels, [CHANNEL_ID]: nextWecom};
        } else {
          const nextChannels = {...nextCfg.channels};
          delete (nextChannels as Record<string, unknown>)[CHANNEL_ID];
          if (Object.keys(nextChannels).length > 0) {
            nextCfg.channels = nextChannels;
          } else {
            delete nextCfg.channels;
          }
        }
        await getWeComRuntime().config.writeConfigFile(nextCfg);
      }

      const resolved = resolveWeComAccount(changed ? nextCfg : cfg);
      const loggedOut = !resolved.botId && !resolved.secret;

      return {cleared, envToken: false, loggedOut};
    },
  },
};
