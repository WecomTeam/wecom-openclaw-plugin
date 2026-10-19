import { readFileSync } from "node:fs";
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


describe("WeCom setup contract", () => {
  it("publishes the same CLI fields before plugin runtime loading", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(manifest.openclaw.channel.setup).toEqual(wecomPlugin.setupContract!.metadata);
  });

  it("keeps the existing credential inputs and applies them through the owned setup contract", () => {
    const setup = wecomPlugin.setupContract!;
    const input = { token: " bot-id ", privateKey: " fixture-secret " };
    expect(setup.parseInput(input)).toEqual({ ok: true, value: input });
    const cfg = setup.applyAccountConfig({ cfg: {}, accountId: "default", input });
    expect(cfg.channels?.wecom).toMatchObject({ botId: "bot-id", secret: "fixture-secret", enabled: true });
    expect(setup.metadata.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "token", cli: expect.objectContaining({ flags: "--token <value>" }) }),
      expect.objectContaining({ key: "privateKey", sensitive: true, cli: expect.objectContaining({ flags: "--private-key <value>" }) }),
    ]));
  });
});
