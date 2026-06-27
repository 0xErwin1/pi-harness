/**
 * SDD Orchestrator Extension for Pi
 *
 * This orchestrator handles SDD commands by injecting delegation messages into
 * the main agent session via `pi.sendUserMessage()`. The main agent then calls
 * the harness-owned `subagent` compatibility tool, which routes through the
 * local subagent manager surface.
 *
 * No child processes are spawned here. The orchestrator is responsible only for:
 *   - Reading Engram state to determine what needs to run
 *   - Building delegation messages that instruct the main agent which subagent to call
 *   - Displaying status (for /sdd-status, which needs no LLM involvement)
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import {
	FIXED_SDD_AGENT_NAMES,
	readSubagentManagerConfig,
	translateSubagentPayload,
	type CompatPayload,
} from "../packages/subagent-manager-pi/index.ts";

const execAsync = promisify(execFile);

type ArtifactPhase =
  | "explore"
  | "proposal"
  | "spec"
  | "design"
  | "tasks"
  | "apply-progress"
  | "verify-report"
  | "archive-report";

interface EngramObservation {
  id: number;
  type: string;
  title: string;
  content: string;
  project: string;
  topic_key?: string;
  created_at: string;
}

interface EngramExportData {
  observations: EngramObservation[];
}

const PHASES: Array<{ phase: ArtifactPhase; skill: string; label: string }> = [
  { phase: "explore", skill: "sdd-explore", label: "Explore" },
  { phase: "proposal", skill: "sdd-propose", label: "Proposal" },
  { phase: "spec", skill: "sdd-spec", label: "Spec" },
  { phase: "design", skill: "sdd-design", label: "Design" },
  { phase: "tasks", skill: "sdd-tasks", label: "Tasks" },
  { phase: "apply-progress", skill: "sdd-apply", label: "Apply" },
  { phase: "verify-report", skill: "sdd-verify", label: "Verify" },
  { phase: "archive-report", skill: "sdd-archive", label: "Archive" },
];

function phaseInfo(phase: ArtifactPhase) {
  return PHASES.find((item) => item.phase === phase)!;
}

function defaultProject(cwd: string): string {
  return basename(cwd) || "project";
}

async function loadExport(): Promise<EngramExportData> {
  const filePath = join(tmpdir(), `engram-sdd-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  try {
    await execAsync("engram", ["export", filePath], { maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(await readFile(filePath, "utf8")) as EngramExportData;
  } finally {
    await unlink(filePath).catch(() => {});
  }
}

function inferLatestChange(data: EngramExportData, project: string): string | undefined {
  const candidates = data.observations
    .filter((observation) => observation.topic_key?.startsWith("sdd/"))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const preferred = candidates.filter((observation) => observation.project === project);

  for (const observation of preferred) {
    const match = observation.topic_key?.match(/^sdd\/([^/]+)\//);
    if (match) return match[1];
  }

  for (const observation of candidates) {
    const match = observation.topic_key?.match(/^sdd\/([^/]+)\//);
    if (match) return match[1];
  }

  return undefined;
}

function phaseObservation(
  data: EngramExportData,
  project: string,
  changeName: string,
  phase: ArtifactPhase,
): EngramObservation | undefined {
  const topicKey = `sdd/${changeName}/${phase}`;

  const exactProjectMatch = data.observations
    .filter((observation) => observation.project === project && observation.topic_key === topicKey)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  if (exactProjectMatch) return exactProjectMatch;

  return data.observations
    .filter((observation) => observation.topic_key === topicKey)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

function phaseStatus(data: EngramExportData, project: string, changeName: string) {
  return Object.fromEntries(
    PHASES.map(({ phase }) => [phase, phaseObservation(data, project, changeName, phase)]),
  ) as Record<ArtifactPhase, EngramObservation | undefined>;
}

function hasSddInit(data: EngramExportData, project: string): boolean {
  return data.observations.some((observation) => {
    if (observation.project !== project) return false;
    if (observation.topic_key === `sdd-init/${project}`) return true;

    const title = observation.title.toLowerCase();
    return title.startsWith("sdd init ") || title === `sdd init ${project}`;
  });
}

function nextPhaseForStatus(status: Record<ArtifactPhase, EngramObservation | undefined>): ArtifactPhase | undefined {
  if (!status.explore) return "explore";
  if (!status.proposal) return "proposal";
  if (!status.spec) return "spec";
  if (!status.design) return "design";
  if (!status.tasks) return "tasks";
  if (!status["apply-progress"]) return "apply-progress";
  if (!status["verify-report"]) return "verify-report";
  if (!status["archive-report"]) return "archive-report";
  return undefined;
}

function formatStatus(changeName: string, status: Record<ArtifactPhase, EngramObservation | undefined>): string {
  const lines = [`## SDD Status: ${changeName}`, ""];

  for (const item of PHASES) {
    const observation = status[item.phase];
    lines.push(
      `- ${observation ? "[x]" : "[ ]"} ${item.label}${observation ? ` — #${observation.id} (${observation.created_at})` : ""}`,
    );
  }

  return lines.join("\n");
}

function dependencyObservations(
  status: Record<ArtifactPhase, EngramObservation | undefined>,
  target: ArtifactPhase,
): EngramObservation[] {
  switch (target) {
    case "proposal":
      return status.explore ? [status.explore] : [];
    case "spec":
      return status.proposal ? [status.proposal] : [];
    case "design":
      return status.proposal ? [status.proposal] : [];
    case "tasks":
      return [status.spec, status.design].filter(Boolean) as EngramObservation[];
    case "apply-progress":
      return [status.tasks, status.spec, status.design, status["apply-progress"]].filter(Boolean) as EngramObservation[];
    case "verify-report":
      return [status.spec, status.tasks, status["apply-progress"]].filter(Boolean) as EngramObservation[];
    case "archive-report":
      return Object.values(status).filter(Boolean) as EngramObservation[];
    default:
      return [];
  }
}

function buildDependencyText(dependencies: EngramObservation[]): string {
  if (dependencies.length === 0) {
    return "- No dependency artifacts found. If the phase requires one, fail explicitly instead of inventing missing context.";
  }

  return dependencies
    .map((dependency) => `- #${dependency.id} ${dependency.topic_key || dependency.title} (${dependency.created_at})`)
    .join("\n");
}

/**
 * Builds a delegation message for a single SDD phase.
 *
 * The resulting message is injected into the main agent session, which is
 * expected to call the `subagent` tool with the parameters listed in the message.
 */
