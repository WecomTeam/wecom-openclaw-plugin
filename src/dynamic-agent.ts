import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk/core";

import { CHANNEL_ID } from "./const.js";
import { resolveStateDir } from "./state-dir-resolve.js";

export interface DynamicAgentConfig {
  enabled: boolean;
  dmCreateAgent: boolean;
  groupEnabled: boolean;
  adminUsers: string[];
  workspaceTemplate: string;
  agentDirTemplate: string;
  workspaceTemplateDir?: string;
}

type LegacyDynamicAgentConfig = {
  dynamicAgentEnable?: boolean;
  dynamicAgentWorkspaceTemplate?: string;
  dynamicAgentDirTemplate?: string;
  dynamicAgentWorkspaceTemplateDir?: string;
};

export interface DynamicAgentRegistrationParams {
  config: OpenClawConfig;
  accountId: string;
  chatType: "dm" | "group";
  chatId: string;
  stateDir?: string;
}

export interface DynamicAgentRegistrationResult {
  changed: boolean;
  created: boolean;
  agentId: string;
  workspace: string;
  agentDir: string;
  workspaceTemplateDir?: string;
  updatedConfig: OpenClawConfig;
}

export interface EnsureDynamicAgentProvisioningParams {
  routeMatchedBy: string;
  config: OpenClawConfig;
  runtime: PluginRuntime;
  accountId: string;
  chatType: "dm" | "group";
  chatId: string;
  senderId: string;
  log?: (msg: string) => void;
}

export interface EnsureDynamicAgentProvisioningResult {
  created: boolean;
  updatedConfig: OpenClawConfig;
  agentId?: string;
}

function getLegacyDynamicAgentConfig(config: OpenClawConfig): LegacyDynamicAgentConfig {
  return ((config as { channels?: { wecom?: LegacyDynamicAgentConfig } })?.channels?.wecom ?? {});
}

export function getDynamicAgentConfig(
  config: OpenClawConfig,
  stateDir: string = resolveStateDir(),
): DynamicAgentConfig {
  const dynamicAgents = (
    config as { channels?: { wecom?: { dynamicAgents?: Partial<DynamicAgentConfig> } } }
  )?.channels?.wecom?.dynamicAgents;
  const legacy = getLegacyDynamicAgentConfig(config);

  return {
    enabled: dynamicAgents?.enabled ?? legacy.dynamicAgentEnable ?? false,
    dmCreateAgent: dynamicAgents?.dmCreateAgent ?? true,
    groupEnabled: dynamicAgents?.groupEnabled ?? true,
    adminUsers: dynamicAgents?.adminUsers ?? [],
    workspaceTemplate:
      dynamicAgents?.workspaceTemplate ??
      legacy.dynamicAgentWorkspaceTemplate ??
      path.join(stateDir, "workspace", "{agentId}"),
    agentDirTemplate:
      dynamicAgents?.agentDirTemplate ??
      legacy.dynamicAgentDirTemplate ??
      path.join(stateDir, "agents", "{agentId}", "agent"),
    workspaceTemplateDir:
      dynamicAgents?.workspaceTemplateDir ?? legacy.dynamicAgentWorkspaceTemplateDir,
  };
}

function sanitizeDynamicIdPart(value: string): string {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");
}

export function generateAgentId(chatType: "dm" | "group", peerId: string, accountId?: string): string {
  const sanitizedPeer = sanitizeDynamicIdPart(peerId) || "unknown";
  const sanitizedAccountId = sanitizeDynamicIdPart(accountId ?? "default") || "default";
  return `wecom-${sanitizedAccountId}-${chatType}-${sanitizedPeer}`;
}

export function shouldUseDynamicAgent(params: {
  chatType: "dm" | "group";
  senderId: string;
  config: OpenClawConfig;
}): boolean {
  const { chatType, senderId, config } = params;
  const dynamicConfig = getDynamicAgentConfig(config);

  if (!dynamicConfig.enabled) {
    return false;
  }

  const sender = String(senderId).trim().toLowerCase();
  const isAdmin = dynamicConfig.adminUsers.some(
    (admin) => admin.trim().toLowerCase() === sender,
  );
  if (isAdmin) {
    return false;
  }

  if (chatType === "group") {
    return dynamicConfig.groupEnabled;
  }
  return dynamicConfig.dmCreateAgent;
}

