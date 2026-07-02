# 智能表格 Webhook 兜底写入

> 本文档是 `smartsheet_add_records` / `smartsheet_update_records` 的 **fallback 参考**。
> 当通过 `wecom_mcp` tool 调用因企业规模限制（可见范围 > 10 人）报错、无法写入智能表格时，切换到本方案，通过企业微信智能表格的 Webhook 接口直接写入数据。
>
> ⚠️ **格式隔离**：以下字段值格式仅适用于 Webhook 接口，与 `wecom_mcp` tool 侧 `smartsheet_add_records` / `smartsheet_update_records` 的参数结构**不同**（例如文本、URL、图片、日期的写法均有差异），请勿与 [cell-value-formats.md](cell-value-formats.md) 的格式混用。

---

## 一、Fallback 触发流程

### 何时切换到 Webhook

先走 `wecom_mcp` tool 正常链路（`smartsheet_add_records` / `smartsheet_update_records`）。仅在出现以下情况时才切换到 Webhook：

- **优先判据**：返回 `errcode: 851003`，或 `errmsg` 包含 `no authority` —— 无文档权限。在编辑场景，通常是因为机器人不允许编辑由企业成员创建的文档
- 或 `errmsg` / 提示信息明显指向**无文档权限**（例如"超出可见范围"、"成员数超限"等相关描述）- 其他错误（参数错误、字段 ID 错误、文档不存在等）**不应**切换到 Webhook，应按原错误排查

### 切换时向用户索取的两样东西

切换触发后，**每次对话内临时获取，用完即弃，不保存到本地任何位置**：

1. **Webhook 完整 URL**
   - 在智能表格右上角菜单 → 「接收外部数据」→ 选择目标工作表 → 开启 → 复制
   - 格式形如 `https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=XXXXXX`
   - 该 URL 相当于该表的写入密钥，用户随时可以在智能表格里关闭「接收外部数据」使其失效
2. **schema 示例 JSON**
   - 同一「接收外部数据」页面即可复制
   - 包含字段 ID → 字段名的映射（`schema`）和各字段的写入格式示例（`add_records`）

示例：

```json
{
  "schema": {
    "fABCD1": "任务名称",
    "fABCD2": "状态",
    "fABCD3": "负责人",
    "fABCD4": "截止日期"
  },
  "add_records": [
    {
      "values": {
        "fABCD1": "示例任务",
        "fABCD2": [{"text": "未开始"}],
        "fABCD3": [{"user_id": ""}],
        "fABCD4": "1742400000000"
      }
    }
  ]
}
```

### 向用户告知的话术参考

- “通过 `wecom_mcp` 写入接口返回了 `851003 no authority`，无文档权限（在编辑场景，通常是因为机器人不允许编辑由企业成员创建的文档）。请把目标表的 Webhook 地址和「接收外部数据」页面的示例 JSON 发我，我帮你通过 Webhook 写入。该信息仅本轮使用，不会保存到本地。”

---

## 二、构建请求

### 字段匹配

用户描述通常是自然语言（“标题”“状态”“处理人”），需从用户提供的 `schema` 中找对应字段 ID：

- 模糊匹配：`标题` → 标题 / 名称 / 主题；`状态` → 状态 / 阶段；`处理人` → 负责人 / 责任人
- 不确定时先问用户确认，避免写错字段

