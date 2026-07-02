# sheet_update_range_data API

修改**在线表格**指定区域的内容与格式，通过 `grid_data` 指定写入的起始位置与各单元格数据。适合批量写入某个区域。

## 调用

使用 `wecom_mcp` tool 调用 `wecom_mcp call doc sheet_update_range_data '<JSON 参数>'`

## 参数说明

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| docid | string | 是 | 在线表格 ID |
| sheet_id | string | 是 | 工作表 ID，通过 `sheet_get_info` 获取 |
| grid_data | object | 是 | 写入区域的数据 |
| grid_data.start_row | int | 是 | 起始行号，从 0 起 |
| grid_data.start_column | int | 是 | 起始列号，从 0 起 |
| grid_data.rows | array | 是 | 各行数据 |

`grid_data.rows[].values[]` 对象结构：

| 子字段 | 类型 | 说明 |
|---|---|---|
| `cell_value` | object | 单元格值，根据内容类型选择对应字段（见下表）|
| `cell_format` | object | 单元格样式；传空对象 `{}` 表示默认样式 |

`cell_value` 的字段必须按内容类型选择：

| 内容类型 | 必须使用的字段 | 示例 |
|---|---|---|
| 普通文本/数字 | `text` | `{"text": "张三"}`、`{"text": "100"}` |
| 超链接 | `link` | `{"link": {"url": "https://...", "text": "显示文本"}}` |
| 公式（以 `=` 开头） | `formula` | `{"formula": "=SUM(A1:A2)"}` |

> 公式必须用 `formula` 字段，禁止写成 `{"text": "=SUM(A1:A2)"}`

## 返回字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `grid_data` | object | 写入的数据，结构与入参 `grid_data` 一致 |

## 请求示例

```json
{
    "docid": "DOCID",
    "sheet_id": "SHEET_ID",
    "grid_data": {
        "start_row": 0,
        "start_column": 0,
        "rows": [
            {
                "values": [
                    { "cell_value": { "text": "完成需求文档" }, "cell_format": {} },
                    { "cell_value": { "text": "张三" }, "cell_format": {} }
                ]
            },
            {
                "values": [
                    { "cell_value": { "text": "合计" }, "cell_format": {} },
                    { "cell_value": { "formula": "=SUM(B1:B1)" }, "cell_format": {} }
                ]
            }
        ]
    }
}
```

## 响应示例

```json
{
    "errcode": 0,
    "errmsg": "ok",
    "grid_data": {
        "start_row": 0,
        "start_column": 0,
        "rows": [
            {
                "values": [
                    { "cell_value": { "text": "完成需求文档" } },
                    { "cell_value": { "text": "张三" } }
                ]
            }
        ]
    }
}
```

## 使用规则

- 批量写不同区域用本接口；逐行追加到子表末尾请用 `sheet_append_data`。
- **公式一律用 `formula` 字段**：任何以 `=` 开头的内容（如 `=SUM(...)`、`=A1+B1`、`=IF(...)`）都必须写成 `{"formula": "=..."}`，不可写成 `{"text": "=..."}`，否则只会被当作文本显示而不计算。
- **读 → 写 链路**：写入前先用 `get_doc_content` 识别出目标子表的**标题**与**具体数据**，再用 `sheet_get_info` 拿到 `sheets[]`，按**子表标题匹配 `title`** 确定 `sheet_id`，并参考其 `row_count` / `column_count` 核对 `grid_data` 的写入区域是否越界。
