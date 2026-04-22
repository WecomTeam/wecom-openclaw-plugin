import { describe, expect, test } from "vitest";

import { processDynamicRouting } from "./dynamic-routing.js";

describe("processDynamicRouting", () => {
  test("bypasses dynamic routing for admin direct messages", () => {
    const result = processDynamicRouting({
      route: {
        agentId: "main",
        sessionKey: "agent:main:wecom:default:dm:heye",
        matchedBy: "default",
        accountId: "default",
      },
      config: {
        channels: {
          wecom: {
            dynamicAgents: {
              enabled: true,
              dmCreateAgent: true,
              adminUsers: ["HeYe"],
            },
          },
        },
      } as any,
      core: {} as any,
      accountId: "default",
      chatType: "dm",
      chatId: "HeYe",
      senderId: "HeYe",
    });

    expect(result.useDynamicAgent).toBe(false);
    expect(result.finalAgentId).toBe("main");
    expect(result.finalSessionKey).toBe("agent:main:wecom:default:dm:heye");
    expect(result.routeModified).toBe(false);
  });

  test("keeps group chats on the shared dynamic route even when sender is admin", () => {
    const result = processDynamicRouting({
      route: {
        agentId: "main",
        sessionKey: "agent:main:wecom:default:group:wr123",
        matchedBy: "default",
        accountId: "default",
      },
      config: {
        channels: {
          wecom: {
            dynamicAgents: {
              enabled: true,
              groupEnabled: true,
              adminUsers: ["HeYe"],
            },
          },
        },
      } as any,
      core: {} as any,
      accountId: "default",
      chatType: "group",
      chatId: "wr123",
      senderId: "HeYe",
    });

    expect(result.useDynamicAgent).toBe(true);
    expect(result.finalAgentId).toBe("wecom-default-group-wr123");
    expect(result.finalSessionKey).toBe("agent:wecom-default-group-wr123:wecom:default:group:wr123");
    expect(result.routeModified).toBe(true);
  });
});
