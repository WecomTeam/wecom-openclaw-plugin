/**
 * 企业微信公共工具函数
 */

import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  listConfiguredAccountIds as listConfiguredAccountIdsFromSection,
  resolveAccountWithDefaultFallback,
} from "openclaw/plugin-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { CHANNEL_ID } from "./const.js";

// ============================================================================
// 配置类型定义
// ============================================================================

/**
 * 企业微信群组配置
 */
export interface WeComGroupConfig {
  /** 群组内发送者白名单（仅列表中的成员消息会被处理） */
  allowFrom?: Array<string | number>;
}

/**
 * 企业微信单账户配置（可作为 channel 基础配置或 accounts 子项）
 */
export interface WeComAccountConfig {
  enabled?: boolean;
  websocketUrl?: string;
  botId?: string;
  secret?: string;
  name?: string;
  allowFrom?: Array<string | number>;
  dmPolicy?: "open" | "allowlist" | "pairing" | "disabled";
  /** 群组访问策略："open" = 允许所有群组（默认），"allowlist" = 仅允许 groupAllowFrom 中的群组，"disabled" = 禁用群组消息 */
  groupPolicy?: "open" | "allowlist" | "disabled";
  /** 群组白名单（仅 groupPolicy="allowlist" 时生效） */
  groupAllowFrom?: Array<string | number>;
  /** 每个群组的详细配置（如群组内发送者白名单） */
  groups?: Record<string, WeComGroupConfig>;
  /** 是否发送"思考中"消息，默认为 true */
  sendThinkingMessage?: boolean;
}

/**
 * 企业微信 channel 配置（支持多账户）
 */
export type WeComConfig = {
  /** 多账户配置 */
  accounts?: Record<string, WeComAccountConfig>;
  /** 多账户时的默认账户 ID */
  defaultAccount?: string;
} & WeComAccountConfig;

export const DefaultWsUrl = "wss://openws.work.weixin.qq.com";

export interface ResolvedWeComAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  websocketUrl: string;
  botId: string;
  secret: string;
  /** 是否发送"思考中"消息，默认为 true */
  sendThinkingMessage: boolean;
  config: WeComAccountConfig;
}

// ============================================================================
// 多账户解析
// ============================================================================

/**
 * 列出所有已配置的 account ID
 */
export function listWeComAccountIds(cfg: OpenClawConfig): string[] {
  const wecomConfig = (cfg.channels?.[CHANNEL_ID] ?? {}) as WeComConfig;
  const ids = listConfiguredAccountIdsFromSection({
    accounts: wecomConfig.accounts,
    normalizeAccountId,
  });
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return ids.toSorted((a, b) => a.localeCompare(b));
}

/**
 * 解析默认 account ID
 */
export function resolveDefaultWeComAccountId(cfg: OpenClawConfig): string {
  const wecomConfig = (cfg.channels?.[CHANNEL_ID] ?? {}) as WeComConfig;
  if (wecomConfig.defaultAccount) {
    const preferred = normalizeAccountId(wecomConfig.defaultAccount);
    const ids = listWeComAccountIds(cfg);
    if (ids.some((id) => normalizeAccountId(id) === preferred)) {
      return preferred;
    }
  }
  const ids = listWeComAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

/**
 * 合并 channel 级别基础配置与 account 级别配置
 */
function mergeWeComAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): WeComAccountConfig {
  const wecomConfig = (cfg.channels?.[CHANNEL_ID] ?? {}) as WeComConfig;
  const {
    accounts: _ignored,
    defaultAccount: _ignoredDefault,
    groups: channelGroups,
    ...base
  } = wecomConfig;

  const normalized = normalizeAccountId(accountId);
  const accountConfig = wecomConfig.accounts?.[normalized] ??
    Object.entries(wecomConfig.accounts ?? {}).find(
      ([key]) => normalizeAccountId(key) === normalized,
    )?.[1] ?? {};

  // 多账户时，channel 级别的 groups 不继承到没有自己 groups 的 account
  const configuredAccountIds = Object.keys(wecomConfig.accounts ?? {});
  const isMultiAccount = configuredAccountIds.length > 1;
  const groups = accountConfig.groups ?? (isMultiAccount ? undefined : channelGroups);

  return { ...base, ...accountConfig, groups };
}

