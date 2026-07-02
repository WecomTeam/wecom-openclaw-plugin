---
name: wecom-doc
description: 企业微信文档（doc）管理技能。提供普通文档的新建、内容读取（Markdown）、内容覆写能力。适用场景：(1) 从零新建空白文档 (2) 以 Markdown 格式读取文档完整内容 (3) 用 Markdown 覆写文档正文。支持通过 docid 或文档 URL 定位文档。当用户提到「企业微信文档」「企微文档」「创建文档」「写个文档」，或链接形如 `https://doc.weixin.qq.com/doc/xxx` 时触发该技能。注意：在线表格（`/sheet/*`）请用 `wecom-sheet`；智能表格（`/smartsheet/*`）请用 `wecom-smartsheet`；智能文档/智能主页（`/smartpage/*`）请用 `wecom-smartpage`。
---

# 企业微信文档管理

> `wecom_mcp` 是一个 MCP tool，所有操作通过调用该 tool 完成。

> ⚠️ **前置条件**：首次调用 `wecom_mcp` 前，必须按 `wecom-preflight` 技能执行前置条件检查，确保工具已加入白名单。

资源型技能，负责普通 doc 文档的新建、内容读取与覆写。文档接口支持通过 `docid` 或 `url` 二选一定位文档。

## URL 品类识别与接口路由

企业微信文档有多种品类，**URL 格式不同，所用的接口/技能也不同**。请通过 URL 严格区分：

| URL 模式 | 品类 | 处理方式 |
|---|---|---|
| `https://doc.weixin.qq.com/doc/*` | **文档** | **本 skill** |
| `https://doc.weixin.qq.com/sheet/*` | **在线表格** | 参阅 `wecom-sheet` skill |
| `https://doc.weixin.qq.com/smartsheet/*` | **智能表格** | 参阅 `wecom-smartsheet` skill |
| `https://doc.weixin.qq.com/smartpage/*` | **智能文档**（原名智能主页） | 参阅 `wecom-smartpage` skill |

## 调用方式

通过 `wecom_mcp` tool 调用，品类名为 `doc`：

使用 `wecom_mcp` tool 调用 `wecom_mcp call doc <tool_name> '<json_params>'` 调用指定技能

## 返回格式说明

所有接口返回 JSON 对象，包含以下公共字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `errcode` | integer | 返回码，`0` 表示成功，非 `0` 表示失败 |
| `errmsg` | string | 错误信息，成功时为 `"ok"` |

当 `errcode` 不为 `0` 时，说明接口调用失败，可重试 1 次；若仍失败，将 `errcode` 和 `errmsg` 展示给用户。

### 特殊错误码

| errcode | errmsg | 含义 | 处理方式 |
|---------|--------|------|----------|
| `851002` | `incompatible doc type` | 文档品类与所调用的接口不匹配 | 根据文档 URL 重新确认品类（参见上方「URL 品类识别与接口路由」表），然后跳转到该品类对应的 skill |

## 接口详述

### create_doc — 新建文档

新建一篇空白企微文档（`doc_type` 固定为 3）。创建成功后返回 `docid` 和 `url`。

使用 `wecom_mcp` tool 调用 `wecom_mcp call doc create_doc '{"doc_type": 3, "doc_name": "项目周报"}'`

**参数**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `doc_type` | int | 是 | — | 固定传 `3`（文档） |
| `doc_name` | string | 是 | — | 文档标题，最多 255 个字符，超过会被截断 |

**返回**

| 字段 | 类型 | 说明 |
|---|---|---|
| `docid` | string | 新建文档的 docid，需妥善保存 |
| `url` | string | 新建文档的访问链接 |

**注意事项**

- 本接口仅创建**空白**文档，不携带初始内容；如需写入正文，请在创建后调用 `edit_doc_content`。

### get_doc_content — 读取完整内容

获取文档的完整内容数据，统一以 Markdown 格式返回。采用**异步轮询机制**：首次调用无需传 `task_id`，接口返回 `task_id`；若 `task_done` 为 `false`，需携带该 `task_id` 再次调用，直到 `task_done` 为 `true` 时返回完整内容。

- 首次调用（不传 task_id）：使用 `wecom_mcp` tool 调用 `wecom_mcp call doc get_doc_content '{"docid": "DOCID", "type": 2}'`
- 轮询（携带上次返回的 task_id）：使用 `wecom_mcp` tool 调用 `wecom_mcp call doc get_doc_content '{"docid": "DOCID", "type": 2, "task_id": "xxx"}'`
- 通过 URL 读取：使用 `wecom_mcp` tool 调用 `wecom_mcp call doc get_doc_content '{"url": "https://doc.weixin.qq.com/doc/xxx", "type": 2}'`

**参数**

| 字段 | 类型 | 必填 | 默认值 | 语义 |
|---|---|---|---|---|
| `docid` | string | 与 `url` 二选一 | — | 文档的 docid |
| `url` | string | 与 `docid` 二选一 | — | 文档的访问链接 |
| `type` | int | 是 | — | 内容返回格式，固定传 `2`（Markdown） |
| `task_id` | string | 否 | — | 任务 ID，首次不传，轮询时填上次返回的 `task_id` |

**返回**

| 字段 | 类型 | 说明 |
|---|---|---|
| `content` | string | `task_done` 为 `true` 时返回的完整 Markdown 内容 |
| `task_id` | string | 任务 ID，未完成时用于下次轮询 |
| `task_done` | bool | 任务是否完成，`false` 时需携带 `task_id` 继续轮询 |

**使用规则**

- 首次调用不传 `task_id`；若 `task_done` 为 `false`，记录 `task_id` 后携带其再次调用，直到 `task_done` 为 `true` 取 `content`。

### edit_doc_content — 覆写文档内容

用 Markdown 内容覆写文档正文。此操作为**覆写**，会替换文档全部内容。`content_type` 固定为 `1`（Markdown）。

使用 `wecom_mcp` tool 调用 `wecom_mcp call doc edit_doc_content '{"docid": "DOCID", "content": "# 标题\n\n正文内容", "content_type": 1}'`

**参数**

| 字段 | 类型 | 必填 | 默认值 | 语义 |
|---|---|---|---|---|
| `docid` | string | 与 `url` 二选一 | — | 文档的 docid |
| `url` | string | 与 `docid` 二选一 | — | 文档的访问链接 |
| `content` | string | 是 | — | 覆写的文档内容（Markdown） |
| `content_type` | int | 是 | — | 内容类型，固定传 `1`（Markdown） |

**使用规则**

- 此操作为覆写，会替换文档全部内容；建议先用 `get_doc_content` 了解当前内容再编辑。
- 成功判定：以返回的 `errcode == 0` 为准；非 0 时按「返回格式说明」处理（可重试 1 次）。

## 跨技能依赖

| 依赖技能 | 典型协作场景 | 数据流向 |
|---|---|---|
| `wecom-msg` | 用户要求把文档链接发给某人/某群 | 本 skill 新建后返回 `url` → `wecom-msg` 发送链接 |
