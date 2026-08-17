# 删除子工作表 — `wecom-cli sheet subsheets delete`

根据 `docid` 与 `sheet_id` 删除**在线表格**的指定子工作表。

## 调用方式

使用 wecom-cli 工具按照下面格式调用

```
wecom-cli sheet subsheets delete --json '<JSON 参数>'
```

## 参数

| 字段 | 类型 | 必填 | 默认值 | 语义 |
|---|---|---|---|---|
| `docid` | string | 是 | — | 在线表格 ID |
| `sheet_id` | string | 是 | — | 要删除的工作表 ID；通过 `sheet get` 获取 |

## 返回

删除成功返回空对象。
