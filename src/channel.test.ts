import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk/core";
import { wecomPlugin } from "./channel.js";
import { setWeComRuntime } from "./runtime.js";

describe("WeCom logout config ownership", () => {
  it("clears only the selected account in the current config draft", async () => {
    const persisted: OpenClawConfig = {
      channels: {
        wecom: {
          accounts: {
            work: { botId: "work", secret: "fixture-work", enabled: true },
            personal: { botId: "personal", secret: "fixture-personal" },
          },
        },
      },
      messages: { responsePrefix: "updated after the caller snapshot" },
    };
    const mutateConfigFile = vi.fn(async ({ mutate }) => ({ result: await mutate(persisted) }));
    setWeComRuntime({ config: { mutateConfigFile } } as unknown as PluginRuntime);

    const result = await wecomPlugin.gateway!.logoutAccount!({
      cfg: {},
      accountId: "work",
    } as Parameters<NonNullable<NonNullable<typeof wecomPlugin.gateway>["logoutAccount"]>>[0]);

    expect(result).toEqual({ cleared: true, envToken: false, loggedOut: true });
    expect(persisted.channels?.wecom).toEqual({
      accounts: {
        work: { enabled: true },
        personal: { botId: "personal", secret: "fixture-personal" },
      },
    });
    expect(persisted.messages?.responsePrefix).toBe("updated after the caller snapshot");
    expect(mutateConfigFile).toHaveBeenCalledWith(expect.objectContaining({ afterWrite: { mode: "auto" } }));
  });
});