/**
 * 解析企业微信账户配置（支持多账户）
 */
export function resolveWeComAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedWeComAccount {
  const baseEnabled = (cfg.channels?.[CHANNEL_ID] as WeComConfig)?.enabled !== false;

  const resolve = (id: string): ResolvedWeComAccount => {
    const merged = mergeWeComAccountConfig(cfg, id);
    const accountEnabled = merged.enabled !== false;
    const enabled = baseEnabled && accountEnabled;

    return {
      accountId: id,
      name: merged.name ?? "企业微信",
      enabled,
      websocketUrl: merged.websocketUrl || DefaultWsUrl,
      botId: merged.botId ?? "",
      secret: merged.secret ?? "",
      sendThinkingMessage: merged.sendThinkingMessage ?? true,
      config: merged,
    };
  };

  return resolveAccountWithDefaultFallback({
    accountId,
    normalizeAccountId,
    resolvePrimary: resolve,
    hasCredential: (account) => Boolean(account.botId?.trim() && account.secret?.trim()),
    resolveDefaultAccountId: () => resolveDefaultWeComAccountId(cfg),
  });
}

/**
 * 列出所有已启用的账户
 */
export function listEnabledWeComAccounts(cfg: OpenClawConfig): ResolvedWeComAccount[] {
  return listWeComAccountIds(cfg)
    .map((id) => resolveWeComAccount(cfg, id))
    .filter((account) => account.enabled);
}

// ============================================================================
// 配置写入
// ============================================================================

/**
 * 设置企业微信账户配置（向后兼容单账户模式）
 */
export function setWeComAccount(
  cfg: OpenClawConfig,
  account: Partial<WeComAccountConfig>,
  accountId?: string,
): OpenClawConfig {
  const wecomConfig = (cfg.channels?.[CHANNEL_ID] ?? {}) as WeComConfig;
  const hasMultiAccounts = wecomConfig.accounts && Object.keys(wecomConfig.accounts).length > 0;
  const targetAccountId = accountId ? normalizeAccountId(accountId) : undefined;

  // 多账户模式：写入到 accounts[accountId]
  if (hasMultiAccounts && targetAccountId) {
    const existingAccount = wecomConfig.accounts?.[targetAccountId] ?? {};
    const merged: WeComAccountConfig = {
      ...existingAccount,
      ...filterUndefined(account),
    };
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        [CHANNEL_ID]: {
          ...wecomConfig,
          accounts: {
            ...wecomConfig.accounts,
            [targetAccountId]: merged,
          },
        },
      },
    };
  }

  // 单账户模式：写入到 channel 顶层
  const existing = wecomConfig;
  const merged: WeComAccountConfig = {
    enabled: account.enabled ?? existing?.enabled ?? true,
    botId: account.botId ?? existing?.botId ?? "",
    secret: account.secret ?? existing?.secret ?? "",
    allowFrom: account.allowFrom ?? existing?.allowFrom,
    dmPolicy: account.dmPolicy ?? existing?.dmPolicy,
    ...(account.websocketUrl || existing?.websocketUrl
      ? { websocketUrl: account.websocketUrl ?? existing?.websocketUrl }
      : {}),
    ...(account.name || existing?.name
      ? { name: account.name ?? existing?.name }
      : {}),
    ...(account.sendThinkingMessage !== undefined || existing?.sendThinkingMessage !== undefined
      ? { sendThinkingMessage: account.sendThinkingMessage ?? existing?.sendThinkingMessage }
      : {}),
  };

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [CHANNEL_ID]: {
        ...wecomConfig,
        // Preserve accounts and defaultAccount if they exist
        ...(wecomConfig.accounts ? { accounts: wecomConfig.accounts } : {}),
        ...(wecomConfig.defaultAccount ? { defaultAccount: wecomConfig.defaultAccount } : {}),
        ...merged,
      },
    },
  };
}

function filterUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as Partial<T>;
}