export interface DelegationTransportDecision {
  mode: "manager-compat" | "unsupported";
  reason: string;
  note?: string;
}

export function resolveDelegationTransport(cwd: string, payload: CompatPayload): DelegationTransportDecision {
  const managerConfig = readSubagentManagerConfig(cwd);
  const translation = translateSubagentPayload(payload, {
    fixedAgentNames: FIXED_SDD_AGENT_NAMES,
  });

  if (translation.unsupported) {
    return {
      mode: "unsupported",
      reason: translation.unsupportedReason,
      note: `Harness subagent manager cannot translate this payload yet (${translation.unsupportedReason}). Adjust the delegation request instead of falling back to another package.`,
    };
  }

  const agent = "agent" in payload ? payload.agent : undefined;
  const identityNote = agent && FIXED_SDD_AGENT_NAMES.includes(agent as typeof FIXED_SDD_AGENT_NAMES[number])
    ? `Preserve fixed SDD agent identity: "${agent}".`
    : undefined;

  return {
    mode: "manager-compat",
    reason: `compatible ${translation.mode} payload via ${managerConfig.runtime} runtime`,
    note: identityNote,
  };
}

export function buildDelegationMessage(options: {
  phase: ArtifactPhase;
  changeName: string;
  project: string;
  cwd: string;
  dependencies: EngramObservation[];
}): string {
  const info = phaseInfo(options.phase);
  const topicKey = `sdd/${options.changeName}/${options.phase}`;
  const depText = buildDependencyText(options.dependencies);
  const transport = resolveDelegationTransport(options.cwd, {
    agent: info.skill,
    task: `Execute the SDD ${info.label} phase for ${options.changeName}.`,
    context: "fresh",
  });

  const taskLines = [
    `    You are executing the SDD ${info.label} phase.`,
    `    Change: ${options.changeName}`,
    `    Project: ${options.project}`,
    `    Working directory: ${options.cwd}`,
    `    Artifact store: engram`,
    `    Target topic_key: ${topicKey}`,
    transport.note ? `    ${transport.note}` : undefined,
    ``,
    `    Dependency artifacts (retrieve via mem_get_observation):`,
    ...depText.split("\n").map((l) => `    ${l}`),
    ``,
    `    Instructions: Read and follow /home/iperez/.tabularium/AI/skills/${info.skill}/SKILL.md.`,
    `    Save your artifact to engram with topic_key "${topicKey}" and project "${options.project}".`,
  ].filter((line): line is string => line !== undefined);

  return [
    `[SDD] Execute ${options.phase} phase for change '${options.changeName}'.`,
    "",
    `Call the subagent tool with these parameters:`,
    `- agent: "${info.skill}"`,
    `- context: "fresh"`,
    `- task: |`,
    ...taskLines,
    "",
    `Do not respond with text before calling the tool. Execute immediately.`,
  ].join("\n");
}

