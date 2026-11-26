/**
 * WeCom Target Resolver (企业微信目标解析器)
 * 
 * 解析 OpenClaw 的 `to` 字段（原始目标字符串），将其转换为企业微信支持的具体接收对象。
 * 支持显式前缀 (party:, tag: 等) 和基于规则的启发式推断。
 * 
 * **关于“目标发送”与“消息记录”的对应关系 (Target vs Inbound):**
 * - **发送 (Outbound)**: 支持一对多广播 (Party/Tag)。
 *   例如发送给 `party:1`，消息会触达该部门下所有成员。
 * - **接收 (Inbound)**: 总是来自具体的 **用户 (User)** 或 **群聊 (Chat)**。
 *   当成员回复部门广播消息时，可以视为一个新的单聊会话或在该成员的现有单聊中回复。
 *   因此，Outbound Target (如 Party) 与 Inbound Source (User) 不需要也不可能 1:1 强匹配。
 *   广播是“发后即忘” (Fire-and-Forget) 的通知模式，而回复是具体的会话模式。
 */

export interface WecomTarget {
    touser?: string;
    toparty?: string;
    totag?: string;
    chatid?: string;
}

/**
 * Parses a raw target string into a WeComTarget object.
 * 解析原始目标字符串为 WeComTarget 对象。
 * 
 * 逻辑:
 * 1. 移除标准命名空间前缀 (wecom:, qywx: 等)。
 * 2. 检查显式类型前缀 (party:, tag:, group:, user:)。
 * 3. 启发式回退 (无前缀时):
 *    - 以 "wr" 或 "wc" 开头 -> Chat ID (群聊)
 *    - 纯数字 -> Party ID (部门)
 *    - 其他 -> User ID (用户)
 * 
 * @param raw - The raw target string (e.g. "party:1", "zhangsan", "wecom:wr123")
 */
/**
 * OpenClaw 目标类型前缀白名单。
 *
 * OpenClaw 的出站目标可能写成 "<type>:<id>"（如 user:yangtao / channel:xxx），
 * 而企业微信 API 只接受裸 chatid / userid，必须在出站边界统一剥离，
 * 否则企业微信 API 会硬失败：errcode=93006 invalid chatid。
 */
const OPENCLAW_TARGET_TYPE_PREFIX = /^(user|channel|group|dm|conversation|room|thread):/i;

/**
 * OpenClaw 路由前缀（对企微无语义），仅用于 Agent HTTP API 回退路径：
 * 这些前缀需要剥离，但 user:/group:/chat:/party:/tag: 等企微语义前缀必须保留，
 * 交给 resolveWecomTarget 解析（否则纯数字 userid 会被误判为部门 ID）。
 */
const OPENCLAW_ROUTING_PREFIX = /^(channel|dm|conversation|room|thread):/i;

/**
 * 命名空间前缀（wecom: / qywx: 等），必须最先剥离。
 */
const WECOM_NAMESPACE_PREFIX = /^(wecom-agent|wecom|wechatwork|wework|qywx):/i;

/**
 * 剥离 OpenClaw 目标类型前缀，得到可直接提交给企业微信 API 的裸 chatid / userid。
 *
 * 规则：
 * 1. 先剥离命名空间前缀（wecom: 等）；
 * 2. 再剥离类型前缀白名单（user:/channel:/group:/dm:/conversation:/room:/thread:）；
 * 3. 守卫：仅当剩余值非空且与原值不同时才返回剥离结果。
 *
 * 例："user:yangtao" -> "yangtao"，"wecom:user:yangtao" -> "yangtao"，
 *     "wecom:group:wrXXXX" -> "wrXXXX"，"yangtao" -> "yangtao"。
 */
export function resolveWecomChatId(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  const withoutNamespace = trimmed.replace(WECOM_NAMESPACE_PREFIX, "");
  const stripped = withoutNamespace.replace(OPENCLAW_TARGET_TYPE_PREFIX, "");

  // 守卫：剩余值为空或没有变化时，保持原值
  if (!stripped || stripped === withoutNamespace) return withoutNamespace;
  return stripped;
}

export function resolveWecomTarget(raw: string | undefined): WecomTarget | undefined {
    if (!raw?.trim()) return undefined;

    // 1. Remove standard namespace prefixes (移除标准命名空间前缀)
    let clean = raw.trim().replace(WECOM_NAMESPACE_PREFIX, "");

    // 1.5 剥离 OpenClaw 路由前缀（企微无语义），保留 user:/group:/party:/tag: 等企微语义前缀
    clean = clean.replace(OPENCLAW_ROUTING_PREFIX, "");

    // 2. Explicit Type Prefixes (显式类型前缀)
    if (/^party:/i.test(clean)) {
        return { toparty: clean.replace(/^party:/i, "").trim() };
    }
    if (/^dept:/i.test(clean)) {
        return { toparty: clean.replace(/^dept:/i, "").trim() };
    }
    if (/^tag:/i.test(clean)) {
        return { totag: clean.replace(/^tag:/i, "").trim() };
    }
    if (/^group:/i.test(clean)) {
        return { chatid: clean.replace(/^group:/i, "").trim() };
    }
    if (/^chat:/i.test(clean)) {
        return { chatid: clean.replace(/^chat:/i, "").trim() };
    }
    if (/^user:/i.test(clean)) {
        return { touser: clean.replace(/^user:/i, "").trim() };
    }

    // 3. Heuristics (启发式规则)

    // Chat ID typically starts with 'wr' or 'wc'
    // 群聊 ID 通常以 'wr' (外部群) 或 'wc' 开头
    if (/^(wr|wc)/i.test(clean)) {
        return { chatid: clean };
    }

    // Pure digits are likely Department IDs (Parties)
    // 纯数字优先被视为部门 ID (Parties)，方便运维配置 (如 "1" 代表根部门)
    // 如果必须要发送给纯数字 ID 的用户，请使用显式前缀 "user:1001"
    if (/^\d+$/.test(clean)) {
        return { toparty: clean };
    }

    // Default to User (默认为用户)
    return { touser: clean };
}
