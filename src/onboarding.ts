/**
 * 企业微信 setupWizard — 声明式 CLI setup wizard 配置。
 *
 * 框架通过 plugin.setupWizard 字段识别并驱动 channel 的引导配置流程。
 */

import type { ChannelSetupWizard, ChannelSetupDmPolicy } from "openclaw/plugin-sdk/setup";
import type { ChannelSetupAdapter } from "openclaw/plugin-sdk/setup";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { addWildcardAllowFrom } from "./openclaw-compat.js";
import type { WeComConfig } from "./utils.js";
import { resolveWeComAccountMulti, setWeComAccountMulti } from "./accounts.js";
import { CHANNEL_ID } from "./const.js";

// ============================================================================
// ChannelSetupAdapter — 框架用于应用配置输入的适配器
// ============================================================================

export const wecomSetupAdapter: ChannelSetupAdapter = {
  applyAccountConfig: ({ cfg, input, accountId }) => {
    const patch: Partial<WeComConfig> = {};

        if (input.token !== undefined) {
      patch.botId = String(input.token).trim();
    }
    if (input.privateKey !== undefined || input.secret !== undefined) {
      patch.secret = String(input.privateKey || input.secret).trim();
    }
    if (input.dmPolicy !== undefined) {
      patch.dmPolicy = (input.dmPolicy as any);
    }
    if (input.dmAllowlist !== undefined) {
      patch.allowFrom = Array.isArray(input.dmAllowlist)
        ? (input.dmAllowlist as any)
        : String(input.dmAllowlist)
            .split(/[,;]+/)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    if (input.name !== undefined) {
      patch.name = String(input.name).trim();
    }

    // 如果是首次配置，默认启用
    const account = resolveWeComAccountMulti({ cfg, accountId });
    if (!account.botId && !account.secret) {
      patch.enabled = true;
    }

    return setWeComAccountMulti(cfg, patch, accountId);
  },
};

// ============================================================================
// DM Policy 配置
// ============================================================================

/**
 * 设置企业微信 dmPolicy
 */
function setWeComDmPolicy(
  cfg: OpenClawConfig,
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled",
  accountId?: string,
): OpenClawConfig {
  const account = resolveWeComAccountMulti({ cfg, accountId });
  const existingAllowFrom = account.config.allowFrom ?? [];
  const allowFrom =
    dmPolicy === "open"
      ? addWildcardAllowFrom(existingAllowFrom.map((x) => String(x)))
      : existingAllowFrom.map((x) => String(x));

  return setWeComAccountMulti(cfg, { accountId,
    dmPolicy,
    allowFrom,
  });
}

const dmPolicy: ChannelSetupDmPolicy = {
  label: "企业微信",
  channel: CHANNEL_ID,
  policyKey: `channels.${CHANNEL_ID}.dmPolicy`,
  allowFromKey: `channels.${CHANNEL_ID}.allowFrom`,
  getCurrent: ({ cfg, accountId }) => {
    const account = resolveWeComAccountMulti({ cfg, accountId });
    return (account.config.dmPolicy as any) ?? "open";
  },
  setPolicy: ({ cfg, policy, accountId }) => {
    return setWeComDmPolicy(cfg, policy, accountId);
  },
  promptAllowFrom: async ({ cfg, prompter, accountId }) => {
    const account = resolveWeComAccountMulti({ cfg, accountId });
    const existingAllowFrom = account.config.allowFrom ?? [];

    const entry = await prompter.text({
      message: "企业微信允许来源（用户ID或群组ID，逗号分隔）",
      placeholder: "user123, group456",
      initialValue: existingAllowFrom[0] ? String(existingAllowFrom[0]) : undefined,
    });

    const allowFrom = String(entry ?? "")
      .split(/[\n,;]+/g)
      .map((s) => s.trim())
      .filter(Boolean);

    return setWeComAccountMulti(cfg, { accountId, allowFrom });
  },
};

// ============================================================================
// ChannelSetupWizard — 声明式 setup wizard 配置
// ============================================================================

export const wecomSetupWizard: ChannelSetupWizard = {
  channel: CHANNEL_ID,

  // ── 状态 ──────────────────────────────────────────────────────────────
  status: {
    configuredLabel: "已配置 ✓",
    unconfiguredLabel: "需要 Bot ID 和 Secret",
    configuredHint: "已配置",
    unconfiguredHint: "需要设置",
    resolveConfigured: ({ cfg, accountId }) => {
      const account = resolveWeComAccountMulti({ cfg, accountId });
      return Boolean(account.botId?.trim() && account.secret?.trim());
    },
    resolveStatusLines: ({ cfg, configured, accountId }) => {
      return [`企业微信: ${configured ? "已配置" : "需要 Bot ID 和 Secret"}`];
    },
  },

  // ── 引导说明 ──────────────────────────────────────────────────────────
  introNote: {
    title: "企业微信设置",
    lines: [
      "企业微信机器人需要以下配置信息：",
      "1. Bot ID: 企业微信机器人 ID",
      "2. Secret: 企业微信机器人密钥",
    ],
    shouldShow: ({ cfg, accountId }) => {
      const account = resolveWeComAccountMulti({ cfg, accountId });
      return !account.botId?.trim() || !account.secret?.trim();
    },
  },

  // ── 凭据输入 ──────────────────────────────────────────────────────────
  credentials: [
    {
      inputKey: "token",
      providerHint: "企业微信",
      credentialLabel: "Bot ID",
      envPrompt: "使用环境变量中的 Bot ID？",
      keepPrompt: "Bot ID 已配置，保留当前值？",
      inputPrompt: "企业微信机器人 Bot ID",
      inspect: ({ cfg, accountId }) => {
        const account = resolveWeComAccountMulti({ cfg, accountId });
        const hasValue = Boolean(account.botId?.trim());
        return {
          accountConfigured: hasValue,
          hasConfiguredValue: hasValue,
          resolvedValue: account.botId || undefined,
        };
      },
      applySet: ({ cfg, resolvedValue, accountId }) => {
        return setWeComAccountMulti(cfg, { accountId, botId: resolvedValue });
      },
    },
    {
      inputKey: "privateKey",
      providerHint: "企业微信",
      credentialLabel: "Secret",
      envPrompt: "使用环境变量中的 Secret？",
      keepPrompt: "Secret 已配置，保留当前值？",
      inputPrompt: "企业微信机器人 Secret",
      inspect: ({ cfg, accountId }) => {
        const account = resolveWeComAccountMulti({ cfg, accountId });
        const hasValue = Boolean(account.secret?.trim());
        return {
          accountConfigured: hasValue,
          hasConfiguredValue: hasValue,
          resolvedValue: account.secret || undefined,
        };
      },
      applySet: ({ cfg, resolvedValue, accountId }) => {
        return setWeComAccountMulti(cfg, { accountId, secret: resolvedValue });
      },
    },
  ],

  // ── 完成后的最终处理 ──────────────────────────────────────────────────
  finalize: async ({ cfg, accountId }) => {
    // 确保配置完成后 channel 处于启用状态
    const account = resolveWeComAccountMulti({ cfg, accountId });
    if (account.botId?.trim() && account.secret?.trim() && !account.enabled) {
      return { cfg: setWeComAccountMulti(cfg, { accountId, enabled: true }) };
    }
    return undefined;
  },

  // ── 完成提示 ──────────────────────────────────────────────────────────
  completionNote: {
    title: "企业微信配置完成",
    lines: [
      "企业微信机器人已配置完成。",
      "运行 `openclaw start` 启动服务。",
    ],
    shouldShow: ({ cfg, accountId }) => {
      const account = resolveWeComAccountMulti({ cfg, accountId });
      return Boolean(account.botId?.trim() && account.secret?.trim());
    },
  },

  // ── DM 策略 ──────────────────────────────────────────────────────────
  dmPolicy,

  // ── 禁用 ─────────────────────────────────────────────────────────────
  disable: (cfg) => {
    return setWeComAccountMulti(cfg, { accountId, enabled: false });
  },
};
