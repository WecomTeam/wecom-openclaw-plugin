import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/core";

import { wecomPlugin } from "./src/channel.js";
import { createWeComMcpTool } from "./src/mcp";
import { setWeComRuntime } from "./src/runtime.js";
import { CHANNEL_ID } from "./src/const.js";

// ============================================================================
// 需要自动注入 tools.alsoAllow 的工具名列表
// ============================================================================

const REQUIRED_ALSO_ALLOW_TOOLS = ["wecom_mcp"] as const;

/**
 * 确保 tools.alsoAllow 中包含插件所需的工具名。
 *
 * 逻辑：
 *  1. 读取当前配置
 *  2. 检查 tools.alsoAllow 中是否已包含所需工具
 *  3. 如有缺失，合并写入配置文件
 *
 * 幂等操作——重复调用不会产生副作用。
 * 若 tools.allow 已显式设置（与 alsoAllow 互斥），则跳过注入并打印提示。
 */
async function ensureToolsAlsoAllow(api: OpenClawPluginApi): Promise<void> {
  try {
    const cfg = api.runtime.config.loadConfig();
    const tools = cfg.tools ?? {};

    // 如果用户显式配置了 tools.allow（全量白名单），则 alsoAllow 与之互斥，
    // 此时不应自动追加 alsoAllow，避免产生校验冲突
    if (tools.allow && tools.allow.length > 0) {
      const missing = REQUIRED_ALSO_ALLOW_TOOLS.filter(
        (t) => !tools.allow!.includes(t),
      );
      if (missing.length > 0) {
        console.warn(
          `[wecom] tools.allow 已显式设置，无法自动注入 alsoAllow。` +
          `请手动将 ${JSON.stringify(missing)} 加入 tools.allow。`,
        );
      }
      return;
    }

    const existing = tools.alsoAllow ?? [];
    const missing = REQUIRED_ALSO_ALLOW_TOOLS.filter(
      (t) => !existing.includes(t),
    );

    if (missing.length === 0) {
      // 所有工具已在白名单中，无需操作
      return;
    }

    const merged = [...existing, ...missing];
    const nextConfig = {
      ...cfg,
      tools: {
        ...tools,
        alsoAllow: merged,
      },
    };

    await api.runtime.config.writeConfigFile(nextConfig);
    console.log(
      `[wecom] 已自动将 ${JSON.stringify(missing)} 加入 tools.alsoAllow`,
    );
  } catch (err) {
    // 配置写入失败不应阻断 Gateway 启动
    console.error(
      `[wecom] 自动注入 tools.alsoAllow 失败:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

const plugin = {
  id: "wecom-openclaw-plugin",
  name: "企业微信",
  description: "企业微信 OpenClaw 插件",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {

    setWeComRuntime(api.runtime);
    api.registerChannel({ plugin: wecomPlugin });

    // 注册 wecom_mcp：通过 HTTP 直接调用企业微信 MCP Server
    api.registerTool(createWeComMcpTool(), { name: "wecom_mcp" });

    // ── Gateway 启动时自动确保 tools.alsoAllow 包含 wecom_mcp ──────────
    // 在 gateway_start 阶段检测并写入，保证插件安装/更新后首次启动即生效
    // api.on("gateway_start", async () => {
    //   await ensureToolsAlsoAllow(api);
    // });

    // 注入媒体发送指令和文件大小限制提示词（仅对企业微信 channel 生效）
    api.on("before_prompt_build", (_event, ctx) => {
      // 只在企业微信 channel 的会话中注入，避免影响其他 channel 插件
      if (ctx?.channelId !== CHANNEL_ID) {
        return;
      }
      return {
        appendSystemContext: [
          "重要：涉及发送图片/视频/语音/文件给用户时，请务必使用 `MEDIA：` 指令。详见  wecom-send-media 这个 skill（技能）。"
        ].join("\n"),
      };
    });
  },
};

export default plugin;
