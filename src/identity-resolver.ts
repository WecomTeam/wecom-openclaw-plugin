import type { ResolvedWeComAccount, WeComIdentityConfig } from "./utils.js";
import { createWeComCliTool } from "./cli/tool.js";

type ChatType = "direct" | "group";

type SessionRecord = {
  chat_id?: unknown;
  chat_name?: unknown;
  chat_type?: unknown;
};

type IdentitySnapshot = {
  expiresAt: number;
  userNames: Map<string, string>;
  groupNames: Map<string, string>;
};

export type ResolvedWeComIdentity = {
  senderName?: string;
  conversationName?: string;
};

const SUCCESS_TTL_MS = 30 * 60 * 1000;
const FAILURE_TTL_MS = 2 * 60 * 1000;
const snapshots = new Map<string, IdentitySnapshot>();
const refreshes = new Map<string, Promise<IdentitySnapshot>>();

type SessionsLoader = (account: ResolvedWeComAccount) => Promise<unknown>;

function normalizeName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return name || undefined;
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase();
}

function parsePayload(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function extractSessions(value: unknown): SessionRecord[] {
  const parsed = parsePayload(value);
  if (!parsed || typeof parsed !== "object") return [];
  const details = parsePayload((parsed as { details?: unknown }).details);
  const payload = details && typeof details === "object" ? details : parsed;
  const sessions = (payload as { sessions?: unknown }).sessions;
  return Array.isArray(sessions) ? (sessions as SessionRecord[]) : [];
}

function extractLookupError(value: unknown): string | undefined {
  const parsed = parsePayload(value);
  if (!parsed || typeof parsed !== "object") return undefined;
  const details = parsePayload((parsed as { details?: unknown }).details);
  const payload = details && typeof details === "object" ? details : parsed;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string") return normalizeName(error);
  if (error && typeof error === "object") {
    const message = normalizeName((error as { message?: unknown }).message);
    if (message) return message;
  }
  const errcode = (payload as { errcode?: unknown }).errcode;
  return errcode == null ? undefined : `wecom-cli errcode=${String(errcode)}`;
}

const defaultSessionsLoader: SessionsLoader = async (account) => {
  const tool = createWeComCliTool({
    accountId: account.accountId,
    resolvedAccount: account,
  });
  return tool.execute("wecom-identity-resolver", {
    args: ["message", "aibot", "sessions", "list"],
  });
};

let sessionsLoader: SessionsLoader = defaultSessionsLoader;

function buildSnapshot(value: unknown, ttlMs: number): IdentitySnapshot {
  const userNames = new Map<string, string>();
  const groupNames = new Map<string, string>();

  for (const session of extractSessions(value)) {
    const id = normalizeName(session.chat_id);
    const name = normalizeName(session.chat_name);
    if (!id || !name) continue;

    const type = String(session.chat_type ?? "").trim().toLowerCase();
    if (type === "group" || type === "2") {
      groupNames.set(normalizeId(id), name);
    } else if (type === "single" || type === "direct" || type === "1") {
      userNames.set(normalizeId(id), name);
    }
  }

  return {
    expiresAt: Date.now() + ttlMs,
    userNames,
    groupNames,
  };
}

async function refreshSnapshot(
  account: ResolvedWeComAccount,
  log?: (message: string) => void,
): Promise<IdentitySnapshot> {
  const accountId = account.accountId;
  const existing = refreshes.get(accountId);
  if (existing) return existing;

  const refresh = (async () => {
    try {
      const payload = await sessionsLoader(account);
      const lookupError = extractLookupError(payload);
      if (lookupError) throw new Error(lookupError);
      const snapshot = buildSnapshot(payload, SUCCESS_TTL_MS);
      snapshots.set(accountId, snapshot);
      return snapshot;
    } catch (err) {
      log?.(`[wecom-identity] sessions list failed for account=${accountId}: ${String(err)}`);
      const snapshot = buildSnapshot(undefined, FAILURE_TTL_MS);
      snapshots.set(accountId, snapshot);
      return snapshot;
    } finally {
      refreshes.delete(accountId);
    }
  })();

  refreshes.set(accountId, refresh);
  return refresh;
}

function configuredName(map: Record<string, string> | undefined, id: string): string | undefined {
  if (!map) return undefined;
  const exact = normalizeName(map[id]);
  if (exact) return exact;
  const normalized = normalizeId(id);
  for (const [key, value] of Object.entries(map)) {
    if (normalizeId(key) === normalized) return normalizeName(value);
  }
  return undefined;
}

/**
 * Resolve names known by the bot without making inbound delivery depend on the lookup.
 * Static mappings win; the built-in CLI recent-session list supplies automatic names;
 * any miss or failure falls back to the opaque IDs at the call site.
 */
export async function resolveWeComIdentity(params: {
  account: ResolvedWeComAccount;
  chatType: ChatType;
  chatId: string;
  senderId: string;
  log?: (message: string) => void;
}): Promise<ResolvedWeComIdentity> {
  const identity = params.account.config.identity as WeComIdentityConfig | undefined;
  let senderName = configuredName(identity?.userNames, params.senderId);
  let conversationName =
    params.chatType === "group"
      ? configuredName(identity?.groupNames, params.chatId)
      : senderName;

  if (
    identity?.autoResolve === false ||
    (!params.account.botId?.trim() || !params.account.secret?.trim()) ||
    (senderName && conversationName)
  ) {
    return { senderName, conversationName };
  }

  const accountId = params.account.accountId;
  let snapshot = snapshots.get(accountId);
  if (!snapshot || snapshot.expiresAt <= Date.now()) {
    snapshot = await refreshSnapshot(params.account, params.log);
  }

  senderName ??= snapshot.userNames.get(normalizeId(params.senderId));
  conversationName ??=
    params.chatType === "group"
      ? snapshot.groupNames.get(normalizeId(params.chatId))
      : senderName;

  return { senderName, conversationName };
}

export function clearWeComIdentityCache(): void {
  snapshots.clear();
  refreshes.clear();
}

export function setWeComIdentitySessionsLoaderForTest(loader?: SessionsLoader): void {
  sessionsLoader = loader ?? defaultSessionsLoader;
  clearWeComIdentityCache();
}
