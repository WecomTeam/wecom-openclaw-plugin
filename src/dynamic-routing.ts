import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk/core";

import {
  ensureDynamicAgentProvisioned,
  generateAgentId,
  shouldUseDynamicAgent,
} from "./dynamic-agent.js";
import { CHANNEL_ID } from "./const.js";

export interface AgentRoute {
  agentId: string;
  sessionKey: string;
  matchedBy: string;
  accountId: string;
  mainSessionKey?: string;
}

export interface DynamicRoutingParams {
  route: AgentRoute;
  config: OpenClawConfig;
  core: PluginRuntime;
  accountId: string;
  chatType: "group" | "dm";
  chatId: string;
  senderId: string;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
}

export interface DynamicRoutingResult {
  useDynamicAgent: boolean;
  finalAgentId: string;
  finalSessionKey: string;
  routeModified: boolean;
}

export interface ResolveDynamicRouteParams {
  config: OpenClawConfig;
  core: PluginRuntime;
  accountId: string;
  peer: {
    kind: "direct" | "group";
    id: string;
  };
  senderId: string;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
}

export interface ResolveDynamicRouteResult {
  route: AgentRoute;
  config: OpenClawConfig;
}

export function processDynamicRouting(params: DynamicRoutingParams): DynamicRoutingResult {
  const { route, config, accountId, chatType, chatId, senderId, log } = params;

  log?.(`[dynamic-routing] matchedBy=${route.matchedBy}, agentId=${route.agentId}`);

  if (route.matchedBy !== "default") {
    log?.(`[dynamic-routing] matched bindings (matchedBy=${route.matchedBy}), skip injection`);
    return {
      useDynamicAgent: false,
      finalAgentId: route.agentId,
      finalSessionKey: route.sessionKey,
      routeModified: false,
    };
  }

  const useDynamicAgent = shouldUseDynamicAgent({
    chatType,
    senderId,
    config,
  });
  log?.(`[dynamic-routing] useDynamicAgent=${useDynamicAgent}`);

  if (useDynamicAgent) {
    const targetAgentId = generateAgentId(chatType, chatId, accountId);
    const targetSessionKey = `agent:${targetAgentId}:wecom:${accountId}:${chatType}:${chatId}`;

    log?.(
      `[dynamic-routing] injecting fallback route agentId=${targetAgentId} sessionKey=${targetSessionKey}`,
    );

    return {
      useDynamicAgent: true,
      finalAgentId: targetAgentId,
      finalSessionKey: targetSessionKey,
      routeModified: true,
    };
  }

  return {
    useDynamicAgent: false,
    finalAgentId: route.agentId,
    finalSessionKey: route.sessionKey,
    routeModified: false,
  };
}

export async function resolveDynamicRoute(
  params: ResolveDynamicRouteParams,
): Promise<ResolveDynamicRouteResult> {
  const { config, core, accountId, peer, senderId, log, error } = params;
  const chatType = peer.kind === "group" ? "group" : "dm";
  let effectiveConfig = config;
  let route = core.channel.routing.resolveAgentRoute({
    cfg: effectiveConfig,
    channel: CHANNEL_ID,
    accountId,
    peer,
  });

  const provisionResult = await ensureDynamicAgentProvisioned({
    routeMatchedBy: route.matchedBy,
    config: effectiveConfig,
    runtime: core,
    accountId,
    chatType,
    chatId: peer.id,
    senderId,
    log,
  });
  if (provisionResult.created) {
    effectiveConfig = provisionResult.updatedConfig;
    route = core.channel.routing.resolveAgentRoute({
      cfg: effectiveConfig,
      channel: CHANNEL_ID,
      accountId,
      peer,
    });
    log?.(
      `[dynamic-routing] re-resolved provisioned route matchedBy=${route.matchedBy} agentId=${route.agentId}`,
    );
  } else if (provisionResult.updatedConfig !== effectiveConfig) {
    effectiveConfig = provisionResult.updatedConfig;
  }

  const routingResult = processDynamicRouting({
    route,
    config: effectiveConfig,
    core,
    accountId,
    chatType,
    chatId: peer.id,
    senderId,
    log,
    error,
  });
  if (routingResult.routeModified) {
    route = {
      ...route,
      agentId: routingResult.finalAgentId,
      sessionKey: routingResult.finalSessionKey,
    };
  }

  return { route, config: effectiveConfig };
}
