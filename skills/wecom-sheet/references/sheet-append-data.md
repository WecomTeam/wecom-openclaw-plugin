# sheet_append_data API

向**在线表格**的指定子工作表末尾自动追加一行数据，无需指定行号——数据将写到最末一行之后。适合逐行写入。

## 调用

使用 `wecom_mcp` tool 调用 `wecom_mcp call doc sheet_append_data '<JSON 参数>'`

## 参数说明

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| docid | string | 是 | 在线表格 ID |
| sheet_id | string | 是 | 工作表 ID，通过 `sheet_get_info` 获取 |
| row | object | 是 | 追加的一行数据 |
| row.values | array | 是 | 单元格数组，按列顺序排列 |

`row.values[]` 对象结构：

| 子字段 | 类型 | 说明 |
|---|---|---|
| `cell_value` | object | 单元格值，形如 `{"text": "<文本>"}` / `{"link": {"url": "<URL>", "text": "<显示文本>"}}` / `{"formula": "=SUM(A1,A2)"}` |
| `cell_format` | object | 单元格样式；传空对象 `{}` 表示默认样式 |

## 返回字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `row` | object | 写入的行数据，结构与入参 `row` 一致 |

## 请求示例

```json
{
    "docid": "DOCID",
    "sheet_id": "SHEET_ID",
    "row": {
        "values": [
            { "cell_value": { "text": "新任务" }, "cell_format": {} },
            { "cell_value": { "text": "李四" }, "cell_format": {} }
        ]
    }
}
```

## 响应示例

```json
{
    "errcode": 0,
    "errmsg": "ok",
    "row": {
        "values": [
            { "cell_value": { "text": "新任务" } },
            { "cell_value": { "text": "李四" } }
        ]
    }
}
```

## 使用规则

- **逐行写入场景**：本接口会自动定位到子表最末一行之后追加；批量写不同区域请用 `sheet_update_range_data`。
- **读 → 写 链路**：写入前先用 `get_doc_content` 识别出目标子表的**标题**与**具体数据**，再用 `sheet_get_info` 拿到 `sheets[]`，按**子表标题匹配 `title`** 确定 `sheet_id`，并参考其 `column_count` 核对每行单元格数量与列对齐。