各字段类型的值写法见下方 [字段类型格式规范](#三字段类型格式规范)；真实场景示例见 [webhook-examples.md](webhook-examples.md)。

### 日期处理

用户说“今天”“明天”“3 月 15 日”“2025-03-01 09:00”等自然语言日期时，**在 payload 构造阶段**根据当前日期推算为**毫秒时间戳字符串**（如 `"1742400000000"`）。Webhook 侧**不接受**可读日期字符串。

### 请求结构

Webhook 是标准 HTTP 接口，不经过 `wecom_mcp`，请按执行环境选择合适的工具发送（`curl`、`node` 内置 `fetch`、`python` 的 `requests` / `urllib` 等均可，优先用当前环境最便捷的方式）：

| 项 | 值 |
|---|---|
| Method | `POST` |
| URL | 用户提供的 Webhook 完整 URL（含 `?key=XXX`） |
| Header | `Content-Type: application/json` |
| Body | JSON 对象，包含 `add_records` 和/或 `update_records` 字段 |

### Body 结构

- 仅新增：

```json
{
  "add_records": [
    { "values": { "fABCD1": "...", "fABCD2": [{"text": "..."}] } }
  ]
}
```

- 仅更新（需提供 `record_id`，且**只能更新通过 Webhook 写入的记录**，人工创建的记录无法更新）：

```json
{
  "update_records": [
    { "record_id": "REC_xxx", "values": { "fABCD2": [{"text": "已完成"}] } }
  ]
}
```

- 同一请求同时新增和更新：

```json
{
  "add_records":    [ { "values": { ... } } ],
  "update_records": [ { "record_id": "REC_xxx", "values": { ... } } ]
}
```

### 成功后

简洁告知结果，例如：

> “已通过 Webhook 写入，record_id: `REC_xxx`”

返回非 0 `errcode` 时参考下方 [常见错误码](#六常见错误码)。

---

## 三、字段类型格式规范

### 各类型写法

| 字段类型 | value 示例 | 说明 |
|---------|-----------|------|
| 文本 | `"产品登录页白屏"` 或 `[{"type":"text","text":"产品登录页白屏"}]` | 简单字符串更简洁 |
| 数字 / 货币 | `58000` | double，不要加引号 |
| 进度 / 百分数 | `30` | 传整数值，`30` = 30%；**不要传小数** `0.3`（那样会显示 0.3%） |
| 复选框 | `true` / `false` | bool |
| 日期 | `"1740806400000"` | 毫秒时间戳，字符串形式 |
| 成员 | `[{"user_id":"lisi"}]` 或 `["张三"]` 或 `[]` | userid 通常就是企业微信登录账号；不指定时传 `[]` |
| 单选 | `[{"text":"已完成"}]` | 数组，选项文本必须与表格预设完全一致 |
| 多选 | `[{"text":"前端"},{"text":"后端"}]` | 数组，每个选项一个对象 |
| 链接 | `[{"text":"需求文档","link":"https://doc.example.com"}]` | 数组 |
| 地理位置 | `[{"latitude":"31.23040","longitude":"121.47370","source_type":1,"title":"上海市徐汇区"}]` | 数组，最多 1 条 |
| 图片 | `[{"title":"screenshot.png","image_base64":"iVBORw0KGgo..."}]` | 纯 base64，**不要带 `data:image/...;base64,` 前缀**，否则报 errcode 2023033 |
| 电话 / 邮箱 / 条码 | `"13800138000"` | 字符串 |

---

## 四、不支持的字段

以下字段由系统自动维护或结构特殊，Webhook 写入时**跳过即可，不要报错**：

公式、自动编号、查找引用、关联字段、创建人、最后编辑人、创建时间、最后编辑时间、群聊、文件附件。

---

## 五、频率限制

- 单工作表：≤ 3000 条/分钟
- 单文档：≤ 10000 条/分钟

数据量大时建议分批，每批不超过 500 条。

---

## 六、常见错误码

| errcode | 原因 | 解决方法 |
|---------|------|---------|
| 2023033 | 图片 base64 携带了 `data:image/...;base64,` 前缀 | 去掉前缀，只传纯 base64 字符串 |
| 40014 | Webhook key 无效或已过期 | 请用户重新在智能表格「接收外部数据」获取 Webhook 地址 |
| 45033 | 超出频率限制 | 降低发送速率或分批发送 |
| -100035 | testapi 域名不稳定（超时） | 改用正式域名 `qyapi.weixin.qq.com` |
| 2023001 | 字段 ID 不存在 | 核对用户提供的 `schema`，确认字段 ID 拼写正确 |
| 2023010 | 单选/多选的选项值不在预设列表 | 确认选项文本与表格设置完全一致（区分大小写） |
| 2023012 | record_id 不存在（更新时） | 只能更新通过 Webhook 写入的记录，人工创建的记录无法更新 |

---

## 七、参考文件

- 真实场景示例 → [webhook-examples.md](webhook-examples.md)

按需查阅，不用每次全读。
