/**
 * wecom-cli tool 常量
 */

/** tool 名（与 openclaw.plugin.json 的 contracts.tools 必须完全一致） */
export const CLI_TOOL_NAME = "wecom-cli";

/**
 * 日志前缀。
 *
 * 必须与 agent 通过 exec 直接执行 `wecom-cli` 的情形可区分——
 * 两者在日志里都叫 wecom-cli，排查"串号"问题时需要靠这个前缀分辨。
 */
export const CLI_LOG = "[wecom-cli:tool]";

/** 单次业务命令 spawn 超时（实测热缓存调用仅 300~500ms） */
export const CLI_TIMEOUT_MS = 45_000;

/**
 * `auth init` 的 spawn 超时，比业务命令短。
 *
 * 授权只有一次 HTTP 鉴权，30s 足够覆盖慢网。
 * 更重要的是它是**唯一**能兜住"cli 写 keyring 时挂住"的手段：
 * cli 的 save_key 对 keyring 失败只 warn，但 macOS Keychain 可能弹窗等待授权，
 * 而 gateway 是后台进程 → 弹窗没人点 → 进程永久挂住。
 */
export const CLI_AUTH_TIMEOUT_MS = 30_000;

/** 超时后 SIGTERM 到 SIGKILL 的宽限期 */
export const CLI_KILL_GRACE_MS = 3_000;

/** SIGKILL 后等待 close 事件的上限，超过后主动结束插件侧等待 */
export const CLI_KILL_FORCE_WAIT_MS = 3_000;

/** 返回给模型的输出上限。openclaw 无通用截断机制，必须由插件自己兜住 */
export const CLI_MAX_OUTPUT_BYTES = 64 * 1024;

/** 同一配置目录的重签冷却，避免 secret 失效时反复撞 45009 频率超限 */
export const CLI_RESIGN_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * 禁止的顶层子命令。
 *
 * `init` 无非交互入口，会拉起cliclack /扫码流程。
 */
export const CLI_FORBIDDEN_SUBCOMMANDS = new Set(["init"]);

/**
 * 禁止的 `auth` 子动作（`argv[0] === "auth"` 时检查 `argv[1]`）。
 *
 * 为什么单独拦：授权命令是 `auth init`，`argv[0]` 是 `auth` 而非 `init`，
 * 不在上面的顶层禁用集内。而凭据现在完全由插件管理
 * （`credentials.ts` 会按当前会话机器人 spawn `auth init --bot-id/--secret`），
 * 模型自行触发只有两种结果：
 *   - 不带凭据 → stderr 非 TTY 下走扫码分支 → 挂到超时
 *   - 带凭据 → 它拿不到 secret，只能瞎猜；即便猜对也绕过了 openclaw 配置
 * `auth show` / `auth status` 之类只读动作不受影响。
 */
export const CLI_FORBIDDEN_AUTH_ACTIONS = new Set(["init", "login", "logout", "bind", "unbind"]);

/**
 * argv[0] 合法格式。
 *
 * 这里刻意不用"品类白名单"——品类由服务端 discovery 动态下发，
 * 白名单会在cli 新增品类时过期，违背"cli 加品类、插件零改动"的目标。
 */
export const CLI_SUBCOMMAND_RE = /^[a-z][a-z0-9_-]*$/;

/**
 * shell 组合符：仅对**未被引号包裹的裸字符**生效。
 *
 * 这不是安全边界——spawn 一律 `shell: false`，argv 直接交给进程，
 * 不存在 shell 解释。它只是一个启发式：识别"模型在拼 shell"并给出可操作的
 * 报错，而不是把管道符当参数传下去、让 cli 报一个费解的错。
 *
 * 因此**刻意不包含** `{}` `()` `$`：
 *   - `{` `}` 是 JSON 参数的必备字符（`--json '{"a":1}'`）
 *   - `(` `)` 会出现在成员名里（如 `张三(jackzhang22)`）
 *   - `$` 会出现在普通文本值里（如金额）
 * 误杀合法参数的代价远大于放过一个怪参数——后者只会得到一个正常的 cli 报错。
 */
export const CLI_SHELL_METACHARS = /[;|&`<>\n\r]/;

/**
 * 允许从插件配置透传给 cli 的环境变量白名单。
 *
 * 仅供联调指向测试环境。注意这三个变量在 cli 侧受 `custom-endpoint`
 * feature 门控（默认关闭），正式包上不生效。
 *
 * 模型提供的任何 env 一律拒绝——这里只接受插件配置来源。
 */
export const CLI_ENV_PASSTHROUGH = [
  "WECOM_CLI_BASE_URL",
  "WECOM_CLI_AUTH_ENDPOINT",
  "WECOM_CLI_ADDITIONAL_HEADERS",
] as const;

/** cli 侧错误码 */
export const CLI_ERR = {
  /** AuthRequiredError：无 token 或凭据不可解密 */
  AUTH_REQUIRED: 893999,
  /** cli token 已过期（cli 会尝试自动刷新） */
  TOKEN_EXPIRED: 853004,
  /** cli token 无效 */
  TOKEN_INVALID: 853005,
  /** bot_id / secret 无效或签名校验失败 */
  BAD_CREDENTIAL: 853000,
  /** 换取 token 频率超限 */
  RATE_LIMITED: 45009,
} as const;

/** 需要触发"强制重签 + 重试一次"的错误码 */
export const CLI_RESIGN_CODES = new Set<number>([
  CLI_ERR.AUTH_REQUIRED,
  CLI_ERR.TOKEN_EXPIRED,
  CLI_ERR.TOKEN_INVALID,
  // 业务命令报 853000 = 磁盘凭据里的 secret 已失效（服务端禁用/轮换），
  // 而 openclaw 配置里可能已是新 secret → 重签一次即可自愈。
  // ⚠️ 注意不对称：`auth init` **自身**报 853000 表示"配置里的 secret 就是错的"，
  // 那种情况绝不重试（见 credentials.ts），否则只是多打一次鉴权、离45009 更近。
  CLI_ERR.BAD_CREDENTIAL,
]);
