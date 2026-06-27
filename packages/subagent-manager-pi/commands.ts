import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RunSnapshot } from "../subagent-manager-core/events.ts";
import {
  renderDoctorResult,
  renderInterruptResult,
  renderStatusResult,
} from "./tui/render.ts";

export type SubagentManagerRuntimeMode = "hybrid" | "manager";

export interface SubagentManagerConfig {
  runtime: SubagentManagerRuntimeMode;
}

export interface AgentRoutingOverride {
  model?: string;
  thinking?: string;
}

export interface ManagerCommandPlaceholder {
  name: "status" | "interrupt" | "doctor";
  description: string;
}

export interface ManagerCommandBackend {
  status(id?: string): Promise<RunSnapshot[]>;
  interrupt(id: string): Promise<void>;
}

export interface ManagerStatusResult {
  command: "status";
  config: SubagentManagerConfig;
  available: boolean;
  backendPresent: boolean;
  runs: RunSnapshot[];
  message: string;
  lines: string[];
}

export interface ManagerInterruptResult {
  command: "interrupt";
  config: SubagentManagerConfig;
  available: boolean;
  backendPresent: boolean;
  runId: string;
  message: string;
  lines: string[];
}

export interface ManagerDoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ManagerDoctorResult {
  command: "doctor";
  config: SubagentManagerConfig;
  backendPresent: boolean;
  checks: ManagerDoctorCheck[];
  lines: string[];
}

export interface ManagerCommandContext {
  cwd: string;
  backend?: ManagerCommandBackend;
}

export const DEFAULT_SUBAGENT_MANAGER_CONFIG: SubagentManagerConfig = {
  runtime: "manager",
};

export const MANAGER_COMMAND_PLACEHOLDERS: readonly ManagerCommandPlaceholder[] =
  [
    { name: "status", description: "Show manager-backed run status." },
    {
      name: "interrupt",
      description: "Request interruption for a manager-backed run id.",
    },
    { name: "doctor", description: "Explain manager runtime readiness." },
  ] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function settingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

export function readSubagentManagerConfig(cwd: string): SubagentManagerConfig {
  const path = settingsPath(cwd);
  if (!existsSync(path)) return { ...DEFAULT_SUBAGENT_MANAGER_CONFIG };

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(parsed) || !isRecord(parsed.subagentManager)) {
      return { ...DEFAULT_SUBAGENT_MANAGER_CONFIG };
    }

    const runtime = parsed.subagentManager.runtime;
    return {
      runtime:
        runtime === "hybrid" || runtime === "manager"
          ? runtime
          : DEFAULT_SUBAGENT_MANAGER_CONFIG.runtime,
    };
  } catch {
    return { ...DEFAULT_SUBAGENT_MANAGER_CONFIG };
  }
}

export function managerCompatibilityEnabled(_cwd: string): boolean {
  return true;
}

export function projectSettingsPath(cwd: string): string {
  return settingsPath(cwd);
}

export function builtinAgentDirectories(
  cwd: string,
  packageRoot: string,
): string[] {
  return [
    join(packageRoot, "assets", "agents"),
    join(packageRoot, "agents"),
    join(cwd, ".pi", "agents"),
    join(cwd, ".agents"),
    join(homedir(), ".pi", "agent", "agents"),
    join(homedir(), ".agents"),
  ];
}

