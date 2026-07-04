import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentConfig, IsolationMode, JoinMode, ThinkingLevel } from "./types.ts";

export interface SubagentInvocationContext {
  agentId?: string;
  depth: number;
  native: true;
}

const SUBAGENT_INVOCATION_KEY = Symbol.for("pi-harness.subagentInvocationContext");

const globalWithSubagentInvocation = globalThis as Record<symbol, AsyncLocalStorage<SubagentInvocationContext> | undefined>;
const subagentInvocationStorage = globalWithSubagentInvocation[SUBAGENT_INVOCATION_KEY]
  ?? new AsyncLocalStorage<SubagentInvocationContext>();
globalWithSubagentInvocation[SUBAGENT_INVOCATION_KEY] = subagentInvocationStorage;

export function getSubagentInvocationContext(): SubagentInvocationContext | undefined {
  return subagentInvocationStorage.getStore();
}

export function isSubagentInvocationActive(): boolean {
  return (getSubagentInvocationContext()?.depth ?? 0) > 0;
}

export async function withSubagentInvocationContext<T>(agentId: string | undefined, run: () => Promise<T>): Promise<T> {
  const parent = getSubagentInvocationContext();
  const context: SubagentInvocationContext = {
    agentId: parent?.agentId ?? agentId,
    depth: (parent?.depth ?? 0) + 1,
    native: true,
  };

  return subagentInvocationStorage.run(context, run);
}

export async function withSubagentProcessEnv<T>(agentId: string | undefined, run: () => Promise<T>): Promise<T> {
  return withSubagentInvocationContext(agentId, run);
}

interface AgentInvocationParams {
  model?: string;
  thinking?: string;
  max_turns?: number;
  run_in_background?: boolean;
  inherit_context?: boolean;
  isolated?: boolean;
  isolation?: IsolationMode;
}

export function resolveAgentInvocationConfig(
  agentConfig: AgentConfig | undefined,
  params: AgentInvocationParams,
): {
  modelInput?: string;
  modelFromParams: boolean;
  thinking?: ThinkingLevel;
  maxTurns?: number;
  inheritContext: boolean;
  runInBackground: boolean;
  isolated: boolean;
  isolation?: IsolationMode;
} {
  return {
    modelInput: agentConfig?.model ?? params.model,
    modelFromParams: agentConfig?.model == null && params.model != null,
    thinking: (agentConfig?.thinking ?? params.thinking) as ThinkingLevel | undefined,
    maxTurns: agentConfig?.maxTurns ?? params.max_turns,
    inheritContext: agentConfig?.inheritContext ?? params.inherit_context ?? false,
    runInBackground: agentConfig?.runInBackground ?? params.run_in_background ?? false,
    isolated: agentConfig?.isolated ?? params.isolated ?? false,
    isolation: agentConfig?.isolation ?? params.isolation,
  };
}

export function resolveJoinMode(defaultJoinMode: JoinMode, runInBackground: boolean): JoinMode | undefined {
  return runInBackground ? defaultJoinMode : undefined;
}