/**
 * Builds a multi-phase delegation message for commands that need to run
 * several phases sequentially (e.g. /sdd-new, /sdd-ff).
 *
 * The main agent is instructed to call subagent for each phase in order,
 * waiting for each to complete before starting the next.
 */
export function buildMultiPhaseDelegationMessage(options: {
  phases: ArtifactPhase[];
  changeName: string;
  project: string;
  cwd: string;
  status: Record<ArtifactPhase, EngramObservation | undefined>;
}): string {
  const phaseBlocks = options.phases.map((phase, index) => {
    const info = phaseInfo(phase);
    const topicKey = `sdd/${options.changeName}/${phase}`;

    // For the first phase, use pre-loaded deps. For later phases, the agent must
    // retrieve the artifact saved by the preceding subagent call.
    const deps = dependencyObservations(options.status, phase);
    const depText = buildDependencyText(deps);

    const transport = resolveDelegationTransport(options.cwd, {
      agent: info.skill,
      task: `Execute the SDD ${info.label} phase for ${options.changeName}.`,
      context: "fresh",
    });

    const taskLines = [
      `      You are executing the SDD ${info.label} phase.`,
      `      Change: ${options.changeName}`,
      `      Project: ${options.project}`,
      `      Working directory: ${options.cwd}`,
      `      Artifact store: engram`,
      `      Target topic_key: ${topicKey}`,
      transport.note ? `      ${transport.note}` : undefined,
      ``,
      `      Dependency artifacts (retrieve via mem_get_observation):`,
      ...depText.split("\n").map((l) => `      ${l}`),
      ``,
      `      Instructions: Read and follow /home/iperez/.tabularium/AI/skills/${info.skill}/SKILL.md.`,
      `      Save your artifact to engram with topic_key "${topicKey}" and project "${options.project}".`,
    ].filter((line): line is string => line !== undefined);

    return [
      `Step ${index + 1}: ${info.label} (agent: "${info.skill}")`,
      `  Call subagent tool with:`,
      `  - agent: "${info.skill}"`,
      `  - context: "fresh"`,
      `  - task: |`,
      ...taskLines,
    ].join("\n");
  });

  return [
    `[SDD] Run change '${options.changeName}': execute ${options.phases.map((p) => phaseInfo(p).label).join(" → ")} phases sequentially.`,
    "",
    `Execute each step in order. Wait for each subagent call to complete before starting the next.`,
    `After each phase, the artifact is available in engram — pass its ID as a dependency to the following phase.`,
    "",
    ...phaseBlocks,
    "",
    `Do not respond with text before calling the first subagent tool. Execute immediately.`,
  ].join("\n");
}