function readSettings(cwd: string): Record<string, unknown> {
  const path = settingsPath(cwd);
  if (!existsSync(path)) return {};

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeSettings(cwd: string, settings: Record<string, unknown>): void {
  const path = settingsPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, "\t")}\n`);
}

export function saveBuiltinAgentRoutingOverride(
  cwd: string,
  name: string,
  override: AgentRoutingOverride | undefined,
): boolean {
  const settings = readSettings(cwd);
  const manager = isRecord(settings.subagentManager)
    ? { ...settings.subagentManager }
    : {};
  const agentOverrides = isRecord(manager.agentOverrides)
    ? { ...manager.agentOverrides }
    : {};

  if (!override?.model && !override?.thinking) {
    delete agentOverrides[name];
  } else {
    const current = isRecord(agentOverrides[name])
      ? { ...agentOverrides[name] }
      : {};
    if (override.model === undefined) delete current.model;
    else current.model = override.model;
    if (override.thinking === undefined) delete current.thinking;
    else current.thinking = override.thinking;
    if (Object.keys(current).length > 0) agentOverrides[name] = current;
    else delete agentOverrides[name];
  }

  manager.runtime = readSubagentManagerConfig(cwd).runtime;
  if (Object.keys(agentOverrides).length > 0)
    manager.agentOverrides = agentOverrides;
  else delete manager.agentOverrides;
  settings.subagentManager = manager;

  writeSettings(cwd, settings);
  return true;
}

function statusUnavailableMessage(): string {
  return "Manager status backend is not wired in this session yet.";
}

function interruptUnavailableMessage(): string {
  return "Manager interrupt backend is not wired in this session yet.";
}

export async function getManagerStatus(
  context: ManagerCommandContext,
  runId?: string,
): Promise<ManagerStatusResult> {
  const config = readSubagentManagerConfig(context.cwd);
  const backend = context.backend;
  const backendPresent = Boolean(backend);
  if (!backend) {
    const message = statusUnavailableMessage();
    const result: ManagerStatusResult = {
      command: "status",
      config,
      available: false,
      backendPresent,
      runs: [],
      message,
      lines: [],
    };
    result.lines = renderStatusResult(result);
    return result;
  }

  const runs = await backend.status(runId);
  const message =
    runs.length > 0
      ? "Manager-backed runs found."
      : "No manager-backed runs recorded yet.";
  const result: ManagerStatusResult = {
    command: "status",
    config,
    available: true,
    backendPresent,
    runs,
    message,
    lines: [],
  };
  result.lines = renderStatusResult(result);
  return result;
}

export async function requestManagerInterrupt(
  context: ManagerCommandContext,
  runId: string,
): Promise<ManagerInterruptResult> {
  const config = readSubagentManagerConfig(context.cwd);
  const backend = context.backend;
  const backendPresent = Boolean(backend);
  if (!backend) {
    const message = interruptUnavailableMessage();
    const result: ManagerInterruptResult = {
      command: "interrupt",
      config,
      available: false,
      backendPresent,
      runId,
      message,
      lines: [],
    };
    result.lines = renderInterruptResult(result);
    return result;
  }

  await backend.interrupt(runId);
  const result: ManagerInterruptResult = {
    command: "interrupt",
    config,
    available: true,
    backendPresent,
    runId,
    message: `Interrupt requested for manager run '${runId}'.`,
    lines: [],
  };
  result.lines = renderInterruptResult(result);
  return result;
}

export function runManagerDoctor(
  context: ManagerCommandContext,
): ManagerDoctorResult {
  const config = readSubagentManagerConfig(context.cwd);
  const backendPresent = Boolean(context.backend);
  const checks: ManagerDoctorCheck[] = [
    {
      name: "runtime",
      ok: true,
      detail: `Harness subagent manager is mandatory; runtime=${config.runtime}.`,
    },
    {
      name: "status-surface",
      ok: backendPresent,
      detail: backendPresent
        ? "Status and interrupt can read the manager store/events surface."
        : "No live manager backend was provided for this command context.",
    },
    {
      name: "dependency",
      ok: true,
      detail:
        "No pi-subagents dependency or fallback is required by the manager config.",
    },
  ];

  const result: ManagerDoctorResult = {
    command: "doctor",
    config,
    backendPresent,
    checks,
    lines: [],
  };
  result.lines = renderDoctorResult(result);
  return result;
}

export function createManagerCommandSurface(context: ManagerCommandContext) {
  return {
    status: (runId?: string) => getManagerStatus(context, runId),
    interrupt: (runId: string) => requestManagerInterrupt(context, runId),
    doctor: () => runManagerDoctor(context),
  };
}

export const updateBuiltinModelOverride = saveBuiltinAgentRoutingOverride;
