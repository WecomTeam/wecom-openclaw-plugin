import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveWeComIdentity,
  setWeComIdentitySessionsLoaderForTest,
} from "./identity-resolver.js";
import type { ResolvedWeComAccount } from "./utils.js";

function account(identity?: ResolvedWeComAccount["config"]["identity"]): ResolvedWeComAccount {
  return {
    accountId: "default",
    name: "企业微信",
    enabled: true,
    websocketUrl: "wss://example.invalid",
    botId: "bot",
    secret: "secret",
    sendThinkingMessage: true,
    config: { identity },
  };
}

afterEach(() => setWeComIdentitySessionsLoaderForTest());

describe("resolveWeComIdentity", () => {
  it("uses configured names without calling the CLI", async () => {
    const loader = vi.fn();
    setWeComIdentitySessionsLoaderForTest(loader);

    const result = await resolveWeComIdentity({
      account: account({
        userNames: { USER_1: "Example User" },
        groupNames: { GROUP_1: "Example Group" },
      }),
      chatType: "group",
      chatId: "group_1",
      senderId: "user_1",
    });

    expect(result).toEqual({ senderName: "Example User", conversationName: "Example Group" });
    expect(loader).not.toHaveBeenCalled();
  });

  it("loads direct and group names from recent sessions and caches them", async () => {
    const loader = vi.fn().mockResolvedValue({
      details: JSON.stringify({
        sessions: [
          { chat_id: "user_2", chat_name: "User Two", chat_type: "single" },
          { chat_id: "group_2", chat_name: "Project Group", chat_type: "group" },
        ],
      }),
    });
    setWeComIdentitySessionsLoaderForTest(loader);

    const first = await resolveWeComIdentity({
      account: account(),
      chatType: "group",
      chatId: "group_2",
      senderId: "user_2",
    });
    const second = await resolveWeComIdentity({
      account: account(),
      chatType: "direct",
      chatId: "user_2",
      senderId: "user_2",
    });

    expect(first).toEqual({ senderName: "User Two", conversationName: "Project Group" });
    expect(second).toEqual({ senderName: "User Two", conversationName: "User Two" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("falls back cleanly when the session lookup fails", async () => {
    setWeComIdentitySessionsLoaderForTest(vi.fn().mockRejectedValue(new Error("offline")));

    await expect(
      resolveWeComIdentity({
        account: account(),
        chatType: "group",
        chatId: "group_3",
        senderId: "user_3",
      }),
    ).resolves.toEqual({ senderName: undefined, conversationName: undefined });
  });

  it("treats a structured CLI error as a failed lookup", async () => {
    const log = vi.fn();
    const loader = vi.fn().mockResolvedValue({
      details: { error: "The bot is not authorized to use messaging", errcode: 850002 },
    });
    setWeComIdentitySessionsLoaderForTest(loader);

    await expect(
      resolveWeComIdentity({
        account: account(),
        chatType: "group",
        chatId: "group_4",
        senderId: "user_4",
        log,
      }),
    ).resolves.toEqual({ senderName: undefined, conversationName: undefined });

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("The bot is not authorized to use messaging"),
    );
  });
});
