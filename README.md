> 💡 **快速上手指引 & 交流群**
>
> 📖 [点击查看完整接入指引文档](https://doc.weixin.qq.com/doc/w3_AFYA1wY6ACoCNRxfnyGRJQaSa6jjJ?scode=AJEAIQdfAAo0RJmzxLAFYA1wY6ACo) — 包含配置步骤、产品介绍、常见问题解答等。
>
> 💬 扫码加入企业微信交流群：
>
> <img src="https://wwcdn.weixin.qq.com/node/wework/images/202603241759.3fb01c32cc.png" alt="扫码入群交流" width="200" />

# 特别说明
> ****2026.3.22 版本 OpenClaw 兼容说明****
> 
> 如果你的 OpenClaw 是 2026.3.22 及以上的版本，请升级插件到 2026.3.24 及以上版本。
> 
> 如果你的 OpenClaw 是 2026.3.22 以下的版本，请保持插件版本在 2026.3.20 版本。
> 
> 你可以使用以下命令快速安装： `npx -y @wecom/wecom-openclaw-cli install --force`

# 🤖 WeCom OpenClaw Plugin

**WeCom channel plugin for [OpenClaw](https://github.com/openclaw)** — by the Tencent WeCom team.

> A channel plugin powered by WeCom. Supports **Bot mode** (WebSocket long-polling or HTTP webhook with JSON callbacks) and **Agent mode** (HTTP webhook with XML encrypted callbacks). Direct messages, group chats, streaming replies, and proactive messaging.

---

📖 [WeCom AI Bot Official Documentation](https://open.work.weixin.qq.com/help?doc_id=21657)


## ✨ Features

- 🔗 **Dual-mode**: Bot (WebSocket / Webhook) and Agent (HTTP webhook) can run independently or together
- 💬 Supports both direct messages (DM) and group chat
- 📤 Proactive messaging to specific users, groups, departments, or tags
- 🖼️ Receives and processes image, voice, video, file, and **mixed (图文混排)** messages with automatic downloading
- 🗣️ Voice-to-text: automatically extracts transcribed text from voice messages
- 💬 Quote message support: processes quoted text, image, voice, and file messages
- ⏳ Streaming replies with "thinking" placeholder messages (Bot mode)
- 🔐 Agent mode: AES-256-CBC encrypted XML callbacks with SHA1 signature verification
- 📝 Markdown formatting support for replies
- 🃏 Template card messages (text_notice, news_notice, button_interaction, vote_interaction, multiple_interaction) with **event callback handling**
- 🔒 Built-in access control: DM Policy (pairing / open / allowlist / disabled) and Group Policy (open / allowlist / disabled)
- 🔑 Command authorization: per-account command permission control with access group support
- 👥 Multi-account support: run multiple WeCom accounts with independent bot/agent configs
- 🧩 MCP tool integration (`wecom_mcp`) with interceptor pipeline (biz-error, media, smartpage-create, smartpage-export)
- 🎯 **15 built-in Skills**: contact lookup, doc management, todo, meeting, schedule, messaging, smartsheet, template cards, and more
- 🔀 Dynamic Agent routing: auto-create isolated agents per user/group
- 📁 Local file sending with configurable media path allowlist (`mediaLocalRoots`)
- 📊 Smart media size limits with auto-downgrade (image 10MB → file, video 10MB → file, voice 2MB/AMR-only → file, max 20MB)
- 🔄 **Bot-first, Agent-fallback** outbound delivery: auto fallback to Agent HTTP API when Bot WS is unavailable
- ⚡ Auto heartbeat keep-alive and reconnection (up to 10 reconnect attempts, 5 auth failure retries)
- 🛡️ Anti-kick protection: suppresses auto-restart on server-side disconnection to prevent mutual kicking loops
- 🧙 Interactive CLI setup wizard

---

## 🚀 Getting Started

### Requirements

- OpenClaw `>= 2026.3.28`

### Quick Install

Use the CLI tool to automatically install the plugin and complete bot configuration in one step:

```shell
# Automatically install the channel plugin and quickly complete configuration; also works for updates
npx -y @wecom/wecom-openclaw-cli install
```

More Options
```shell
# If installation fails, try force install
npx -y @wecom/wecom-openclaw-cli install --force

# Use --help to learn more about the tool
npx -y @wecom/wecom-openclaw-cli --help
```

### Manual Install

```shell
openclaw plugins install @wecom/wecom-openclaw-plugin
```

### Configuration

#### Option 1: Interactive Setup

```shell
openclaw channels add
```

Follow the prompts to enter your WeCom bot's **Bot ID** and **Secret**.

#### Option 2: CLI Quick Setup

```shell
openclaw config set channels.wecom.botId <YOUR_BOT_ID>
openclaw config set channels.wecom.secret <YOUR_BOT_SECRET>
openclaw config set channels.wecom.enabled true
openclaw gateway restart
```

### Mode Overview

The plugin supports two connection modes that can be used independently or together:

| Mode | Connection | Message Format | Use Case |
|------|-----------|---------------|----------|
| **Bot** (智能体) | WebSocket (default) or HTTP webhook | JSON | Quick setup, streaming replies |
| **Agent** (自建应用) | HTTP webhook callbacks | XML | Enterprise apps, API-driven messaging |

> **Note**: Bot mode supports two connection methods via `connectionMode`:
> - `websocket` (default) — WebSocket long-polling, requires `botId` + `secret`
> - `webhook` — HTTP callback, requires `token` + `encodingAESKey`

### Bot Mode Configuration

#### Core Settings

| Config Path | Description | Options | Default |
|---|---|---|---|
| `channels.wecom.enabled` | Enable the channel | `true` / `false` | `false` |
| `channels.wecom.connectionMode` | Bot connection mode | `websocket` / `webhook` | `websocket` |
| `channels.wecom.name` | Account display name | — | `企业微信` |

#### WebSocket Mode (default)

| Config Path | Description | Options | Default |
|---|---|---|---|
| `channels.wecom.botId` | WeCom bot ID | — | — |
| `channels.wecom.secret` | WeCom bot secret | — | — |
| `channels.wecom.websocketUrl` | WebSocket endpoint | — | `wss://openws.work.weixin.qq.com` |
| `channels.wecom.sendThinkingMessage` | Send "thinking" placeholder | `true` / `false` | `true` |

#### Webhook Mode (`connectionMode: "webhook"`)

| Config Path | Description | Options | Default |
|---|---|---|---|
| `channels.wecom.token` | Webhook verification token | — | — |
| `channels.wecom.encodingAESKey` | AES encryption key (43 chars Base64) | — | — |
| `channels.wecom.receiveId` | Receiver ID (for decryption verification) | — | — |
| `channels.wecom.welcomeText` | Welcome message on enter_chat event | — | — |
| `channels.wecom.streamPlaceholderContent` | Stream placeholder content | — | — |

#### Access Control

| Config Path | Description | Options | Default |
|---|---|---|---|
| `channels.wecom.dmPolicy` | DM access policy | `pairing` / `open` / `allowlist` / `disabled` | `open` |
| `channels.wecom.allowFrom` | DM allowlist (user IDs) | — | `[]` |
| `channels.wecom.groupPolicy` | Group chat access policy | `open` / `allowlist` / `disabled` | `open` |
| `channels.wecom.groupAllowFrom` | Group allowlist (group IDs) | — | `[]` |
| `channels.wecom.groups` | Per-group config (e.g. sender allowlist) | — | `{}` |

#### Media Settings

| Config Path | Description | Default |
|---|---|---|
| `channels.wecom.mediaLocalRoots` | Extra local paths allowed for media sending (supports `~`) | `[]` |
| `channels.wecom.media.maxBytes` | Max media file size in bytes | `20971520` (20MB) |
| `channels.wecom.media.tempDir` | Temp directory for media processing | — |
| `channels.wecom.media.retentionHours` | Media file retention hours | — |
| `channels.wecom.media.cleanupOnStart` | Clean temp media on startup | — |

**Media Size Limits & Auto-Downgrade:**

| Media Type | Max Size | Downgrade Behavior |
|---|---|---|
| Image | 10 MB | Exceeds → sent as file |
| Video | 10 MB | Exceeds → sent as file |
| Voice | 2 MB (AMR only) | Non-AMR format or exceeds → sent as file |
| File | 20 MB | Exceeds → rejected (cannot send) |

#### Network Settings

| Config Path | Description | Default |
|---|---|---|
| `channels.wecom.network.timeoutMs` | HTTP request timeout (ms) | — |
| `channels.wecom.network.retries` | Number of retries | — |
| `channels.wecom.network.retryDelayMs` | Delay between retries (ms) | — |
| `channels.wecom.network.egressProxyUrl` | Egress proxy URL for trusted IP scenarios | — |

> **Egress Proxy Priority**: `channels.wecom.network.egressProxyUrl` > `OPENCLAW_WECOM_EGRESS_PROXY_URL` > `WECOM_EGRESS_PROXY_URL` > `HTTPS_PROXY` > `ALL_PROXY` > `HTTP_PROXY`

### Agent Mode Configuration

Agent mode uses HTTP webhook callbacks with XML encrypted messages. You need to configure the callback URL in the WeCom admin console under "API Receive" settings.

#### Prerequisites

1. Create a self-built app in [WeCom Admin Console](https://work.weixin.qq.com/wework_admin/frame#apps)
2. Note down the **CorpID**, **CorpSecret** (from app settings), and **AgentId**
3. In the app settings, go to "API Receive" (API接收):
   - Note down the **Token** and **EncodingAESKey** (auto-generated or custom)
   - **Do NOT click save yet** — WeCom will verify the callback URL immediately when you save

#### Setup Steps

> **Important**: You must configure the Gateway **before** saving the callback URL in WeCom admin console. WeCom sends a verification request (GET with `echostr`) immediately when you save, and the Gateway needs the `token` and `encodingAESKey` to decrypt and respond correctly.

**Step 1: Configure Gateway**

```shell
openclaw config set channels.wecom.agent.corpId <YOUR_CORP_ID>
openclaw config set channels.wecom.agent.corpSecret <YOUR_CORP_SECRET>
openclaw config set channels.wecom.agent.agentId <YOUR_AGENT_ID>
openclaw config set channels.wecom.agent.token <YOUR_CALLBACK_TOKEN>
openclaw config set channels.wecom.agent.encodingAESKey <YOUR_ENCODING_AES_KEY>
openclaw config set channels.wecom.enabled true
openclaw gateway restart
```

**Step 2: Save callback URL in WeCom admin console**

Go back to the "API Receive" settings and enter the callback URL:
- **URL**: `https://<your-gateway-host>/plugins/wecom/agent/<accountId>` (e.g. `/plugins/wecom/agent/default`); single-account mode can also use `/plugins/wecom/agent`

Now click save — the verification should pass.

#### JSON Configuration

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "your-corp-secret",
        "agentId": 1000002,
        "token": "your-callback-token",
        "encodingAESKey": "your-encoding-aes-key-43-chars"
      }
    }
  }
}
```

#### Agent Config Reference

| Config Path | Description | Required |
|---|---|---|
| `channels.wecom.agent.corpId` | Enterprise Corp ID | Yes |
| `channels.wecom.agent.corpSecret` | App secret | Yes |
| `channels.wecom.agent.agentId` | App agent ID | No (needed for proactive messaging) |
| `channels.wecom.agent.token` | Callback verification token | Yes |
| `channels.wecom.agent.encodingAESKey` | Callback encryption key (43 chars) | Yes |
| `channels.wecom.agent.welcomeText` | Welcome message | No |
| `channels.wecom.agent.dmPolicy` | DM access policy (overrides top-level) | No |
| `channels.wecom.agent.allowFrom` | DM allowlist (overrides top-level) | No |

#### Webhook Paths

**Agent Mode:**

| Path | Description |
|---|---|
| `/plugins/wecom/agent/<accountId>` | 推荐路径（例如 `/plugins/wecom/agent/default`） |
| `/plugins/wecom/agent/default` | 多账号模式下自动路由到默认账号（即使默认账号 ID 不是 `default`） |
| `/plugins/wecom/agent` | 兼容路径（单账号 / 多账号签名匹配） |
| `/wecom/agent` | Legacy 兼容路径 |

**Bot Webhook Mode** (`connectionMode: "webhook"`):

| Path | Description |
|---|---|
| `/plugins/wecom/bot` | Recommended path (single account) |
| `/plugins/wecom/bot/<accountId>` | Multi-account path |
| `/wecom/bot` | Legacy compatible path |
| `/wecom` | Legacy compatible path |

### Outbound Delivery (Bot WS → Agent HTTP Fallback)

The plugin uses a **Bot-first, Agent-fallback** strategy for outbound message delivery:

1. **Bot WebSocket available** → send via WS (supports markdown, streaming)
2. **Bot WS unavailable** → automatically fallback to **Agent HTTP API** (`cgi-bin/message/send`)

This means:
- **Agent-only accounts** (no Bot configured) can still send proactive messages, cron deliveries, and broadcasts
- **Target formats** like `party:1`, `tag:Ops`, `user:zhangsan` are fully supported in both paths
- **Media fallback**: when Bot WS is unavailable, media files are downloaded, uploaded to WeCom via Agent API, then sent; if upload fails, falls back to text + URL
- No manual switching needed — the plugin handles fallback transparently

### Using Both Modes Together

Bot and Agent can run simultaneously on the same account. Bot handles WebSocket streaming; Agent handles HTTP webhook callbacks with API-driven replies.

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "botId": "your-bot-id",
      "secret": "your-bot-secret",
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "your-corp-secret",
        "agentId": 1000002,
        "token": "your-callback-token",
        "encodingAESKey": "your-encoding-aes-key-43-chars"
      }
    }
  }
}
```

