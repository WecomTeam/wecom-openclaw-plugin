---
name: wecom-sheet
description: 企业微信在线表格（sheet）管理技能。提供在线表格的新建、内容读取、内容修改、追加行数据，以及子工作表的增删管理。适用场景：(1) 新建空白在线表格 (2) 读取表格完整内容（Markdown）(3) 读取基础信息与子表列表 (4) 读取子表数据 (5) 修改指定区域内容 (6) 末尾追加一行数据 (7) 添加/删除子工作表。当用户提到「企业微信表格」「企业微信在线表格」「企微 excel 表格」，或链接形如 `https://doc.weixin.qq.com/sheet/xxx` 时触发该技能。注意：智能表格（`/smartsheet/*`）请用 `wecom-smartsheet`；普通文档（`/doc/*`）请用 `wecom-doc`；智能文档/智能主页（`/smartpage/*`）请用 `wecom-smartpage`。
---

# 企业微信在线表格管理

> `wecom_mcp` 是一个 MCP tool，所有操作通过调用该 tool 完成。

> ⚠️ **前置条件**：首次调用 `wecom_mcp` 前，必须按 `wecom-preflight` 技能执行前置条件检查，确保工具已加入白名单。

资源型技能，负责**在线表格**（`/sheet/*`）的新建、内容读写以及子工作表管理。

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
| `851002` | `incompatible doc type` | 文档品类与所调用的接口不匹配 | 确认目标 URL 为 `/sheet/*`；若不是，请跳转到对应品类的 skill |

## 接口路由表

> **硬规则**：第二列是 `references/xxx.md` 链接的，命中这一行后**先 `read` 对应 references 文件，再构造命令**。写入/读取子表数据前，先用 `sheet_get_info` 拿到目标子表的 `sheet_id`。

| 用户意图 | 参考位置 |
|---|---|
| 读取在线表格完整内容（Markdown 概览） | 见下方「读取完整内容」 |
| 读取在线表格基础信息与子表列表 | 见下方「读取基础信息」 |
| 从零新建在线表格（空白） | 见下方「新建在线表格」 |
| 修改在线表格指定区域内容 | [references/sheet-update-range-data.md](references/sheet-update-range-data.md) |
| 在线表格末尾追加一行数据 | [references/sheet-append-data.md](references/sheet-append-data.md) |
| 添加在线表格子工作表 | [references/sheet-add-sub.md](references/sheet-add-sub.md) |
| 删除在线表格子工作表 | [references/sheet-delete-sub.md](references/sheet-delete-sub.md) |

## 接口详述

### create_doc — 新建在线表格

从零新建一篇企微**在线表格**：空白。创建成功后返回 `docid` 和 `url`。

使用 `wecom_mcp` tool 调用 `wecom_mcp call doc create_doc '{"doc_type": 4, "doc_name": "项目数据表"}'`

**参数**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `doc_type` | int | 是 | — | 固定传 `4`（在线表格） |
| `doc_name` | string | 是 | — | 表格标题 |

**注意事项**

- 本接口仅创建**空白**在线表格，不支持携带初始内容；如需写入数据，请在创建后先用 `sheet_get_info` 拿到子表 `sheet_id`，再通过 `sheet_update_range_data` / `sheet_append_data` 写入。

### get_doc_content — 读取完整内容

获取**在线表格**的完整内容数据，统一以 Markdown 格式返回。采用**异步轮询机制**：首次调用无需传 `task_id`，接口返回 `task_id`；若 `task_done` 为 `false`，需携带该 `task_id` 再次调用，直到 `task_done` 为 `true` 时返回完整内容。适合快速概览或读取整篇表格内容。

- 首次调用（不传 task_id）：使用 `wecom_mcp` tool 调用 `wecom_mcp call doc get_doc_content '{"docid": "DOCID", "type": 2}'`
- 轮询（携带上次返回的 task_id）：使用 `wecom_mcp` tool 调用 `wecom_mcp call doc get_doc_content '{"docid": "DOCID", "type": 2, "task_id": "xxx"}'`
- 通过 URL：使用 `wecom_mcp` tool 调用 `wecom_mcp call doc get_doc_content '{"url": "https://doc.weixin.qq.com/sheet/xxx", "type": 2}'`

**参数**

| 字段 | 类型 | 必填 | 默认值 | 语义 |
|---|---|---|---|---|
| `docid` | string | 与 `url` 二选一 | — | 在线表格的 docid |
| `url` | string | 与 `docid` 二选一 | — | 在线表格的访问链接 |
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

### sheet_get_info — 读取基础信息

读取**在线表格**的基础信息，包括工作表列表、文档名称与访问链接。所有后续需要 `sheet_id` 的接口（`sheet_update_range_data` / `sheet_append_data` / `sheet_delete_sub` 等）的 `sheet_id` 都从本接口返回的 `sheets[]` 中取。

- 通过 docid：使用 `wecom_mcp` tool 调用 `wecom_mcp call doc sheet_get_info '{"docid": "DOCID"}'`
- 通过 URL：使用 `wecom_mcp` tool 调用 `wecom_mcp call doc sheet_get_info '{"url": "https://doc.weixin.qq.com/sheet/xxx"}'`

**参数**

| 字段 | 类型 | 必填 | 默认值 | 语义 |
|---|---|---|---|---|
| `docid` | string | 与 `url` 二选一 | — | 在线表格的 docid |
| `url` | string | 与 `docid` 二选一 | — | 在线表格的访问链接 |

**返回**

| 字段 | 类型 | 说明 |
|---|---|---|
| `sheets` | array | 工作表列表；每项含 `sheet_id` / `title` / `row_count` / `column_count` / `data_range` 等基础信息 |
| `url` | string | 文档访问链接 |
| `name` | string | 文档名称 |

**使用规则**

- `docid` 与 `url` 二选一，至少传其一。
- **读 → 写 链路**：当需要往具体子表写内容（`sheet_update_range_data` / `sheet_append_data`）时，应先用 `get_doc_content` 读取并识别出各子表的**标题**与**具体数据**，再调用本接口拿到 `sheets[]` 中每个子表的 `sheet_id` 与行列数（`row_count` / `column_count`）；通过**子表标题与 `title` 匹配**确定目标 `sheet_id`，并结合行列数核对写入区域范围，从而打通「读 → 写」的完整链路。

## 跨技能依赖

| 依赖技能 | 典型协作场景 | 数据流向 |
|---|---|---|
| `wecom-contact` | 表格里需要写入人员信息时按姓名查 userid | `get_userlist` 查到 userid → 本 skill 写入 |
| `wecom-msg` | 用户要求把在线表格链接发给某人/某群 | 本 skill 新建后返回 `url` → `wecom-msg` 发送链接 |
