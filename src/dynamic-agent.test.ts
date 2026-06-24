import { describe, expect, it } from "vitest";
import path from "node:path";

import {
  buildDynamicAgentRegistration,
  getDynamicAgentConfig,
} from "./dynamic-agent.js";

describe("getDynamicAgentConfig", () => {
  it("supports deprecated flat config keys as a fallback", () => {
    const config = {
      channels: {
        wecom: {
          dynamicAgentEnable: true,
          dynamicAgentWorkspaceTemplate: "~/workspace-{agentId}",
          dynamicAgentDirTemplate: "~/agents/{agentId}/agent",
          dynamicAgentWorkspaceTemplateDir: "~/template",
        },
      },
    } as any;

    expect(getDynamicAgentConfig(config, "/state")).toEqual({
      enabled: true,
      dmCreateAgent: true,
      groupEnabled: true,
      adminUsers: [],
      workspaceTemplate: "~/workspace-{agentId}",
      agentDirTemplate: "~/agents/{agentId}/agent",
      workspaceTemplateDir: "~/template",
    });
  });
});

describe("buildDynamicAgentRegistration", () => {
  it("creates an account-scoped agent, binding, and isolated paths", () => {
    const config = {
      channels: {
        wecom: {
          dynamicAgents: {
            enabled: true,
          },
        },
      },
    } as any;

    const result = buildDynamicAgentRegistration({
      config,
      accountId: "main",
      chatType: "dm",
      chatId: "ou_abc",
      stateDir: "/state",
    });

    expect(result).toMatchObject({
      created: true,
      agentId: "wecom-main-dm-ou_abc",
      workspace: path.join("/state", "workspace", "wecom-main-dm-ou_abc"),
      agentDir: path.join("/state", "agents", "wecom-main-dm-ou_abc", "agent"),
    });

    expect(result.updatedConfig.agents?.list).toEqual([
      {
        id: "wecom-main-dm-ou_abc",
        workspace: path.join("/state", "workspace", "wecom-main-dm-ou_abc"),
        agentDir: path.join("/state", "agents", "wecom-main-dm-ou_abc", "agent"),
      },
    ]);
    expect(result.updatedConfig.bindings).toEqual([
      {
        type: "route",
        agentId: "wecom-main-dm-ou_abc",
        match: {
          channel: "wecom",
          accountId: "main",
          peer: {
            kind: "direct",
            id: "ou_abc",
          },
        },
      },
    ]);
  });

  it("adds only the missing binding when the isolated agent already exists", () => {
    const config = {
      agents: {
        list: [
          {
            id: "wecom-main-dm-ou_abc",
            workspace: "/custom/workspace",
            agentDir: "/custom/agent",
          },
        ],
      },
      channels: {
        wecom: {
          dynamicAgents: {
            enabled: true,
          },
        },
      },
    } as any;

    const result = buildDynamicAgentRegistration({
      config,
      accountId: "main",
      chatType: "dm",
      chatId: "ou_abc",
      stateDir: "/state",
    });

    expect(result.created).toBe(true);
    expect(result.workspace).toBe("/custom/workspace");
    expect(result.agentDir).toBe("/custom/agent");
    expect(result.updatedConfig.agents?.list).toEqual(config.agents.list);
    expect(result.updatedConfig.bindings).toEqual([
      {
        type: "route",
        agentId: "wecom-main-dm-ou_abc",
        match: {
          channel: "wecom",
          accountId: "main",
          peer: {
            kind: "direct",
            id: "ou_abc",
          },
        },
      },
    ]);
  });
});
