/**
 * 企业微信动态 Agent 创建模块
 *
 * 当新的私聊用户或群组发来消息且没有匹配的路由 binding 时，
 * 自动创建一个隔离的 agent（独立 workspace + agentDir），并写入配置文件。
 *
 * 参考自飞书插件的 dynamic-agent.ts 实现。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { getWeComRuntime } from "./runtime.js";
import { CHANNEL_ID } from "./const.js";
import type { DynamicAgentCreationConfig } from "./utils.js";

export type MaybeCreateDynamicAgentResult = {
  created: boolean;
  updatedCfg: OpenClawConfig;
  agentId?: string;
};

/**
 * 检查是否需要为当前 peer 创建动态 agent，若需要则创建并返回更新后的配置。
 *
 * 创建逻辑：
 * 1. 检查是否已有该 peer 的 binding → 有则跳过
 * 2. 检查 maxAgents 上限
 * 3. 若 agent 已存在但缺少 binding → 只补 binding
 * 4. 否则创建目录 + 写入 agent 配置 + 写入 binding
 */
export async function maybeCreateDynamicAgent(params: {
  cfg: OpenClawConfig;
  peerId: string;
  peerKind: "direct" | "group";
  dynamicCfg: DynamicAgentCreationConfig;
  log: (msg: string) => void;
}): Promise<MaybeCreateDynamicAgentResult> {
  const { cfg, peerId, peerKind, dynamicCfg, log } = params;

  // 已有该 peer 的 binding，无需创建
  const existingBindings = cfg.bindings ?? [];
  const hasBinding = existingBindings.some(
    (b) =>
      b.match?.channel === CHANNEL_ID &&
      b.match?.peer?.kind === peerKind &&
      b.match?.peer?.id === peerId,
  );
  if (hasBinding) {
    return { created: false, updatedCfg: cfg };
  }

  // 检查 maxAgents 上限（计算 wecom- 前缀的 agent 数量）
  if (dynamicCfg.maxAgents !== undefined) {
    const wecomAgentCount = (cfg.agents?.list ?? []).filter((a) =>
      a.id.startsWith("wecom-"),
    ).length;
    if (wecomAgentCount >= dynamicCfg.maxAgents) {
      log(
        `[WeCom] dynamicAgent: maxAgents limit (${dynamicCfg.maxAgents}) reached, skipping agent creation for peer ${peerId}`,
      );
      return { created: false, updatedCfg: cfg };
    }
  }

  // agentId 使用 peerKind 区分，目录结构按 wecom/{kind}/{peerId} 组织
  const agentId = `wecom-${peerKind}-${peerId}`;

  // agent 已存在但缺少 binding，只补 binding
  const existingAgent = (cfg.agents?.list ?? []).find((a) => a.id === agentId);
  if (existingAgent) {
    log(`[WeCom] dynamicAgent: agent "${agentId}" exists, adding missing binding for peer ${peerId}`);
    const updatedCfg: OpenClawConfig = {
      ...cfg,
      bindings: [
        ...existingBindings,
        {
          agentId,
          match: { channel: CHANNEL_ID, peer: { kind: peerKind, id: peerId } },
        },
      ],
    };
    await getWeComRuntime().config.writeConfigFile(updatedCfg);
    return { created: true, updatedCfg, agentId };
  }

  // 解析路径模板（支持 {peerId} / {peerKind} / {agentId} 占位符）
  // 默认目录结构：~/.openclaw/agents/wecom/{peerKind}/{peerId}/
  const workspaceTemplate =
    dynamicCfg.workspaceTemplate ?? "~/.openclaw/agents/wecom/{peerKind}/{peerId}/workspace";
  const agentDirTemplate =
    dynamicCfg.agentDirTemplate ?? "~/.openclaw/agents/wecom/{peerKind}/{peerId}/agent";

  const workspace = resolveUserPath(
    workspaceTemplate
      .replace(/\{peerKind\}/g, peerKind)
      .replace(/\{peerId\}/g, peerId)
      .replace(/\{agentId\}/g, agentId),
  );
  const agentDir = resolveUserPath(
    agentDirTemplate
      .replace(/\{peerKind\}/g, peerKind)
      .replace(/\{peerId\}/g, peerId)
      .replace(/\{agentId\}/g, agentId),
  );

  log(`[WeCom] dynamicAgent: creating agent "${agentId}" for peer ${peerId}`);
  log(`[WeCom] dynamicAgent:   workspace=${workspace}`);
  log(`[WeCom] dynamicAgent:   agentDir=${agentDir}`);

  // 创建目录（目录不存在时 OpenClaw 无法写入 agent 状态）
  await fs.promises.mkdir(workspace, { recursive: true });
  await fs.promises.mkdir(agentDir, { recursive: true });

  // 更新配置（新增 agent + binding）
  const updatedCfg: OpenClawConfig = {
    ...cfg,
    agents: {
      ...cfg.agents,
      list: [
        ...(cfg.agents?.list ?? []),
        { id: agentId, workspace, agentDir },
      ],
    },
    bindings: [
      ...existingBindings,
      {
        agentId,
        match: { channel: CHANNEL_ID, peer: { kind: peerKind, id: peerId } },
      },
    ],
  };

  // 持久化到磁盘
  await getWeComRuntime().config.writeConfigFile(updatedCfg);

  return { created: true, updatedCfg, agentId };
}

/**
 * 将 ~/ 开头的路径展开为绝对路径
 */
function resolveUserPath(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}
