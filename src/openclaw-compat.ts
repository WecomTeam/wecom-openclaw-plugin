import * as path from "node:path";
import { resolveStateDir } from "./state-dir-resolve.js";
export { resolveStateDir };
export { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
export { emptyPluginConfigSchema } from "openclaw/plugin-sdk/core";
export { addWildcardAllowFrom } from "openclaw/plugin-sdk/setup";

/** Existing WeCom local-media allowlist; the SDK enforces these roots when reading. */
export async function getDefaultMediaLocalRoots(): Promise<readonly string[]> {
  const stateDir = path.resolve(resolveStateDir());
  return [
    path.join(stateDir, "media"),
    path.join(stateDir, "agents"),
    path.join(stateDir, "workspace"),
    path.join(stateDir, "sandboxes"),
  ];
}

// ============================================================================
// 辅助函数（参考 moltbot 实现）
// ============================================================================

/**
 * 解析可选的分隔条目
 * @param value 输入字符串，支持逗号、分号、换行符分隔
 * @returns 解析后的字符串数组，如果输入为空则返回 undefined
 */
export function parseOptionalDelimitedEntries(value?: string): string[] | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = value
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
}

/**
 * 构建账户范围的 DM 安全策略
 */
export function buildAccountScopedDmSecurityPolicy(params: {
  cfg: Record<string, unknown>;
  channelKey: string;
  accountId?: string | null;
  fallbackAccountId?: string | null;
  policy?: string | null;
  allowFrom?: Array<string | number> | null;
  defaultPolicy?: string;
  allowFromPathSuffix?: string;
  policyPathSuffix?: string;
  approveChannelId?: string;
  approveHint?: string;
  normalizeEntry?: (raw: string) => string;
}): {
  policy: string;
  allowFrom: Array<string | number>;
  policyPath?: string;
  allowFromPath: string;
  approveHint: string;
  normalizeEntry?: (raw: string) => string;
} {
  const DEFAULT_ACCOUNT_ID = "default";
  const resolvedAccountId = params.accountId ?? params.fallbackAccountId ?? DEFAULT_ACCOUNT_ID;
  const channelConfig = (params.cfg.channels as Record<string, unknown> | undefined)?.[
    params.channelKey
  ] as { accounts?: Record<string, unknown> } | undefined;
  const useAccountPath = Boolean(channelConfig?.accounts?.[resolvedAccountId]);
  const basePath = useAccountPath
    ? `channels.${params.channelKey}.accounts.${resolvedAccountId}.`
    : `channels.${params.channelKey}.`;
  const allowFromPath = `${basePath}${params.allowFromPathSuffix ?? ""}`;
  const policyPath =
    params.policyPathSuffix != null ? `${basePath}${params.policyPathSuffix}` : undefined;

  return {
    policy: params.policy ?? params.defaultPolicy ?? "pairing",
    allowFrom: params.allowFrom ?? [],
    policyPath,
    allowFromPath,
    approveHint:
      params.approveHint ?? formatPairingApproveHint(params.approveChannelId ?? params.channelKey),
    normalizeEntry: params.normalizeEntry,
  };
}

/**
 * 格式化配对审批提示信息（参考 moltbot 实现）
 * @param channelId 频道ID
 * @returns 配对审批提示字符串
 */
export function formatPairingApproveHint(channelId: string): string {
  const listCmd = `openclaw pairing list ${channelId}`;
  const approveCmd = `openclaw pairing approve ${channelId} <code>`;
  return `向 ${channelId} 机器人发送消息以完成配对审批（命令行：${listCmd} / ${approveCmd}）`;
}

// ============================================================================
// buildAccountScopedDmSecurityPolicy —— DM 安全策略构建（多账号支持）
// ============================================================================

/**
 * 与 openclaw plugin-sdk/channel-policy 中 ChannelSecurityDmPolicy 兼容的类型。
 * 低版本 SDK 未导出该方法时，使用此 fallback。
 */
export type ChannelSecurityDmPolicyCompat = {
  policy: string;
  allowFrom?: Array<string | number> | null;
  policyPath?: string;
  allowFromPath: string;
  approveHint: string;
  normalizeEntry?: (raw: string) => string;
};

