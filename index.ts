import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
import { emptyPluginConfigSchema } from "./src/openclaw-compat.js";
import { wecomPlugin } from "./src/channel.js";
import { createWeComCliTool, CLI_TOOL_NAME } from "./src/cli/index.js";
import {
  LEGACY_TOOL_WARNING,
  shouldWarnLegacyToolAllow,
} from "./src/cli/legacy-tool-warning.js";
import { setWeComRuntime } from "./src/runtime.js";
import { resolveWeComAccountMulti } from "./src/accounts.js";
import { CHANNEL_ID, WEBHOOK_PATHS } from "./src/const.js";
import { createWecomAgentWebhookHandler } from "./src/agent/webhook.js";
import { handleWecomWebhookRequest } from "./src/webhook/index.js";

const plugin = {
  id: "wecom-openclaw-plugin",
  name: "企业微信",
  description: "企业微信 OpenClaw 插件",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setWeComRuntime(api.runtime);

    if (shouldWarnLegacyToolAllow(api.config.tools)) {
      api.logger.warn(LEGACY_TOOL_WARNING);
    }

    api.registerChannel({ plugin: wecomPlugin });

    // 注册 wecom-cli：包装 @wecom/cli 二进制，按会话所属bot 注入独立配置目录
    api.registerTool(
      (ctx: OpenClawPluginToolContext) => {
        console.log(
          `[wecom-cli:tool] registerTool ctx: sessionKey="${ctx.sessionKey}", ` +
          `messageChannel="${ctx.messageChannel}", agentAccountId="${ctx.agentAccountId}"`,
        );
        // Tool factories may execute in an isolated module context where the
        // plugin-level runtime store is unavailable. Resolve the account from
        // the registration snapshot so credential lookup never depends on
        // that module singleton.
        const resolvedAccount = resolveWeComAccountMulti({
          cfg: api.config,
          accountId: ctx.agentAccountId ?? null,
        });
        return createWeComCliTool({
          accountId: ctx.agentAccountId,
          resolvedAccount,
          runtime: api.runtime,
        });
      },
      { name: CLI_TOOL_NAME },
    );

    const agentWebhookHandler = createWecomAgentWebhookHandler(api.runtime);

    // 注册 Agent 模式 HTTP 路由（prefix match 覆盖带 accountId 的子路径）
    api.registerHttpRoute({
      path: WEBHOOK_PATHS.AGENT_PLUGIN,
      handler: agentWebhookHandler,
      auth: "plugin",
      match: "prefix",
    });
    api.registerHttpRoute({
      path: WEBHOOK_PATHS.AGENT,
      handler: agentWebhookHandler,
      auth: "plugin",
      match: "prefix",
    });

        // ── 注册 bot Webhook HTTP 路由 ────────────────────────────────────────
    // 前缀匹配模式，同时覆盖 /plugins/wecom 和 /wecom 路径
    const webhookRoutes = [WEBHOOK_PATHS.BOT_PLUGIN, WEBHOOK_PATHS.BOT_ALT, WEBHOOK_PATHS.BOT];
    for (const routePath of webhookRoutes) {
      api.registerHttpRoute({
        path: routePath,
        handler: handleWecomWebhookRequest,
        auth: "plugin",
        match: "prefix",
      });
    }

    // 注入企业微信专用工具约束、媒体发送指令和文件大小限制提示词（仅对企业微信 channel 生效）
    api.on("before_prompt_build", (_event, ctx) => {
      // 只在企业微信 channel 的会话中注入，避免影响其他 channel 插件
      if (ctx?.channelId !== CHANNEL_ID) {
        return;
      }
      return {
        appendSystemContext: [
          "重要：企业微信通讯录、文档、会议、日程、待办、智能表格等能力必须调用专用 `wecom-cli` tool。禁止通过 exec、bash、shell、npx 或全局命令运行 wecom-cli；专用 tool 内部自行寻址并启动二进制是正常实现，不属于此禁止范围。",
          "重要：即使 `wecom-cli` tool 调用失败、不可见、权限不足或提示授权，也不得降级到 exec 或手动执行 auth init；应向用户返回工具权限或 `channels.wecom` 配置问题。调用 tool 时，`args` 只传 wecom-cli 后面的参数，不传命令前缀、WECOM_CLI_* 环境变量或配置目录。",
          "重要：涉及发送图片/视频/语音/文件给用户时，请务必使用 `MEDIA:` 指令。详见  wecom-send-media 这个 skill（技能）。",
          "重要：当需要向用户发送结构化卡片消息（如通知、投票、按钮选择等）时，请在回复中直接输出 JSON 代码块（```json ... ```），其中 card_type 字段标明卡片类型。详见 wecom-send-template-card 技能。",
        ].join("\n"),
      };
    });
  },
};

export default plugin;
