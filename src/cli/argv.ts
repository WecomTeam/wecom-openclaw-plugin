/**
 * argv 解析与安全校验
 *
 * tool 入参刻意对齐 cli 命令行本身（`args` = `wecom-cli ` 之后的全部内容），
 * 这样 skills 里的命令表、参数说明、返回字段表都不需要改写。
 *
 * 但"对齐命令行"不等于"走shell"——spawn 一律 `shell: false`，
 * 这里只做极简词法切分：认单引号 / 双引号 / 反斜杠，遇到任何 shell
 * 元字符直接拒绝（出现元字符说明模型在拼 shell，而不是在传参数）。
 */

import {
  CLI_FORBIDDEN_AUTH_ACTIONS,
  CLI_FORBIDDEN_SUBCOMMANDS,
  CLI_SHELL_METACHARS,
  CLI_SUBCOMMAND_RE,
} from "./const.js";

export class CliArgvError extends Error {}

/**
 * 极简 POSIX-ish 词法切分。
 *
 * 支持：
 *   'single quoted'      → 内部原样，不做任何转义
 *   "double quoted"      → 支持 \" \\ 转义
 *   bare\ token          → 反斜杠转义空格
 * 不支持（且拒绝）：裸的管道、重定向、命令组合。
 *
 * shell 组合符的检查是**引号感知**的：只有引号外的裸字符才会被拒绝。
 * 这样 `--json '{"a":1}'` 和 `--json {"a":1}` 都能通过，
 * 而 `... | jq .` 里裸的管道符会被拦住。
 */
export function tokenize(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let has = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (ch === " " || ch === "\t") {
      if (has) {
        out.push(cur);
        cur = "";
        has = false;
      }
      i += 1;
      continue;
    }

    if (ch === "'") {
      has = true;
      i += 1;
      const end = input.indexOf("'", i);
      if (end < 0) throw new CliArgvError("args 中单引号未闭合");
      cur += input.slice(i, end);
      i = end + 1;
      continue;
    }

    if (ch === '"') {
      has = true;
      i += 1;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === "\\" && i + 1 < input.length) {
          const next = input[i + 1];
          cur += next === '"' || next === "\\" ? next : `\\${next}`;
          i += 2;
        } else {
          cur += input[i];
          i += 1;
        }
      }
      if (i >= input.length) throw new CliArgvError("args 中双引号未闭合");
      i += 1;
      continue;
    }

    if (ch === "\\" && i + 1 < input.length) {
      has = true;
      cur += input[i + 1];
      i += 2;
      continue;
    }

    // 裸字符（不在任何引号内）：此处才做shell 组合符检查
    if (CLI_SHELL_METACHARS.test(ch)) {
      throw new CliArgvError(
        `args 中包含未被引号包裹的 shell 组合符 ${JSON.stringify(ch)}。` +
          "本 tool 直接执行 wecom-cli，不经过 shell，因此不支持管道、重定向与命令组合。" +
          "若该字符是参数值的一部分，请用引号包裹，或改用数组形式的 args。",
      );
    }
    // 裸的命令替换 `$(`：单独的 `$` 是合法值字符（如金额），但 `$(` 只可能是拼shell
    if (ch === "$" && input[i + 1] === "(") {
      throw new CliArgvError(
        "args 中包含未被引号包裹的命令替换 `$(`。本 tool 不经过 shell 执行，" +
          "请直接给出参数值；若该内容是参数值的一部分，请用引号包裹或改用数组形式的 args。",
      );
    }

    has = true;
    cur += ch;
    i += 1;
  }

  if (has) out.push(cur);
  return out;
}

/**
 * 安全校验。
 *
 * 关键点：`WECOM_CLI_CONFIG_DIR` 由服务端按当前会话的 bot 注入，
 * 模型既看不到也改不了。这里额外拦住模型试图自行覆盖配置目录/端点的行为——
 * 一旦被覆盖，就可能拿 A 企业的凭据调 B 企业的接口。
 */
export function assertSafeArgv(argv: string[]): void {
  if (argv.length === 0) {
    throw new CliArgvError("args 不能为空，至少需要指定品类，如 `contact users search --json '{}'`");
  }

  const head = argv[0];
  if (!CLI_SUBCOMMAND_RE.test(head)) {
    throw new CliArgvError(
      `第一个参数 ${JSON.stringify(head)} 不是合法的子命令名。` +
        `应为品类名（如 contact / doc / meeting / todo / calendar）或 auth / cache。`,
    );
  }
  if (CLI_FORBIDDEN_SUBCOMMANDS.has(head)) {
    throw new CliArgvError(
      `子命令 \`${head}\` 已被禁用：它是交互式流程且会改写全局凭据存储。` +
        `企业微信凭据请在 openclaw 配置 \`channels.wecom\` 中维护。`,
    );
  }

  // `auth init` 的 argv[0] 是 auth 而非 init，不在上面的顶层禁用集内，需单独拦
  if (head === "auth" && argv[1] && CLI_FORBIDDEN_AUTH_ACTIONS.has(argv[1])) {
    throw new CliArgvError(
      `\`auth ${argv[1]}\` 已被禁用：企业微信凭据由插件按当前会话的机器人自动管理，` +
        `不需要（也不允许）手动授权。若提示凭据不可用，请检查 openclaw 配置 ` +
        `\`channels.wecom\` 中的 botId / secret。`,
    );
  }

  for (const tok of argv) {
    if (/^WECOM_CLI_[A-Z_]*=/.test(tok)) {
      throw new CliArgvError(
        `args 中不允许出现环境变量赋值 ${JSON.stringify(tok)}；运行环境由插件按当前会话的机器人注入。`,
      );
    }
    if (/^--config-dir(=|$)/.test(tok) || /^--home(=|$)/.test(tok)) {
      throw new CliArgvError(
        `args 中不允许覆盖配置目录（${JSON.stringify(tok)}）；配置目录由插件按当前会话的机器人决定。`,
      );
    }
  }
}

/** 归一化 tool 入参为 argv 数组，并完成安全校验 */
export function normalizeArgs(args: unknown): string[] {
  let argv: string[];

  if (Array.isArray(args)) {
    argv = args.map((a) => {
      if (typeof a === "string") return a;
      if (typeof a === "number" || typeof a === "boolean") return String(a);
      throw new CliArgvError(`args 数组元素必须是字符串，收到 ${typeof a}`);
    });
  } else if (typeof args === "string") {
    argv = tokenize(args);
  } else {
    throw new CliArgvError(`args 必须是字符串或字符串数组，收到 ${typeof args}`);
  }

  // 容错：模型可能把 "wecom-cli" 本身也带上
  if (argv[0] === "wecom-cli" || argv[0] === "wecom") argv = argv.slice(1);

  assertSafeArgv(argv);
  return argv;
}