function expandHomeDir(value: string): string {
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function resolveTemplatePath(template: string, replacements: Record<string, string>): string {
  const resolved = Object.entries(replacements).reduce(
    (value, [key, replacement]) => value.replaceAll(`{${key}}`, replacement),
    template,
  );
  return expandHomeDir(resolved);
}

function buildBinding(params: {
  agentId: string;
  accountId: string;
  chatType: "dm" | "group";
  chatId: string;
}): NonNullable<OpenClawConfig["bindings"]>[number] {
  const { agentId, accountId, chatType, chatId } = params;
  return {
    type: "route",
    agentId,
    match: {
      channel: CHANNEL_ID,
      accountId,
      peer: {
        kind: chatType === "group" ? "group" : "direct",
        id: chatId,
      },
    },
  };
}

export function buildDynamicAgentRegistration(
  params: DynamicAgentRegistrationParams,
): DynamicAgentRegistrationResult {
  const {
    config,
    accountId,
    chatType,
    chatId,
    stateDir = resolveStateDir(),
  } = params;
  const dynamicConfig = getDynamicAgentConfig(config, stateDir);
  const agentId = generateAgentId(chatType, chatId, accountId);
  const peerKind = chatType === "group" ? "group" : "direct";
  const binding = buildBinding({ agentId, accountId, chatType, chatId });

  const existingBindings = config.bindings ?? [];
  const bindingExists = existingBindings.some(
    (entry) =>
      entry.match?.channel === CHANNEL_ID &&
      entry.match?.accountId === accountId &&
      entry.match?.peer?.kind === peerKind &&
      entry.match?.peer?.id === chatId,
  );

  const existingAgents = config.agents?.list ?? [];
  const existingAgent = existingAgents.find((entry) => entry.id === agentId);

  const replacements = {
    userId: chatId,
    agentId,
    stateDir,
  };
  const workspace =
    existingAgent?.workspace ??
    resolveTemplatePath(dynamicConfig.workspaceTemplate, replacements);
  const agentDir =
    existingAgent?.agentDir ??
    resolveTemplatePath(dynamicConfig.agentDirTemplate, replacements);
  const workspaceTemplateDir = dynamicConfig.workspaceTemplateDir
    ? resolveTemplatePath(dynamicConfig.workspaceTemplateDir, replacements)
    : undefined;

  const nextAgents = existingAgent
    ? existingAgents
    : [...existingAgents, { id: agentId, workspace, agentDir }];
  const nextBindings = bindingExists ? existingBindings : [...existingBindings, binding];
  const changed = !existingAgent || !bindingExists;

  if (!changed) {
    return {
      changed: false,
      created: false,
      agentId,
      workspace,
      agentDir,
      workspaceTemplateDir,
      updatedConfig: config,
    };
  }

  return {
    changed: true,
    created: true,
    agentId,
    workspace,
    agentDir,
    workspaceTemplateDir,
    updatedConfig: {
      ...config,
      agents: {
        ...config.agents,
        list: nextAgents,
      },
      bindings: nextBindings,
    },
  };
}

async function copyTemplateFiles(src: string, dest: string) {
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await fs.promises.mkdir(destPath, { recursive: true });
        await copyTemplateFiles(srcPath, destPath);
        return;
      }
      await fs.promises.copyFile(srcPath, destPath);
    }),
  );
}

async function ensureDirectoryExists(targetPath: string) {
  await fs.promises.mkdir(targetPath, { recursive: true });
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDynamicAgentFilesystem(result: DynamicAgentRegistrationResult) {
  if (!(await pathExists(result.workspace))) {
    await ensureDirectoryExists(result.workspace);
    if (result.workspaceTemplateDir && (await pathExists(result.workspaceTemplateDir))) {
      await copyTemplateFiles(result.workspaceTemplateDir, result.workspace);
    }
  }
  await ensureDirectoryExists(result.agentDir);
}

export async function ensureDynamicAgentProvisioned(
  params: EnsureDynamicAgentProvisioningParams,
): Promise<EnsureDynamicAgentProvisioningResult> {
  const {
    routeMatchedBy,
    config,
    runtime,
    accountId,
    chatType,
    chatId,
    senderId,
    log,
  } = params;

  if (routeMatchedBy !== "default") {
    return { created: false, updatedConfig: config };
  }

  const latestConfig = runtime.config.loadConfig();
  if (!shouldUseDynamicAgent({ chatType, senderId, config: latestConfig })) {
    return { created: false, updatedConfig: latestConfig };
  }

  const registration = buildDynamicAgentRegistration({
    config: latestConfig,
    accountId,
    chatType,
    chatId,
  });
  if (!registration.changed) {
    return {
      created: false,
      updatedConfig: registration.updatedConfig,
      agentId: registration.agentId,
    };
  }

  await ensureDynamicAgentFilesystem(registration);
  await runtime.config.writeConfigFile(registration.updatedConfig);
  log?.(
    `[dynamic-agent] provisioned ${registration.agentId} workspace=${registration.workspace} agentDir=${registration.agentDir}`,
  );

  return {
    created: true,
    updatedConfig: registration.updatedConfig,
    agentId: registration.agentId,
  };
}
