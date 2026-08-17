[English](./README.md) | 中文版

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

# 🤖 WeCom OpenClaw 插件

**面向 [OpenClaw](https://github.com/openclaw) 的企业微信 Channel 与业务能力插件** — 由腾讯企业微信团队开发。

> 一个由企业微信提供支持、兼具 Channel 与业务能力的插件。支持 **Bot 模式**（WebSocket 长轮询，或 JSON 回调的 HTTP webhook）与 **Agent 模式**（XML 加密回调的 HTTP webhook），以及单聊、群聊、流式回复、主动消息推送，并内置 `wecom-cli` 业务操作能力。

---

📖 [企业微信 AI Bot 官方文档](https://open.work.weixin.qq.com/help?doc_id=21657)


## ✨ 特性

- 🔗 **双模式**：Bot（WebSocket / Webhook）与 Agent（HTTP webhook）可独立或同时运行
- 💬 同时支持单聊（DM）与群聊
- 📤 向指定用户、群组、部门或标签主动推送消息
- 🖼️ 接收并处理图片、语音、视频、文件及**图文混排**消息，并自动下载
- 🗣️ 语音转文字：自动提取语音消息中的转写文本
- 💬 引用消息支持：处理被引用的文本、图片、语音与文件消息
- ⏳ 流式回复，支持"思考中"占位消息（Bot 模式）
- 🔐 Agent 模式：AES-256-CBC 加密 XML 回调 + SHA1 签名校验
- 📝 回复支持 Markdown 格式
- 🃏 模板卡片消息（text_notice、news_notice、button_interaction、vote_interaction、multiple_interaction），支持**事件回调处理**
- 🔒 内置访问控制：DM 策略（pairing / open / allowlist / disabled）与群组策略（open / allowlist / disabled）
- 🔑 命令授权：按账号进行命令权限控制，支持访问组
- 👥 多账号支持：可运行多个企业微信账号，各自独立的 bot/agent 配置
- 🧰 内置业务 Skills，由插件提供的 `wecom-cli` 工具驱动
- 🔀 动态 Agent 路由：按用户/群组自动创建隔离的 Agent
- 📁 本地文件发送，支持可配置的媒体路径白名单（`mediaLocalRoots`）
- 📊 智能媒体大小限制与自动降级（图片 10MB → 文件，视频 10MB → 文件，语音 2MB/仅 AMR → 文件，最大 20MB）
- 🔄 **Bot 优先、Agent 兜底**的出站投递：Bot WS 不可用时自动回退到 Agent HTTP API
- ⚡ 自动心跳保活与重连（最多 10 次重连，5 次鉴权失败重试）
- 🛡️ 防踢保护：抑制服务端断连导致的自动重启，避免互相踢下线
- 🧙 交互式 CLI 安装向导

### 企业微信业务能力

插件内置 `wecom-cli` 工具及对应的 Skills，覆盖以下企业微信业务品类：

| 品类 | 能力 |
|---|---|
| 💬 消息 | 向机器人最近对话过的单聊/群聊主动推送消息，支持 Markdown/图片/文件/语音/视频消息 |
| 📧 邮件 | 邮件发送/回复/转发，邮件搜索，获取邮件内容详情 |
| 📄 文档 | 在线文档的新建、导入、读取、追加与覆盖写入 |
| 🗂️ 文档管理 | 多种文档类型的搜索，在线文档/在线表格/智能表格/智能文档的重命名、成员权限与加入规则管理 |
| 📊 在线表格 | 在线表格新建、CSV/Excel 导入、内容读改、追加行、子表管理 |
| 🧮 智能表格 | 智能表格创建，子表/字段/记录/视图/图表管理，行列样式修改 |
| 📰 智能文档 | 智能文档创建、获取页面内容、编辑文档内容、内置数据表信息获取 |
| ✅ 待办 | 创建/读取/更新/删除待办，分派参与人与完成待办等 |
| 📅 日程 | 日程增删改查、参与人管理、多成员闲忙查询、会议室查询预订等 |
| 🎥 会议 | 创建预约会议、取消会议、更新参会人、查询列表与详情、读取会议纪要与转写原文 |
| 💾 微盘 | 微盘文件的搜索、基础信息读取、上传、下载 |
| 👤 通讯录 | 按姓名/拼音/别名搜索成员，获取成员基本信息，以用于会议、日程等多人场景 |

---

## 🚀 快速开始

### 环境要求

- OpenClaw `>= 2026.3.28`

### 快速安装

使用 CLI 工具一键完成插件安装与机器人配置：

```shell
# 自动安装 Channel 插件并快速完成配置，同时适用于升级
npx -y @wecom/wecom-openclaw-cli install
```

更多选项
```shell
# 如果安装失败，尝试强制安装
npx -y @wecom/wecom-openclaw-cli install --force

# 使用 --help 了解该工具的更多用法
npx -y @wecom/wecom-openclaw-cli --help
```

### 手动安装

```shell
openclaw plugins install @wecom/wecom-openclaw-plugin
```

### 配置

#### 方式一：交互式配置

```shell
openclaw channels add
```

按提示输入机器人的 **Bot ID** 与 **Secret**。

#### 方式二：CLI 快速配置

```shell
openclaw config set channels.wecom.botId <YOUR_BOT_ID>
openclaw config set channels.wecom.secret <YOUR_BOT_SECRET>
openclaw config set channels.wecom.enabled true
openclaw gateway restart
```

### 启用业务工具

以上企业微信业务能力通过插件提供的 `wecom-cli` 工具暴露。除非 `tools.profile` 设为 `full`，否则需要放行插件并重启 Gateway：

```shell
openclaw config set tools.alsoAllow '["wecom-openclaw-plugin"]'
openclaw gateway restart
```

> 按插件 ID 放行会启用该插件当前及未来注册的全部工具。若 `tools.alsoAllow` 中已有其他条目，请将 `wecom-openclaw-plugin` 合并进现有数组，而不要覆盖。

### 模式概览

插件支持两种连接模式，可独立或同时使用：

| 模式 | 连接方式 | 消息格式 | 适用场景 |
|------|-----------|---------------|----------|
| **Bot**（智能体） | WebSocket（默认）或 HTTP webhook | JSON | 快速接入、流式回复 |
| **Agent**（自建应用） | HTTP webhook 回调 | XML | 企业应用、API 驱动的消息 |

> **说明**：Bot 模式通过 `connectionMode` 支持两种连接方式：
> - `websocket`（默认）— WebSocket 长轮询，需要 `botId` + `secret`
> - `webhook` — HTTP 回调，需要 `token` + `encodingAESKey`

### Bot 模式配置

#### 核心设置

| 配置路径 | 说明 | 可选值 | 默认值 |
|---|---|---|---|
| `channels.wecom.enabled` | 启用该 Channel | `true` / `false` | `false` |
| `channels.wecom.connectionMode` | Bot 连接方式 | `websocket` / `webhook` | `websocket` |
| `channels.wecom.name` | 账号显示名称 | — | `企业微信` |

#### WebSocket 模式（默认）

| 配置路径 | 说明 | 可选值 | 默认值 |
|---|---|---|---|
| `channels.wecom.botId` | 企业微信机器人 ID | — | — |
| `channels.wecom.secret` | 企业微信机器人 secret | — | — |
| `channels.wecom.websocketUrl` | WebSocket 端点 | — | `wss://openws.work.weixin.qq.com` |
| `channels.wecom.sendThinkingMessage` | 发送"思考中"占位消息 | `true` / `false` | `true` |

#### Webhook 模式（`connectionMode: "webhook"`）

| 配置路径 | 说明 | 可选值 | 默认值 |
|---|---|---|---|
| `channels.wecom.token` | Webhook 校验 token | — | — |
| `channels.wecom.encodingAESKey` | AES 加密密钥（43 字符 Base64） | — | — |
| `channels.wecom.receiveId` | 接收方 ID（用于解密校验） | — | — |
| `channels.wecom.welcomeText` | enter_chat 事件欢迎语 | — | — |
| `channels.wecom.streamPlaceholderContent` | 流式占位内容 | — | — |

#### 访问控制

| 配置路径 | 说明 | 可选值 | 默认值 |
|---|---|---|---|
| `channels.wecom.dmPolicy` | 单聊访问策略 | `pairing` / `open` / `allowlist` / `disabled` | `open` |
| `channels.wecom.allowFrom` | 单聊白名单（用户 ID） | — | `[]` |
| `channels.wecom.groupPolicy` | 群聊访问策略 | `open` / `allowlist` / `disabled` | `open` |
| `channels.wecom.groupAllowFrom` | 群聊白名单（群 ID） | — | `[]` |
| `channels.wecom.groups` | 按群配置（如发送者白名单） | — | `{}` |

#### 媒体设置

| 配置路径 | 说明 | 默认值 |
|---|---|---|
| `channels.wecom.mediaLocalRoots` | 允许发送媒体的额外本地路径（支持 `~`） | `[]` |
| `channels.wecom.media.maxBytes` | 媒体文件最大字节数 | `20971520`（20MB） |
| `channels.wecom.media.tempDir` | 媒体处理临时目录 | — |
| `channels.wecom.media.retentionHours` | 媒体文件保留时长（小时） | — |
| `channels.wecom.media.cleanupOnStart` | 启动时清理临时媒体 | — |

**媒体大小限制与自动降级：**

| 媒体类型 | 最大大小 | 降级行为 |
|---|---|---|
| 图片 | 10 MB | 超出 → 以文件发送 |
| 视频 | 10 MB | 超出 → 以文件发送 |
| 语音 | 2 MB（仅 AMR） | 非 AMR 格式或超出 → 以文件发送 |
| 文件 | 20 MB | 超出 → 拒绝（无法发送） |

#### 网络设置

| 配置路径 | 说明 | 默认值 |
|---|---|---|
| `channels.wecom.network.timeoutMs` | HTTP 请求超时（毫秒） | — |
| `channels.wecom.network.retries` | 重试次数 | — |
| `channels.wecom.network.retryDelayMs` | 重试间隔（毫秒） | — |
| `channels.wecom.network.egressProxyUrl` | 可信 IP 场景的出站代理 URL | — |

> **出站代理优先级**：`channels.wecom.network.egressProxyUrl` > `OPENCLAW_WECOM_EGRESS_PROXY_URL` > `WECOM_EGRESS_PROXY_URL` > `HTTPS_PROXY` > `ALL_PROXY` > `HTTP_PROXY`

### Agent 模式配置

Agent 模式使用 HTTP webhook 回调，消息为 XML 加密格式。需要在企业微信管理后台的「API 接收」设置中配置回调 URL。

#### 前置条件

1. 在 [企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame#apps) 创建自建应用
2. 记录 **CorpID**、**CorpSecret**（来自应用设置）与 **AgentId**
3. 在应用设置的「API 接收」中：
   - 记录 **Token** 与 **EncodingAESKey**（自动生成或自定义）
   - **先不要点击保存** — 点击保存时企业微信会立即校验回调 URL

#### 设置步骤

> **重要**：必须先配置 Gateway，再在企业微信管理后台保存回调 URL。点击保存时企业微信会立即发送校验请求（带 `echostr` 的 GET 请求），Gateway 需要 `token` 和 `encodingAESKey` 才能正确解密并响应。

**步骤 1：配置 Gateway**

```shell
openclaw config set channels.wecom.agent.corpId <YOUR_CORP_ID>
openclaw config set channels.wecom.agent.corpSecret <YOUR_CORP_SECRET>
openclaw config set channels.wecom.agent.agentId <YOUR_AGENT_ID>
openclaw config set channels.wecom.agent.token <YOUR_CALLBACK_TOKEN>
openclaw config set channels.wecom.agent.encodingAESKey <YOUR_ENCODING_AES_KEY>
openclaw config set channels.wecom.enabled true
openclaw gateway restart
```

**步骤 2：在企业微信管理后台保存回调 URL**

回到「API 接收」设置，填入回调 URL：
- **URL**：`https://<your-gateway-host>/plugins/wecom/agent/<accountId>`（例如 `/plugins/wecom/agent/default`）；单账号模式也可使用 `/plugins/wecom/agent`

点击保存，校验应通过。

#### JSON 配置

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

#### Agent 配置参考

| 配置路径 | 说明 | 是否必填 |
|---|---|---|
| `channels.wecom.agent.corpId` | 企业 Corp ID | 是 |
| `channels.wecom.agent.corpSecret` | 应用 secret | 是 |
| `channels.wecom.agent.agentId` | 应用 Agent ID | 否（主动推送消息时需要） |
| `channels.wecom.agent.token` | 回调校验 token | 是 |
| `channels.wecom.agent.encodingAESKey` | 回调加密密钥（43 字符） | 是 |
| `channels.wecom.agent.welcomeText` | 欢迎语 | 否 |
| `channels.wecom.agent.dmPolicy` | 单聊访问策略（覆盖顶层） | 否 |
| `channels.wecom.agent.allowFrom` | 单聊白名单（覆盖顶层） | 否 |

#### Webhook 路径

**Agent 模式：**

| 路径 | 说明 |
|---|---|
| `/plugins/wecom/agent/<accountId>` | 推荐路径（例如 `/plugins/wecom/agent/default`） |
| `/plugins/wecom/agent/default` | 多账号模式下自动路由到默认账号（即使默认账号 ID 不是 `default`） |
| `/plugins/wecom/agent` | 兼容路径（单账号 / 多账号签名匹配） |
| `/wecom/agent` | 旧版兼容路径 |

**Bot Webhook 模式**（`connectionMode: "webhook"`）：

| 路径 | 说明 |
|---|---|
| `/plugins/wecom/bot` | 推荐路径（单账号） |
| `/plugins/wecom/bot/<accountId>` | 多账号路径 |
| `/wecom/bot` | 旧版兼容路径 |
| `/wecom` | 旧版兼容路径 |

### 出站投递（Bot WS → Agent HTTP 兜底）

插件采用 **Bot 优先、Agent 兜底** 的出站消息投递策略：

1. **Bot WebSocket 可用** → 通过 WS 发送（支持 markdown、流式）
2. **Bot WS 不可用** → 自动回退到 **Agent HTTP API**（`cgi-bin/message/send`）

这意味着：
- **仅 Agent 的账号**（未配置 Bot）仍可发送主动消息、Cron 投递与广播
- **目标格式**如 `party:1`、`tag:Ops`、`user:zhangsan` 在两条路径中都完全支持
- **媒体兜底**：当 Bot WS 不可用时，媒体文件先下载、通过 Agent API 上传到企业微信再发送；若上传失败则回退为文本 + URL
- 无需手动切换 — 插件自动处理兜底

### 双模式并用

Bot 与 Agent 可在同一账号上同时运行。Bot 负责 WebSocket 流式；Agent 负责 HTTP webhook 回调与 API 驱动的回复。

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

### 多账号配置

使用 `accounts` 配置多个企业微信账号，每个账号可带可选的 bot 和/或 agent 子配置。账号级字段覆盖同名的顶层字段。

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

> **说明**：多账号模式下，没有显式 `bindings` 的账号不会回退到默认 agent。请为每个账号配置 bindings：
> ```json
> {
>   "bindings": [
>     { "agentId": "your-agent", "match": { "channel": "wecom", "accountId": "main" } }
>   ]
> }
> ```

### 动态 Agent 配置

动态 Agent 路由按用户或群组自动创建隔离的 Agent，实现会话隔离。

```json
{
  "channels": {
    "wecom": {
      "dynamicAgents": {
        "enabled": true,
        "dmCreateAgent": true,
        "groupEnabled": true,
        "adminUsers": ["admin_user_id"]
      }
    }
  }
}
```

| 配置路径 | 说明 | 默认值 |
|---|---|---|
| `channels.wecom.dynamicAgents.enabled` | 启用动态 Agent 路由 | `false` |
| `channels.wecom.dynamicAgents.dmCreateAgent` | 为每个单聊用户创建隔离 Agent | `true` |
| `channels.wecom.dynamicAgents.groupEnabled` | 为群聊启用动态 Agent | `true` |
| `channels.wecom.dynamicAgents.adminUsers` | 管理员用户（绕过动态路由，使用主 Agent） | `[]` |

---

## 🔒 访问控制

### 单聊（Direct Message）访问

**默认**：`dmPolicy: "open"` — 所有用户无需审批即可发送单聊消息。

#### 审批配对

```shell
openclaw pairing list wecom            # 查看待处理的配对请求
openclaw pairing approve wecom <CODE>  # 审批配对请求
```

#### 白名单模式

通过 `channels.wecom.allowFrom` 配置允许的用户 ID：

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

#### 开放模式

设置 `dmPolicy: "open"` 允许所有用户无需审批即可发送单聊消息。

#### 禁用模式

设置 `dmPolicy: "disabled"` 完全屏蔽所有单聊消息。

### 群聊访问

#### 群组策略（`channels.wecom.groupPolicy`）

- `"open"` — 允许所有群聊消息（默认）
- `"allowlist"` — 仅允许 `groupAllowFrom` 中列出的群
- `"disabled"` — 禁用所有群聊消息

### 群组配置示例

#### 允许所有群（默认行为）

```json
{
  "channels": {
    "wecom": {
      "groupPolicy": "open"
    }
  }
}
```

#### 仅允许指定群

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

#### 仅允许群内指定发送者（发送者白名单）

除群白名单外，还可限制群内哪些成员能与机器人交互。仅处理 `groups.<chatId>.allowFrom` 中列出的用户消息，其他成员的消息会被静默忽略。这是发送者级白名单，适用于**所有消息**。

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

## ⏰ Cronjob（定时任务）

插件通过 OpenClaw 内置的 Cron 服务支持定时消息投递。Cron 任务走 **Agent 出站**通道，因此必须配置 Agent 模式。

### 目标格式

`delivery.to` 字段支持以下目标格式：

| 格式 | 目标 | 示例 |
|--------|--------|--------|
| `party:<id>` | 部门（所有成员） | `party:1`（根部门 = 全体员工） |
| `dept:<id>` | 部门（party 的别名） | `dept:5` |
| `tag:<id>` | 标签组 | `tag:Ops` |
| `user:<id>` | 指定用户 | `user:zhangsan` |
| `group:<id>` | 外部群聊 | `group:wr123abc` |
| `chat:<id>` | 群聊（group 的别名） | `chat:wc456def` |
| 纯数字 | 自动识别为部门 | `1` → `party:1` |
| `wr...` / `wc...` | 自动识别为群聊 | `wr123` → `chatid` |
| 其他字符串 | 自动识别为用户 | `zhangsan` → `touser` |

> **命名空间前缀**（`wecom:`、`qywx:`、`wework:`、`wechatwork:`、`wecom-agent:`）在解析前会自动去除。

### 方式一：CLI（推荐 — 立即生效）

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

> **说明**：`--announce` 启用投递模式（将 AI 回复广播到目标会话）。使用 `--no-deliver` 保持内部输出。已废弃的 `--deliver` 标志是 `--announce` 的别名。

常用 CLI 命令：

```shell
openclaw cron list              # 列出所有 cron 任务
openclaw cron show <id>         # 查看任务详情
openclaw cron enable <id>       # 启用任务
openclaw cron disable <id>      # 禁用任务
openclaw cron remove <id>       # 删除任务
openclaw cron run <id>          # 手动触发任务
openclaw cron runs --id <id>    # 查看运行历史
openclaw cron edit <id> --message "New prompt"  # 编辑任务
```

### 方式二：编辑 `jobs.json`（需重启 gateway）

文件路径：`~/.openclaw/cron/jobs.json`

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

编辑后重启 gateway：

```shell
openclaw gateway restart
```

### 方式三：通过对话创建（立即生效）

可以直接在企业微信会话中向 AI 智能体提问：

> "创建一个定时任务：每个工作日早上 9 点向全公司发送每日简报"

智能体会调用 Cron API 创建任务 — 无需重启。

### 注意事项

- Cron 任务使用 **Agent 出站**路径 — 必须配置 Agent 模式（`corpId` / `corpSecret` / `agentId`）。
- 服务器 IP 必须在企业微信可信 IP 白名单内，或配置 `egressProxyUrl` 使用固定出站代理。
- 通过 CLI 或对话 API 创建的任务立即生效。手动编辑 `jobs.json` 需要执行 `openclaw gateway restart`。
- 多账号场景下，将 `delivery.accountId` 设为目标账号（如 `"main"`、`"support"`）。

---

## 📦 更新

```shell
openclaw plugins update wecom-openclaw-plugin
```

---

## 📄 许可证

MIT
