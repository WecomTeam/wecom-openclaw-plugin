const LEGACY_TOOL_NAME = "wecom_mcp";
const CLI_TOOL_NAME = "wecom-cli";
const PLUGIN_ID = "wecom-openclaw-plugin";

export interface ToolPolicyConfig {
  profile?: string;
  alsoAllow?: string[];
}

/**
 * 仅在旧白名单确实导致 `wecom-cli` 不可见时提示迁移。
 *
 * 不做配置卫生检查：profile=full、已放行具体 tool、已放行插件 ID 时，
 * 旧条目只是无害残留，不应制造启动噪音。
 */
export function shouldWarnLegacyToolAllow(tools: ToolPolicyConfig | undefined): boolean {
  if (tools?.profile === "full") return false;

  const allow = tools?.alsoAllow;
  if (!Array.isArray(allow) || !allow.includes(LEGACY_TOOL_NAME)) return false;

  return !allow.includes(CLI_TOOL_NAME) && !allow.includes(PLUGIN_ID);
}

export const LEGACY_TOOL_WARNING =
  "检测到旧工具白名单 `wecom_mcp`。该工具已移除，企微业务能力已统一迁移到 `wecom-cli`。" +
  "请在 `tools.alsoAllow` 中添加 `wecom-cli`（旧条目可保留或自行删除），然后重启 Gateway。" +
  "也可直接放行插件 ID：`wecom-openclaw-plugin`。";
