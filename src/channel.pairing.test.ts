import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

const mocks = vi.hoisted(() => ({
  getWeComWebSocket: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("./monitor.js", () => ({ monitorWeComProvider: vi.fn() }));
vi.mock("./state-manager.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./state-manager.js")>()),
  getWeComWebSocket: mocks.getWeComWebSocket,
}));

import { wecomPlugin } from "./channel.js";

const cfg = {
  channels: {
    wecom: {
      defaultAccount: "primary",
      accounts: { primary: {}, secondary: {} },
    },
  },
} as OpenClawConfig;

const notifyApproval = wecomPlugin.pairing!.notifyApproval!;
const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };

describe("WeCom pairing approval notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendMessage.mockReset();
    mocks.sendMessage.mockResolvedValue({ headers: { req_id: "test-message" } });
    mocks.getWeComWebSocket.mockReturnValue({
      isConnected: true,
      sendMessage: mocks.sendMessage,
    });
  });

  it("notifies only the approved sender using the requested account", async () => {
    await notifyApproval({ cfg, id: "approved-user", accountId: "secondary", runtime });

    expect(mocks.getWeComWebSocket).toHaveBeenCalledWith("secondary");
    expect(mocks.sendMessage).toHaveBeenCalledExactlyOnceWith("approved-user", {
      msgtype: "markdown",
      markdown: { content: "配对审批已通过，现在可以开始聊天了。" },
    });
  });

  it("uses the configured default account when no account is supplied", async () => {
    await notifyApproval({ cfg, id: "approved-user", runtime });

    expect(mocks.getWeComWebSocket).toHaveBeenCalledWith("primary");
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("waits for the send acknowledgement before resolving", async () => {
    const acknowledgement = Promise.withResolvers<{ headers: { req_id: string } }>();
    mocks.sendMessage.mockReturnValue(acknowledgement.promise);
    let completed = false;
    const pending = notifyApproval({ cfg, id: "approved-user", accountId: "secondary", runtime })
      .then(() => { completed = true; });

    await Promise.resolve();
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(completed).toBe(false);
    acknowledgement.resolve({ headers: { req_id: "test-message" } });
    await pending;
    expect(completed).toBe(true);
  });

  it("propagates send failures so approval does not report a sent notification", async () => {
    mocks.sendMessage.mockRejectedValue(new Error("send rejected"));

    await expect(notifyApproval({ cfg, id: "approved-user", accountId: "secondary", runtime }))
      .rejects.toThrow("send rejected");
  });

  it("rejects when the account cannot deliver a notification", async () => {
    mocks.getWeComWebSocket.mockReturnValue(undefined);

    await expect(notifyApproval({ cfg, id: "approved-user", accountId: "secondary", runtime }))
      .rejects.toThrow("WSClient not connected");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
