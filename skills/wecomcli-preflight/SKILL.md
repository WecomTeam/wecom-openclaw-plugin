---
name: wecomcli-preflight
description: 企业微信插件前置条件检查。在执行任何 wecom-cli 操作前，通过 shell 命令检查工具权限配置（profile 和白名单），若缺失则自动修复并提示用户重启 Gateway。所有使用 wecom-cli 的技能都应在首次调用前执行此检查。
---

# 企业微信前置条件检查

> 本技能确保 `wecom-cli` 工具已正确获得执行权限。**所有使用 wecom-cli 的技能在首次调用前，必须先执行本检查流程。**

## 触发条件

当满足以下**任一条件**时，执行前置检查：

1. 当前会话中**首次**需要调用 `wecom-cli` 工具
2. 调用 `wecom-cli` 时收到 `tool not allowed`、`not permitted`、`permission denied` 或类似权限错误

> 如果当前会话中已成功调用过 `wecom-cli`（任何操作），则无需重复检查。

---

## 检查流程

> **重要**：以下所有步骤均为 **shell 命令**（在终端中执行），不是 `wecom-cli` 工具调用。
> 这些 shell 命令仅用于检查和修改 OpenClaw 工具权限，严禁用它们直接运行全局 `wecom-cli`。
> `wecom-cli` 在未加入白名单前对 AI Agent 不可见，因此不能用 tool 调用来探测；此时应完成权限修复或向用户报告问题，不得降级到 `exec` / `bash` / `shell` / `npx` 执行 CLI，也不得手动执行 `auth init`。

### 步骤 1：检查 tools.profile

在终端执行以下命令，读取当前 `tools.profile` 配置：

```bash
openclaw config get tools.profile
```

根据返回结果分流：

- **返回 `full`** → ✅ **检查通过**。`full` 模式无任何工具限制，所有工具（包括 `wecom-cli`）直接可用，无需检查 `alsoAllow`，继续执行用户原始请求；通过仅表示专用 tool 可用，即使存在 `exec` 也必须调用专用 `wecom-cli` tool，不得直接运行全局 CLI
- **返回其他值**（如 `coding`、`messaging`、`minimal`、`undefined` 或空）→ 进入步骤 1b（检查 alsoAllow）
- **命令执行失败**（如 `command not found: openclaw`、权限错误等）→ 进入步骤 3（环境异常）

### 步骤 1b：检查 tools.alsoAllow

在终端执行以下命令，读取当前 `tools.alsoAllow` 配置：

```bash
openclaw config get tools.alsoAllow
```

根据返回结果分流：

- **返回内容包含 `wecom-openclaw-plugin`**（如 `["wecom-openclaw-plugin"]` 或 `["wecom-openclaw-plugin", "other_tool"]`）→ ✅ 插件已放行，检查通过，继续执行用户原始请求
- **返回内容不包含 `wecom-openclaw-plugin`**（如空数组 `[]`、`undefined`、或列表中只有旧条目 `wecom_mcp`）→ 进入步骤 2（自动修复）
- **命令执行失败** → 进入步骤 3（环境异常）

---

### 步骤 2：自动修复 tools.alsoAllow

在终端执行以下命令，将企业微信插件加入工具白名单：

```bash
openclaw config set tools.alsoAllow '["wecom-openclaw-plugin"]'
```

> **权限边界**：按插件 ID 放行会允许该插件当前及未来注册的全部工具；这是本插件约定的推荐配置。
>
> **注意**：如果步骤 1b 返回的列表中已有其他工具（如 `["other_tool"]`），需要合并后再写入，例如：
> ```bash
> openclaw config set tools.alsoAllow '["other_tool", "wecom-openclaw-plugin"]'
> ```
> 旧的 `wecom_mcp` 条目已无效，可以保留或自行删除；不要为清理旧条目覆盖其他配置。

根据执行结果分流：

#### 2a. 命令执行成功

向用户回复（**不要自动执行重启**）：

```
✅ 已自动将企业微信插件（wecom-openclaw-plugin）加入工具执行权限白名单（tools.alsoAllow）。
⚠️ 配置变更需要重启 Gateway 后才能生效，请在终端执行以下命令：

openclaw gateway restart

重启完成后请重新发送您的请求。
```

> **为什么不自动重启**：`openclaw gateway restart` 会中断当前所有活跃连接（包括本会话），
> 如果由 AI 自动执行，用户可能无法看到完整的提示信息。交由用户手动重启更可控。

#### 2b. 命令执行失败

向用户回复以下手动修复指引：

```
❌ 自动配置失败，请在终端手动执行以下命令：

openclaw config set tools.alsoAllow '["wecom-openclaw-plugin"]'
openclaw gateway restart

完成后请重新发送您的请求。
```

---

### 步骤 3：环境异常处理

如果步骤 1 或 1b 的 `openclaw` 命令本身执行失败（如 `command not found`、权限不足等），说明 OpenClaw CLI 未正确安装或不在 PATH 中，直接告知用户：

```
⚠️ OpenClaw CLI 不可用：<错误信息>

可能原因：
- OpenClaw 未安装或未加入系统 PATH
- OpenClaw 版本过低，不支持 config 子命令
- 当前 shell 环境缺少必要配置

请检查 OpenClaw 安装状态后重试。
参考：https://docs.openclaw.dev/installation
```

---

## 注意事项

1. **全程使用 shell 命令**：本技能的所有探测和修复操作均通过 `openclaw` CLI 在终端中执行，**不调用 `wecom-cli` 工具**。这样可以避免"tool 未白名单 → tool 不可见 → 无法探测"的死锁问题
2. **profile 优先判断**：`tools.profile` 为 `full` 时所有工具无限制，无需检查 `alsoAllow`，可快速跳过
3. **幂等性**：如果 `tools.alsoAllow` 中已包含 `wecom-openclaw-plugin`，无需重复写入
4. **按插件 ID 放行**：`wecom-openclaw-plugin` 会展开为该插件当前及未来注册的全部工具
5. **保留已有配置**：修改 `tools.alsoAllow` 时需保留已有条目，仅追加 `wecom-openclaw-plugin`；旧的 `wecom_mcp` 可以保留或自行删除
6. **不自动重启**：自动配置成功后仅提示用户重启并附上命令，由用户手动执行，避免会话中断导致信息丢失
7. **会话缓存**：同一会话中一旦检查通过（profile 为 full 或 alsoAllow 包含插件 ID），后续调用无需重复检查
8. **禁止旁路与降级**：`wecom-cli` 专用 tool 内部启动二进制是正常实现；禁止的是 Agent 使用 `exec` / `bash` / `shell` / `npx` 运行全局 CLI。专用 tool 失败、不可见或提示授权时，必须报告权限或配置问题，不得手动执行 `auth init`

---

## 快速参考

| 场景 | 处理方式 |
|------|---------|
| 首次调用 wecom-cli 前 | 执行 `openclaw config get tools.profile` 检查 |
| `tools.profile` 为 `full` | ✅ 跳过，直接执行原始请求 |
| profile 非 full + alsoAllow 已包含 `wecom-openclaw-plugin` | ✅ 跳过，继续执行 |
| profile 非 full + alsoAllow 只有旧 `wecom_mcp` 或不含插件 ID → 自动写入成功 | 追加插件 ID，提示已配置 + 附 `openclaw gateway restart` 命令让用户重启 |
| profile 非 full + alsoAllow 不含插件 ID → 自动写入失败 | 给出手动修复指引 |
| openclaw CLI 不可用 | 告知用户检查 OpenClaw 安装 |
| 会话中已成功调用过 wecom-cli | 跳过检查 |
