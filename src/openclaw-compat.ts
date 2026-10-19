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

export function formatPairingApproveHint(channelId: string): string {
  const listCmd = `openclaw pairing list ${channelId}`;
  const approveCmd = `openclaw pairing approve ${channelId} <code>`;
  return `向 ${channelId} 机器人发送消息以完成配对审批（命令行：${listCmd} / ${approveCmd}）`;
}
