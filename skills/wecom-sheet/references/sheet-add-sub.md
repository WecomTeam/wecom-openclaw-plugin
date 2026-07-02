# sheet_add_sub API

向**在线表格**添加一个新的子工作表，返回新增子表信息（含 `sheet_id`）。

## 调用

使用 `wecom_mcp` tool 调用 `wecom_mcp call doc sheet_add_sub '<JSON 参数>'`

## 参数说明

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| docid | string | 是 | 在线表格 ID |
| sheet | object | 是 | 子表信息 |
| sheet.title | string | 是 | 工作表名称 |
| sheet.row_count | int | 否 | 表格总行数 |
| sheet.column_count | int | 否 | 表格总列数 |
| index | int | 否 | 插入位置：`0` 表示插入到最后，`1` 表示插入到第一个位置 |

## 返回字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `sheet` | object | 新增的子表信息；含 `sheet_id`（唯一标识）/ `title` / `row_count` / `column_count` / `data_range`（新建时为空） |

## 请求示例

```json
{
    "docid": "DOCID",
    "sheet": {
        "title": "新子表",
        "row_count": 100,
        "column_count": 26
    },
    "index": 0
}
```

## 响应示例

```json
{
    "errcode": 0,
    "errmsg": "ok",
    "sheet": {
        "sheet_id": "SHEET_ID",
        "title": "新子表",
        "row_count": 100,
        "column_count": 26,
        "data_range": ""
    }
}
```
