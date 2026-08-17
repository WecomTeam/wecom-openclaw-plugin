import { describe, expect, it } from "vitest";
import { shouldWarnLegacyToolAllow } from "./legacy-tool-warning.js";

describe("shouldWarnLegacyToolAllow", () => {
  it("仅放行旧工具且 profile 非 full 时告警", () => {
    expect(
      shouldWarnLegacyToolAllow({ profile: "messaging", alsoAllow: ["wecom_mcp"] }),
    ).toBe(true);
  });

  it("同时放行 wecom-cli 时不告警", () => {
    expect(
      shouldWarnLegacyToolAllow({
        profile: "messaging",
        alsoAllow: ["wecom_mcp", "wecom-cli"],
      }),
    ).toBe(false);
  });

  it("放行插件 ID 时不告警", () => {
    expect(
      shouldWarnLegacyToolAllow({
        profile: "messaging",
        alsoAllow: ["wecom_mcp", "wecom-openclaw-plugin"],
      }),
    ).toBe(false);
  });

  it("profile 为 full 时不告警", () => {
    expect(shouldWarnLegacyToolAllow({ profile: "full", alsoAllow: ["wecom_mcp"] })).toBe(
      false,
    );
  });
});