### Multi-Account Configuration

Use `accounts` to configure multiple WeCom accounts, each with optional bot and/or agent sub-configs. Account-level fields override top-level fields of the same name.

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "main",
      "dmPolicy": "open",
      "accounts": {
        "main": {
          "botId": "bot-id-1",
          "secret": "secret-1",
          "agent": {
            "corpId": "ww1234567890abcdef",
            "corpSecret": "secret-a",
            "agentId": 1000002,
            "token": "token-a",
            "encodingAESKey": "aes-key-a"
          }
        },
        "support": {
          "dmPolicy": "allowlist",
          "allowFrom": ["admin1"],
          "agent": {
            "corpId": "ww1234567890abcdef",
            "corpSecret": "secret-b",
            "agentId": 1000003,
            "token": "token-b",
            "encodingAESKey": "aes-key-b"
          }
        }
      }
    }
  }
}
```

> **Note**: In multi-account mode, accounts without explicit `bindings` will not fall back to the default agent. Configure bindings for each account:
> ```json
> {
>   "bindings": [
>     { "agentId": "your-agent", "match": { "channel": "wecom", "accountId": "main" } }
>   ]
> }
> ```

### Dynamic Agent Configuration

Dynamic Agent routing automatically creates isolated agents per user or group, enabling session isolation.

```json
{
  "channels": {
    "wecom": {
      "dynamicAgents": {
        "enabled": true,
        "dmCreateAgent": true,
        "groupEnabled": true,
        "adminUsers": ["admin_user_id"],
        "workspaceTemplate": "{stateDir}/workspace/{agentId}",
        "agentDirTemplate": "{stateDir}/agents/{agentId}/agent",
        "workspaceTemplateDir": "~/openclaw-agent-template"
      }
    }
  }
}
```

| Config Path | Description | Default |
|---|---|---|
| `channels.wecom.dynamicAgents.enabled` | Enable dynamic agent routing | `false` |
| `channels.wecom.dynamicAgents.dmCreateAgent` | Create isolated agent per DM user | `true` |
| `channels.wecom.dynamicAgents.groupEnabled` | Enable dynamic agent for group chats | `true` |
| `channels.wecom.dynamicAgents.adminUsers` | Admin users (bypass dynamic routing, use main agent) | `[]` |
| `channels.wecom.dynamicAgents.workspaceTemplate` | Workspace path template. Supports `{stateDir}` / `{agentId}` / `{userId}` | `{stateDir}/workspace/{agentId}` |
| `channels.wecom.dynamicAgents.agentDirTemplate` | Agent directory template. Supports `{stateDir}` / `{agentId}` / `{userId}` | `{stateDir}/agents/{agentId}/agent` |
| `channels.wecom.dynamicAgents.workspaceTemplateDir` | Optional template directory copied into a newly created workspace | unset |

Deprecated compatibility:
`dynamicAgentEnable`, `dynamicAgentWorkspaceTemplate`, `dynamicAgentDirTemplate`, and `dynamicAgentWorkspaceTemplateDir` are still accepted for backward compatibility, but new configs should use `channels.wecom.dynamicAgents.*`.

---

## 🔒 Access Control

### DM (Direct Message) Access

**Default**: `dmPolicy: "open"` — all users can send direct messages without approval.

#### Approve Pairing

```shell
openclaw pairing list wecom            # View pending pairing requests
openclaw pairing approve wecom <CODE>  # Approve a pairing request
```

#### Allowlist Mode

Configure allowed user IDs via `channels.wecom.allowFrom`:

```json
{
  "channels": {
    "wecom": {
      "dmPolicy": "allowlist",
      "allowFrom": ["user_id_1", "user_id_2"]
    }
  }
}
```

#### Open Mode

Set `dmPolicy: "open"` to allow all users to send direct messages without approval.

#### Disabled Mode

Set `dmPolicy: "disabled"` to completely block all direct messages.

### Group Access

#### Group Policy (`channels.wecom.groupPolicy`)

- `"open"` — Allow messages from all groups (default)
- `"allowlist"` — Only allow groups listed in `groupAllowFrom`
- `"disabled"` — Disable all group messages

### Group Configuration Examples

#### Allow All Groups (Default Behavior)

```json
{
  "channels": {
    "wecom": {
      "groupPolicy": "open"
    }
  }
}
```

#### Allow Only Specific Groups

```json
{
  "channels": {
    "wecom": {
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["group_id_1", "group_id_2"]
    }
  }
}
```

#### Allow Only Specific Senders Within a Group (Sender Allowlist)

In addition to the group allowlist, you can restrict which members within a group are allowed to interact with the bot. Only messages from users listed in `groups.<chatId>.allowFrom` will be processed; messages from other members will be silently ignored. This is a sender-level allowlist that applies to **all messages**.

```json
{
  "channels": {
    "wecom": {
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["group_id_1"],
      "groups": {
        "group_id_1": {
          "allowFrom": ["user_id_1", "user_id_2"]
        }
      }
    }
  }
}
```

---

## ⏰ Cronjob (Scheduled Tasks)

The plugin supports scheduled message delivery via OpenClaw's built-in Cron service. Cron jobs run through the **Agent outbound** channel, so Agent mode must be configured.

### Target Formats

The `delivery.to` field supports the following target formats:

| Format | Target | Example |
|--------|--------|--------|
| `party:<id>` | Department (all members) | `party:1` (root dept = all employees) |
| `dept:<id>` | Department (alias for party) | `dept:5` |
| `tag:<id>` | Tag group | `tag:Ops` |
| `user:<id>` | Specific user | `user:zhangsan` |
| `group:<id>` | External group chat | `group:wr123abc` |
| `chat:<id>` | Group chat (alias for group) | `chat:wc456def` |
| Pure number | Auto-detected as department | `1` → `party:1` |
| `wr...` / `wc...` | Auto-detected as group chat | `wr123` → `chatid` |
| Other string | Auto-detected as user | `zhangsan` → `touser` |

> **Namespace prefixes** (`wecom:`, `qywx:`, `wework:`, `wechatwork:`, `wecom-agent:`) are automatically stripped before parsing.

### Method 1: CLI (Recommended — takes effect immediately)

```shell
openclaw cron add \
  --name "daily-report" \
  --agent main \
  --cron "0 9 * * 1-5" \
  --tz "Asia/Shanghai" \
  --message "Good morning! Here is your daily briefing." \
  --announce \
  --channel wecom \
  --to "party:1"
