# sheet_delete_sub API

根据 `docid` 与 `sheet_id` 删除**在线表格**的指定子工作表，**操作不可逆**。

## 调用

使用 `wecom_mcp` tool 调用 `wecom_mcp call doc sheet_delete_sub '<JSON 参数>'`

## 参数说明

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| docid | string | 是 | 在线表格 ID |
| sheet_id | string | 是 | 要删除的工作表 ID，通过 `sheet_get_info` 获取 |

## 请求示例

```json
{
    "docid": "DOCID",
    "sheet_id": "SHEET_ID"
}
```

## 响应示例

删除成功返回空对象（仅含公共字段）：

```json
{
    "errcode": 0,
    "errmsg": "ok"
}
```

## 注意事项

- **操作不可逆**，删除前请通过 `sheet_get_info` 确认目标 `sheet_id`。