// 确保与 SDK 的 ChannelSecurityDmPolicy 类型兼容
declare global {
  namespace openclaw.plugin.sdk {
    interface ChannelSecurityDmPolicy {
      policy: string;
      allowFrom?: Array<string | number> | null;
      policyPath?: string;
      allowFromPath: string;
      approveHint: string;
      normalizeEntry?: (raw: string) => string;
    }
  }
}

export type BuildAccountScopedDmSecurityPolicyParams = {
  cfg: { channels?: Record<string, unknown> };
  channelKey: string;
  accountId?: string | null;
  fallbackAccountId?: string | null;
  policy?: string | null;
  allowFrom?: Array<string | number> | null;
  defaultPolicy?: string;
  allowFromPathSuffix?: string;
  policyPathSuffix?: string;
  approveChannelId?: string;
  approveHint?: string;
  normalizeEntry?: (raw: string) => string;
};

/**
 * fallback 实现：构建多账号作用域的 DM 安全策略对象。
 *
 * 逻辑与 openclaw/plugin-sdk/channel-policy 中的
 * buildAccountScopedDmSecurityPolicy 完全一致。
 */
function buildAccountScopedDmSecurityPolicyFallback(
  params: BuildAccountScopedDmSecurityPolicyParams,
): ChannelSecurityDmPolicyCompat {
  const DEFAULT_ACCOUNT = "default";
  const resolvedAccountId =
    params.accountId ?? params.fallbackAccountId ?? DEFAULT_ACCOUNT;

  const channelConfig = (params.cfg.channels as Record<string, unknown> | undefined)?.[
    params.channelKey
  ] as { accounts?: Record<string, unknown> } | undefined;

  const useAccountPath = Boolean(channelConfig?.accounts?.[resolvedAccountId]);
  const basePath = useAccountPath
    ? `channels.${params.channelKey}.accounts.${resolvedAccountId}.`
    : `channels.${params.channelKey}.`;

  const allowFromPath = `${basePath}${params.allowFromPathSuffix ?? ""}`;
  const policyPath =
    params.policyPathSuffix != null
      ? `${basePath}${params.policyPathSuffix}`
      : undefined;

  // 构建 approveHint 的简化版本（不依赖 formatCliCommand）
  const channelId = params.approveChannelId ?? params.channelKey;
  const defaultApproveHint =
    `Approve via: openclaw pairing list ${channelId} / openclaw pairing approve ${channelId} <code>`;

  return {
    policy: params.policy ?? params.defaultPolicy ?? "pairing",
    allowFrom: params.allowFrom ?? [],
    policyPath,
    allowFromPath,
    approveHint: params.approveHint ?? defaultApproveHint,
    normalizeEntry: params.normalizeEntry,
  };
}

// 一次性探测 SDK 是否导出了 buildAccountScopedDmSecurityPolicy
const _sdkPolicyReady: Promise<{
  buildAccountScopedDmSecurityPolicy?: (
    params: BuildAccountScopedDmSecurityPolicyParams,
  ) => ChannelSecurityDmPolicyCompat;
}> = (async () => {
  try {
    // 尝试从主 SDK 包导入
    const sdk = await import("openclaw/plugin-sdk/channel-policy");
    if (typeof (sdk as any).buildAccountScopedDmSecurityPolicy === "function") {
      return { buildAccountScopedDmSecurityPolicy: (sdk as any).buildAccountScopedDmSecurityPolicy };
    }
    return {};
  } catch {
    // openclaw/plugin-sdk 不可用或版本过低
    return {};
  }
})();

/**
 * 构建多账号作用域的 DM 安全策略（兼容入口）
 *
 * 优先使用 SDK 版本（openclaw/plugin-sdk/channel-policy），
 * 不可用时使用 fallback 实现。
 */
export async function buildAccountScopedDmSecurityPolicyCompat(
  params: BuildAccountScopedDmSecurityPolicyParams,
): Promise<ChannelSecurityDmPolicyCompat> {
  const sdk = await _sdkPolicyReady;

  if (sdk.buildAccountScopedDmSecurityPolicy) {
    try {
      return sdk.buildAccountScopedDmSecurityPolicy(params);
    } catch {
      // SDK 版本异常，降级到 fallback
    }
  }
  return buildAccountScopedDmSecurityPolicyFallback(params);
}