function report(pi: ExtensionAPI, ctx: ExtensionCommandContext, title: string, body: string) {
  if (!ctx.hasUI) {
    console.log(`## ${title}\n\n${body}`);
  }

  pi.sendMessage(
    {
      customType: "sdd-report",
      content: `## ${title}\n\n${body}`,
      display: true,
      details: { title },
    },
    { triggerTurn: false },
  );
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("sdd-init", {
    description: "Execute SDD initialization for the current project",
    async handler(args, ctx) {
      await ctx.waitForIdle();
      const project = args.trim() || defaultProject(ctx.cwd);

      try {
        const data = await loadExport();

        if (hasSddInit(data, project)) {
          report(pi, ctx, `SDD init: ${project}`, "Project is already initialized. No action needed.");
          return;
        }

        const message = [
          `[SDD] Initialize project '${project}'.`,
          "",
          `Call the subagent tool with these parameters:`,
          `- agent: "sdd-init"`,
          `- context: "fresh"`,
          `- task: |`,
          `    Initialize SDD for project '${project}'.`,
          `    Working directory: ${ctx.cwd}`,
          `    Artifact store: engram`,
          ``,
          `    Instructions: Read and follow /home/iperez/.tabularium/AI/skills/sdd-init/SKILL.md.`,
          `    Save the init artifact to engram with topic_key "sdd-init/${project}" and project "${project}".`,
          "",
          `Do not respond with text before calling the tool. Execute immediately.`,
        ].join("\n");

        await pi.sendUserMessage(message, { deliverAs: "followUp" });
      } catch (error: any) {
        report(pi, ctx, `SDD init failed: ${project}`, error.message || String(error));
      }
    },
  });

  pi.registerCommand("sdd-new", {
    description: "Start a new SDD change through explore + proposal. Usage: /sdd-new <change-name>",
    async handler(args, ctx) {
      await ctx.waitForIdle();
      const changeName = args.trim();
      if (!changeName) {
        ctx.ui.notify("Usage: /sdd-new <change-name>", "error");
        return;
      }

      const project = defaultProject(ctx.cwd);

      try {
        const data = await loadExport();
        const status = phaseStatus(data, project, changeName);

        const message = buildMultiPhaseDelegationMessage({
          phases: ["explore", "proposal"],
          changeName,
          project,
          cwd: ctx.cwd,
          status,
        });

        await pi.sendUserMessage(message, { deliverAs: "followUp" });
      } catch (error: any) {
        report(pi, ctx, `SDD new failed: ${changeName}`, error.message || String(error));
      }
    },
  });

  pi.registerCommand("sdd-continue", {
    description: "Execute the next missing SDD phase from Engram artifacts. Usage: /sdd-continue [change-name]",
    async handler(args, ctx) {
      await ctx.waitForIdle();
      const project = defaultProject(ctx.cwd);

      try {
        const data = await loadExport();
        const changeName = args.trim() || inferLatestChange(data, project);

        if (!changeName) {
          report(pi, ctx, "SDD continue failed", "No SDD change could be inferred. Pass a change name explicitly.");
          return;
        }

        const status = phaseStatus(data, project, changeName);
        const phase = nextPhaseForStatus(status);

        if (!phase) {
          report(pi, ctx, `SDD continue: ${changeName}`, "All known SDD phases already have artifacts.");
          return;
        }

        const dependencies = dependencyObservations(status, phase);
        const message = buildDelegationMessage({
          phase,
          changeName,
          project,
          cwd: ctx.cwd,
          dependencies,
        });

        await pi.sendUserMessage(message, { deliverAs: "followUp" });
      } catch (error: any) {
        report(pi, ctx, "SDD continue failed", error.message || String(error));
      }
    },
  });

  pi.registerCommand("sdd-ff", {
    description: "Execute all missing planning phases through tasks. Usage: /sdd-ff <change-name>",
    async handler(args, ctx) {
      await ctx.waitForIdle();
      const changeName = args.trim();
      if (!changeName) {
        ctx.ui.notify("Usage: /sdd-ff <change-name>", "error");
        return;
      }

      const project = defaultProject(ctx.cwd);
      const planningPhases: ArtifactPhase[] = ["explore", "proposal", "spec", "design", "tasks"];

      try {
        const data = await loadExport();
        const status = phaseStatus(data, project, changeName);

        const missingPhases = planningPhases.filter((phase) => !status[phase]);

        if (missingPhases.length === 0) {
          report(pi, ctx, `SDD fast-forward: ${changeName}`, "All planning phases already have artifacts. Nothing to run.");
          return;
        }

        const message = buildMultiPhaseDelegationMessage({
          phases: missingPhases,
          changeName,
          project,
          cwd: ctx.cwd,
          status,
        });

        await pi.sendUserMessage(message, { deliverAs: "followUp" });
      } catch (error: any) {
        report(pi, ctx, `SDD fast-forward failed: ${changeName}`, error.message || String(error));
      }
    },
  });

  pi.registerCommand("sdd-apply", {
    description: "Execute the SDD apply phase. Usage: /sdd-apply <change-name>",
    async handler(args, ctx) {
      await ctx.waitForIdle();
      const changeName = args.trim();
      if (!changeName) {
        ctx.ui.notify("Usage: /sdd-apply <change-name>", "error");
        return;
      }

      const project = defaultProject(ctx.cwd);

      try {
        const data = await loadExport();
        const status = phaseStatus(data, project, changeName);
        const dependencies = dependencyObservations(status, "apply-progress");

        const message = buildDelegationMessage({
          phase: "apply-progress",
          changeName,
          project,
          cwd: ctx.cwd,
          dependencies,
        });

        await pi.sendUserMessage(message, { deliverAs: "followUp" });
      } catch (error: any) {
        report(pi, ctx, `SDD apply failed: ${changeName}`, error.message || String(error));
      }
    },
  });

  pi.registerCommand("sdd-verify", {
    description: "Execute the SDD verify phase. Usage: /sdd-verify <change-name>",
    async handler(args, ctx) {
      await ctx.waitForIdle();
      const changeName = args.trim();
      if (!changeName) {
        ctx.ui.notify("Usage: /sdd-verify <change-name>", "error");
        return;
      }

      const project = defaultProject(ctx.cwd);

      try {
        const data = await loadExport();
        const status = phaseStatus(data, project, changeName);
        const dependencies = dependencyObservations(status, "verify-report");

        const message = buildDelegationMessage({
          phase: "verify-report",
          changeName,
          project,
          cwd: ctx.cwd,
          dependencies,
        });

        await pi.sendUserMessage(message, { deliverAs: "followUp" });
      } catch (error: any) {
        report(pi, ctx, `SDD verify failed: ${changeName}`, error.message || String(error));
      }
    },
  });

  pi.registerCommand("sdd-archive", {
    description: "Execute the SDD archive phase. Usage: /sdd-archive <change-name>",
    async handler(args, ctx) {
      await ctx.waitForIdle();
      const changeName = args.trim();
      if (!changeName) {
        ctx.ui.notify("Usage: /sdd-archive <change-name>", "error");
        return;
      }

      const project = defaultProject(ctx.cwd);

      try {
        const data = await loadExport();
        const status = phaseStatus(data, project, changeName);
        const dependencies = dependencyObservations(status, "archive-report");

        const message = buildDelegationMessage({
          phase: "archive-report",
          changeName,
          project,
          cwd: ctx.cwd,
          dependencies,
        });

        await pi.sendUserMessage(message, { deliverAs: "followUp" });
      } catch (error: any) {
        report(pi, ctx, `SDD archive failed: ${changeName}`, error.message || String(error));
      }
    },
  });

  pi.registerCommand("sdd-status", {
    description: "Show structured SDD artifact status from Engram. Usage: /sdd-status [change-name]",
    async handler(args, ctx) {
      await ctx.waitForIdle();
      const project = defaultProject(ctx.cwd);

      try {
        const data = await loadExport();
        const changeName = args.trim() || inferLatestChange(data, project);

        if (!changeName) {
          report(pi, ctx, "SDD status", "No SDD change found for this project.");
          return;
        }

        report(pi, ctx, `SDD status: ${changeName}`, formatStatus(changeName, phaseStatus(data, project, changeName)));
      } catch (error: any) {
        report(pi, ctx, "SDD status failed", error.message || String(error));
      }
    },
  });
}
