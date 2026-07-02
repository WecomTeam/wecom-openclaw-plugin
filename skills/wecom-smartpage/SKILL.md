---
name: wecom-smartpage
description: 企业微信智能文档（原名智能主页，smartpage）管理技能。提供智能文档的创建（将本地 Markdown 文件发布为智能文档）与内容导出（异步导出为 Markdown）能力。适用场景：(1) 将一个或多个本地 Markdown 文件创建为智能文档 (2) 异步导出智能文档内容为 Markdown。支持通过 docid 或文档 URL 定位文档。当用户明确提到「智能文档」「智能主页」，或链接形如 `https://doc.weixin.qq.com/smartpage/xxx` 时触发该技能。注意：普通文档（`/doc/*`）请用 `wecom-doc`；在线表格（`/sheet/*`）请用 `wecom-sheet`；智能表格（`/smartsheet/*`）请用 `wecom-smartsheet`。
---

# 企业微信智能文档管理

> `wecom_mcp` 是一个 MCP tool，所有操作通过调用该 tool 完成。

> ⚠️ **前置条件**：首次调用 `wecom_mcp` 前，必须按 `wecom-preflight` 技能执行前置条件检查，确保工具已加入白名单。

资源型技能，负责**智能文档**（原名智能主页，`/smartpage/*`）的创建与内容导出。

> ⚠️ **重要触发规则**：只有当用户明确提到「**智能文档**」或「**智能主页**」时，才使用本技能。其他所有涉及「文档」的场景（如"创建文档"、"写个文档"、"帮我建个文档"等），一律使用 `wecom-doc` 技能。

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
| `851002` | `incompatible doc type` | 文档品类与所调用的接口不匹配 | 确认目标 URL 为 `/smartpage/*`；若不是，请跳转到对应品类的 skill |

## 接口详述

### smartpage_create — 创建智能文档

创建智能文档（原名智能主页），支持传入标题和多个子页面。每个子页面可指定标题、内容类型和本地文件路径。创建成功返回 `docid` 和 `url`。

使用 `wecom_mcp` tool 调用 `wecom_mcp call doc smartpage_create '{"title": "项目概览", "pages": [{"page_title": "需求文档", "content_type": 1, "page_filepath": "/path/to/requirements.md"}]}'`

**参数**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `title` | string | 否 | — | 智能文档标题 |
| `pages` | array | 是 | — | 子页面列表 |
| `pages[].page_title` | string | 否 | — | 子页面标题 |
| `pages[].content_type` | int | 否 | 1 | 内容类型：1-Markdown，0-Text（纯文本） |
| `pages[].page_filepath` | string | 否 | — | 子页面内容对应的本地文件路径 |

**注意事项**

- `content_type` **必须与文件实际内容匹配**：`.md` 文件或包含 Markdown 语法的内容必须传 `1`（Markdown），仅纯文本才传 `0`。绝大多数场景应传 `1`。
- `docid` 仅在创建时返回，需妥善保存。
- 每个子页面的 Markdown 文件大小不得超过 **10MB**，超过会导致创建失败；如文件过大，需先拆分为多个子页面再创建。
- 智能文档还支持背景块（`<card>`）、分栏（`<grid>`）等扩展语法，详见 [references/smartpage-create.md](references/smartpage-create.md)。

参见 [API 详情](references/smartpage-create.md)。

### smartpage_export_task — 提交导出任务

发起智能文档内容导出任务（异步）。传入 `docid`（或 `url`）和 `content_type`，返回 `task_id`。这是异步导出的第一步，需配合 `smartpage_get_export_result` 轮询获取导出结果。

- 通过 docid：使用 `wecom_mcp` tool 调用 `wecom_mcp call doc smartpage_export_task '{"docid": "DOCID", "content_type": 1}'`
- 或通过 URL：使用 `wecom_mcp` tool 调用 `wecom_mcp call doc smartpage_export_task '{"url": "https://doc.weixin.qq.com/smartpage/xxx", "content_type": 1}'`

**参数**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `docid` | string | 与 `url` 二选一 | — | 智能文档的 docid |
| `url` | string | 与 `docid` 二选一 | — | 智能文档的访问链接 |
| `content_type` | int | 是 | — | 导出内容格式，目前仅支持 `1`（Markdown） |

参见 [API 详情](references/smartpage-export.md)。

### smartpage_get_export_result — 查询导出结果

查询智能文档导出任务进度。传入 `task_id` 进行轮询，当 `task_done` 为 `true` 时返回 `content_filepath`（导出内容的本地文件路径）。

使用 `wecom_mcp` tool 调用 `wecom_mcp call doc smartpage_get_export_result '{"task_id": "TASK_ID"}'`

**参数**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `task_id` | string | 是 | — | 由 `smartpage_export_task` 返回的任务 ID |

**使用规则**

- 第一步获取 `task_id` 后，携带其调用第二步；若 `task_done` 为 `false` 则继续轮询，直到 `task_done` 为 `true`。
- 当 `task_done` 为 `true` 时，使用 Read 工具读取 `content_filepath` 指向的本地文件即可获取导出的 Markdown 内容。

参见 [API 详情](references/smartpage-export.md)。

## 典型工作流

### 创建智能文档

1. 准备本地 Markdown 文件（每个子页面对应一个 `.md` 文件，单个文件 ≤10MB）
2. **创建智能文档** → 使用 `wecom_mcp` tool 调用 `wecom_mcp call doc smartpage_create '{"title": "标题", "pages": [{"page_title": "子页面", "content_type": 1, "page_filepath": "/path/to/file.md"}]}'`，保存返回的 `docid`

### 导出智能文档内容（异步两步）

1. **发起导出任务** → 使用 `wecom_mcp` tool 调用 `wecom_mcp call doc smartpage_export_task '{"docid": "DOCID", "content_type": 1}'`，获取 `task_id`
2. **轮询导出结果** → 使用 `wecom_mcp` tool 调用 `wecom_mcp call doc smartpage_get_export_result '{"task_id": "TASK_ID"}'`，若 `task_done` 为 `false` 则继续轮询，直到 `task_done` 为 `true`
3. **读取本地文件** → 使用 Read 工具读取 `content_filepath` 指向的本地文件，获取 Markdown 内容

## 跨技能依赖

| 依赖技能 | 典型协作场景 | 数据流向 |
|---|---|---|
| `wecom-msg` | 用户要求把智能文档链接发给某人/某群 | 本 skill 创建后返回 `url` → `wecom-msg` 发送链接 |