```

> **Note**: `--announce` enables delivery mode (broadcasts the AI response to the target chat). Use `--no-deliver` to keep output internal. The deprecated `--deliver` flag is an alias for `--announce`.

Common CLI commands:

```shell
openclaw cron list              # List all cron jobs
openclaw cron show <id>         # Show job details
openclaw cron enable <id>       # Enable a job
openclaw cron disable <id>      # Disable a job
openclaw cron remove <id>       # Remove a job
openclaw cron run <id>          # Manually trigger a job
openclaw cron runs --id <id>    # View run history
openclaw cron edit <id> --message "New prompt"  # Edit a job
```

### Method 2: Edit `jobs.json` (requires gateway restart)

File path: `~/.openclaw/cron/jobs.json`

```json
{
  "version": 1,
  "jobs": [
    {
      "id": "daily-report",
      "name": "Daily Report",
      "agentId": "main",
      "enabled": true,
      "schedule": { "kind": "cron", "expr": "0 9 * * 1-5", "tz": "Asia/Shanghai" },
      "sessionTarget": "isolated",
      "wakeMode": "now",
      "payload": {
        "kind": "agentTurn",
        "message": "Generate today's briefing and send it."
      },
      "delivery": {
        "mode": "announce",
        "channel": "wecom",
        "to": "party:1",
        "accountId": "main"
      },
      "state": {}
    }
  ]
}
```

After editing, restart the gateway:

```shell
openclaw gateway restart
```

### Method 3: Create via chat (takes effect immediately)

You can ask the AI agent directly in a WeCom conversation:

> "Create a scheduled task: send a daily briefing to the entire company at 9am every weekday"

The agent will call the Cron API to create the job — no restart needed.

### Notes

- Cron jobs use the **Agent outbound** path — Agent mode (`corpId` / `corpSecret` / `agentId`) must be configured.
- The server IP must be in the WeCom trusted IP allowlist, or configure `egressProxyUrl` for a fixed egress proxy.
- Jobs created via CLI or chat API take effect immediately. Manual edits to `jobs.json` require `openclaw gateway restart`.
- For multi-account setups, set `delivery.accountId` to the target account (e.g. `"main"`, `"support"`).

---

## 📦 Update

```shell
openclaw plugins update wecom-openclaw-plugin
```

---

## 📄 License

MIT
