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
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { detectSddProject, renderSddInitMarkdown, type SddProjectDetection } from "./sdd/project-detector.ts";
import {
  buildInitPersistenceContract,
  buildPhasePersistenceContract,
  buildSddTasksAtlasContract,
  defaultPreflightState,
  getCachedPreflightState,
  setCachedPreflightState,
  type PhasePersistenceContract,
  type SddPreflightState,
} from "./sdd/preflight.ts";

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

export type TestingArtifactPhase = "suites" | "explore" | "plan" | "run" | "run-latest" | "report" | "setup-state";
export type TestingNextRecommended =
  | "intake"
  | "explore-testing"
  | "suites-gate"
  | "plan-testing"
  | "run-testing"
  | "merge-recovery"
  | "report-testing"
  | "done";
export type TestingDirectPhase = "explore-testing" | "plan-testing" | "run-testing" | "report-testing";

export interface TestingArtifactRef {
  phase: TestingArtifactPhase;
  topicKey: string;
  atlasLogicalPath: string;
  observation?: EngramObservation;
}

export interface ResolvedSddTestingStatus {
  projectSlug: string;
  featureSlug?: string;
  featureName?: string;
  artifacts: Record<TestingArtifactPhase, TestingArtifactRef | undefined>;
  latestSessionId?: string;
  nextRecommended: TestingNextRecommended;
}

export interface TestingPersistenceContract {
  contractName: "TestingPersistenceContract";
  version: 1;
  project: string;
  projectSlug: string;
  featureSlug: string;
  phase: string;
  artifact: {
    topicKey: string;
    atlasLogicalPath: string;
    sessionId?: string;
    unitId?: string;
  };
  authorities: {
    agentOrchestratorSourceOfTruth: "engram";
    humanReadableDocumentationMirror: "atlas";
  };
  engram: {
    required: true;
    project: string;
    topicKey: string;
    role: "source-of-truth-for-agents-and-orchestrator";
    write: "summary-pointer-and-recovery" | "run-shard-full-content-and-pointer";
  };
  atlas: {
    backend: "atlas";
    logicalPath: string;
    role: "human-readable-documentation-mirror";
    approvalRequired: true;
    approvalState: "needs-approval";
    mutationPermitted: false;
    writeBehavior: "write-only-when-approved-and-available";
  };
  fallback: {
    ifEngramUnavailable: "blocked";
    ifAtlasUnavailableOrUnapproved: "save-allowed-engram-artifact-or-pointer-and-return-partial";
  };
  parentOwned?: {
    runLatest: true;
    runSummary: true;
  };
}

const TESTING_STATUS_PHASES: TestingArtifactPhase[] = [
  "setup-state",
  "explore",
  "suites",
  "plan",
  "run-latest",
  "report",
];

const TESTING_DIRECT_PHASE_TO_AGENT: Record<TestingDirectPhase, string> = {
  "explore-testing": "sdd-explore-testing",
  "plan-testing": "sdd-plan-testing",
  "run-testing": "sdd-run-testing",
  "report-testing": "sdd-report-testing",
};

const TESTING_DIRECT_PHASE_TO_ARTIFACT: Record<TestingDirectPhase, TestingArtifactPhase> = {
  "explore-testing": "explore",
  "plan-testing": "plan",
  "run-testing": "run",
  "report-testing": "report",
};

export function slugTestingName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-");
  const trimmed = (slug || "unnamed").slice(0, 40).replace(/-+$/g, "");
  return trimmed || "unnamed";
}

function requireTestingFeatureSlug(featureSlug: string | undefined, phase: TestingArtifactPhase): string {
  if (!featureSlug) throw new Error(`Testing artifact '${phase}' requires a featureSlug.`);
  return featureSlug;
}

export function testingTopicKey(options: {
  projectSlug: string;
  featureSlug?: string;
  phase: TestingArtifactPhase;
  sessionId?: string;
  unitId?: string;
}): string {
  const projectRoot = `testing/${options.projectSlug}`;
  if (options.phase === "setup-state") return `${projectRoot}/setup-state`;

  const featureRoot = `${projectRoot}/${requireTestingFeatureSlug(options.featureSlug, options.phase)}`;
  switch (options.phase) {
    case "suites":
    case "explore":
    case "plan":
    case "report":
      return `${featureRoot}/${options.phase}`;
    case "run-latest":
      return `${featureRoot}/run/latest`;
    case "run": {
      if (!options.sessionId) throw new Error("Testing run artifacts require an explicit sessionId.");
      return options.unitId ? `${featureRoot}/run/${options.sessionId}/${options.unitId}` : `${featureRoot}/run/${options.sessionId}`;
    }
    default:
      return featureRoot;
  }
}

export function testingAtlasLogicalPath(options: {
  projectSlug: string;
  featureSlug?: string;
  phase: TestingArtifactPhase;
  sessionId?: string;
  unitId?: string;
}): string {
  const projectRoot = `testing/${options.projectSlug}`;
  if (options.phase === "setup-state") return `${projectRoot}/setup-state.md`;

  const featureRoot = `${projectRoot}/${requireTestingFeatureSlug(options.featureSlug, options.phase)}`;
  switch (options.phase) {
    case "suites":
    case "explore":
    case "plan":
    case "report":
      return `${featureRoot}/${options.phase}.md`;
    case "run-latest":
      return `${featureRoot}/runs/latest.md`;
    case "run": {
      if (!options.sessionId) throw new Error("Testing run artifacts require an explicit sessionId.");
      return options.unitId ? `${featureRoot}/runs/${options.sessionId}/${options.unitId}.md` : `${featureRoot}/runs/${options.sessionId}/summary.md`;
    }
    default:
      return featureRoot;
  }
}

function testingArtifactRef(options: {
  projectSlug: string;
  featureSlug?: string;
  phase: TestingArtifactPhase;
  sessionId?: string;
  unitId?: string;
  observation?: EngramObservation;
}): TestingArtifactRef {
  return {
    phase: options.phase,
    topicKey: testingTopicKey(options),
    atlasLogicalPath: testingAtlasLogicalPath(options),
    observation: options.observation,
  };
}

function defaultTestingArtifacts(): Record<TestingArtifactPhase, TestingArtifactRef | undefined> {
  return {
    suites: undefined,
    explore: undefined,
    plan: undefined,
    run: undefined,
    "run-latest": undefined,
    report: undefined,
    "setup-state": undefined,
  };
}

function defaultProject(cwd: string): string {
  return basename(cwd) || "project";
}

const TESTING_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TESTING_SESSION_ID_PATTERN = /^(?=.*[0-9])[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SDD_RUN_TESTING_USAGE = "Usage: /sdd-run-testing <feature> <session_id> <unit_id>. Direct run requires <feature> <session_id> <unit_id>; example: /sdd-run-testing Add SDD Testing Flow 20260705-1200 unit-1";
const TESTING_PLACEHOLDER_TOKENS = new Set(["sessionid", "unitid", "latest", "placeholder", "changeme", "todo", "tbd"]);

function quotePromptValue(value: string): string {
  return JSON.stringify(value);
}

function normalizedTestingToken(value: string): string {
  let token = value.trim().toLowerCase();
  token = token.match(/^\$\{(.+)\}$/)?.[1] ?? token;
  token = token.match(/^<(.+)>$/)?.[1] ?? token;
  token = token.match(/^\{(.+)\}$/)?.[1] ?? token;
  token = token.match(/^\[(.+)\]$/)?.[1] ?? token;
  return token.replace(/[^a-z0-9]/g, "");
}

function isPlaceholderLikeTestingToken(value: string): boolean {
  const normalized = normalizedTestingToken(value);
  return !normalized || TESTING_PLACEHOLDER_TOKENS.has(normalized);
}

function isValidTestingRunId(value: string): boolean {
  return TESTING_RUN_ID_PATTERN.test(value) && !isPlaceholderLikeTestingToken(value);
}

function isValidTestingSessionId(value: string): boolean {
  return TESTING_SESSION_ID_PATTERN.test(value) && !isPlaceholderLikeTestingToken(value);
}

function looksLikeFeatureOnlyRunTestingInput(parts: string[], sessionId: string, unitId: string): boolean {
  return parts.length > 3 && !/\d/.test(sessionId) && !/\d/.test(unitId);
}

export function parseSddRunTestingArgs(args: string):
  | { ok: true; featureName: string; sessionId: string; unitId: string }
  | { ok: false; error: string } {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) {
    return { ok: false, error: SDD_RUN_TESTING_USAGE };
  }

  const unitId = parts.at(-1)!;
  const sessionId = parts.at(-2)!;
  const featureName = parts.slice(0, -2).join(" ").trim();
  if (!featureName) return { ok: false, error: SDD_RUN_TESTING_USAGE };
  if (isPlaceholderLikeTestingToken(sessionId)) {
    return { ok: false, error: "session_id must be a real run session id, not a placeholder such as session_id, ${session_id}, session-id, or latest." };
  }
  if (isPlaceholderLikeTestingToken(unitId)) {
    return { ok: false, error: "unit_id must be a real run unit id, not a placeholder such as unit_id, ${unit_id}, unit-id, or latest." };
  }
  if (looksLikeFeatureOnlyRunTestingInput(parts, sessionId, unitId)) {
    return { ok: false, error: SDD_RUN_TESTING_USAGE };
  }
  if (!isValidTestingSessionId(sessionId)) {
    return { ok: false, error: "session_id must be 1-64 characters of letters, numbers, dot, underscore, or hyphen and include a digit." };
  }
  if (!isValidTestingRunId(unitId)) {
    return { ok: false, error: "unit_id must be 1-64 characters of letters, numbers, dot, underscore, or hyphen." };
  }

  return { ok: true, featureName, sessionId, unitId };
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

function testingObservation(data: EngramExportData, project: string, topicKey: string): EngramObservation | undefined {
  const projectMatch = data.observations
    .filter((observation) => observation.project === project && observation.topic_key === topicKey)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  if (projectMatch) return projectMatch;

  return data.observations
    .filter((observation) => observation.topic_key === topicKey)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

function inferLatestTestingFeature(data: EngramExportData, projectSlug: string, project: string): string | undefined {
  const prefix = `testing/${projectSlug}/`;
  const candidates = data.observations
    .filter((observation) => observation.topic_key?.startsWith(prefix))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const featureFrom = (observations: EngramObservation[]): string | undefined => {
    for (const observation of observations) {
      const rest = observation.topic_key?.slice(prefix.length) ?? "";
      const [featureSlug] = rest.split("/");
      if (featureSlug && featureSlug !== "setup-state") return featureSlug;
    }
    return undefined;
  };

  return featureFrom(candidates.filter((observation) => observation.project === project)) ?? featureFrom(candidates);
}

function latestSessionIdFrom(observation: EngramObservation | undefined): string | undefined {
  if (!observation) return undefined;

  const consolidatedRunRefPattern = /testing\/[^/\s`"')\]}]+\/[^/\s`"')\]}]+\/run\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})(?=$|[\s`"',)\]}])/g;
  for (const match of observation.content.matchAll(consolidatedRunRefPattern)) {
    const sessionId = match[1];
    if (isValidTestingSessionId(sessionId)) return sessionId;
  }

  return undefined;
}

function nextTestingPhase(artifacts: Record<TestingArtifactPhase, TestingArtifactRef | undefined>): TestingNextRecommended {
  if (!artifacts.explore) return "explore-testing";
  if (!artifacts.suites) return "suites-gate";
  if (!artifacts.plan) return "plan-testing";
  if (!artifacts["run-latest"]) return "run-testing";
  if (!artifacts.run) return "merge-recovery";
  if (!artifacts.report) return "report-testing";
  return "done";
}

export function resolveSddTestingStatus(options: {
  data: EngramExportData;
  project: string;
  featureName?: string;
}): ResolvedSddTestingStatus {
  const projectSlug = slugTestingName(options.project);
  const featureSlug = options.featureName?.trim()
    ? slugTestingName(options.featureName)
    : inferLatestTestingFeature(options.data, projectSlug, options.project);
  const artifacts = defaultTestingArtifacts();
  const setupRef = testingArtifactRef({
    projectSlug,
    phase: "setup-state",
    observation: testingObservation(
      options.data,
      options.project,
      testingTopicKey({ projectSlug, phase: "setup-state" }),
    ),
  });
  artifacts["setup-state"] = setupRef.observation ? setupRef : undefined;

  if (!featureSlug) {
    return { projectSlug, artifacts, nextRecommended: "intake" };
  }

  for (const phase of TESTING_STATUS_PHASES.filter((phase) => phase !== "setup-state")) {
    const ref = testingArtifactRef({
      projectSlug,
      featureSlug,
      phase,
      observation: testingObservation(options.data, options.project, testingTopicKey({ projectSlug, featureSlug, phase })),
    });
    artifacts[phase] = ref.observation ? ref : undefined;
  }

  const latestSessionId = latestSessionIdFrom(artifacts["run-latest"]?.observation);
  if (latestSessionId) {
    const ref = testingArtifactRef({
      projectSlug,
      featureSlug,
      phase: "run",
      sessionId: latestSessionId,
      observation: testingObservation(
        options.data,
        options.project,
        testingTopicKey({ projectSlug, featureSlug, phase: "run", sessionId: latestSessionId }),
      ),
    });
    artifacts.run = ref.observation ? ref : undefined;
  }

  return {
    projectSlug,
    featureSlug,
    featureName: options.featureName?.trim() || featureSlug,
    artifacts,
    latestSessionId,
    nextRecommended: nextTestingPhase(artifacts),
  };
}

export function formatTestingStatus(status: ResolvedSddTestingStatus): string {
  const title = status.featureSlug ?? "intake needed";
  const lines = [`## Testing Status: ${title}`, "", `Project slug: ${status.projectSlug}`];

  if (!status.featureSlug) {
    lines.push("Feature: not selected", "Next recommended: intake");
    return lines.join("\n");
  }

  lines.push(`Feature slug: ${status.featureSlug}`);
  if (status.latestSessionId) lines.push(`Latest session: ${status.latestSessionId}`);
  lines.push("", "Artifacts:");

  for (const phase of ["setup-state", "explore", "suites", "plan", "run-latest", "report"] as TestingArtifactPhase[]) {
    const ref = status.artifacts[phase] ?? testingArtifactRef({ projectSlug: status.projectSlug, featureSlug: status.featureSlug, phase });
    const observation = status.artifacts[phase]?.observation;
    lines.push(
      `- ${observation ? "[x]" : "[ ]"} ${phase} — ${ref.topicKey}${observation ? ` (#${observation.id}, ${observation.created_at})` : ""}`,
    );
  }

  lines.push("", `Next recommended: ${status.nextRecommended}`);
  lines.push(
    "Modes remain visible in testing plans/reports: Playwright/browser, backend, API, live browser/no-code, mobile/Maestro, visual diff. Missing capabilities should be reported as blocked or unsupported.",
  );
  return lines.join("\n");
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
  if (status["verify-report"] && !status["archive-report"]) return "archive-report";
  if (status["apply-progress"] && !status["verify-report"]) return "verify-report";
  if (status.spec && status.design && status.tasks && !status["apply-progress"]) return "apply-progress";
  if (status.spec && status.design && !status.tasks) return "tasks";
  if (status.proposal && !status.spec) return "spec";
  if (status.proposal && !status.design) return "design";
  if (status.explore && !status.proposal) return "proposal";
  if (!status.explore) return "explore";
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

export interface ResolvedSddStatus {
  changeName?: string;
  status: Record<ArtifactPhase, EngramObservation | undefined>;
  nextPhase?: ArtifactPhase;
  dependencies: EngramObservation[];
}

export function resolveSddStatus(options: {
  data: EngramExportData;
  project: string;
  changeName?: string;
}): ResolvedSddStatus {
  const changeName = options.changeName?.trim() || inferLatestChange(options.data, options.project);
  const emptyStatus = Object.fromEntries(PHASES.map(({ phase }) => [phase, undefined])) as Record<
    ArtifactPhase,
    EngramObservation | undefined
  >;

  if (!changeName) {
    return { status: emptyStatus, dependencies: [] };
  }

  const status = phaseStatus(options.data, options.project, changeName);
  const nextPhase = nextPhaseForStatus(status);
  return {
    changeName,
    status,
    nextPhase,
    dependencies: nextPhase ? dependencyObservations(status, nextPhase) : [],
  };
}

function buildDependencyText(dependencies: EngramObservation[]): string {
  if (dependencies.length === 0) {
    return "- No dependency artifacts found. If the phase requires one, fail explicitly instead of inventing missing context.";
  }

  return dependencies
    .map((dependency) => `- #${dependency.id} ${dependency.topic_key || dependency.title} (${dependency.created_at})`)
    .join("\n");
}

function dependencyPhases(target: ArtifactPhase): ArtifactPhase[] {
  switch (target) {
    case "proposal":
      return ["explore"];
    case "spec":
    case "design":
      return ["proposal"];
    case "tasks":
      return ["spec", "design"];
    case "apply-progress":
      return ["tasks", "spec", "design", "apply-progress"];
    case "verify-report":
      return ["spec", "tasks", "apply-progress"];
    case "archive-report":
      return PHASES.map(({ phase }) => phase).filter((phase) => phase !== "archive-report");
    default:
      return [];
  }
}

function buildDependencyTopicKeyText(changeName: string, target: ArtifactPhase): string {
  const phases = dependencyPhases(target);
  if (phases.length === 0) return "- No dependency topic keys required for this phase.";
  return phases.map((phase) => `- sdd/${changeName}/${phase}`).join("\n");
}

function preflightFor(options: { project: string; cwd: string; preflight?: SddPreflightState }): SddPreflightState {
  if (options.preflight) return options.preflight;

  const cached = getCachedPreflightState({ project: options.project, cwd: options.cwd });
  if (cached) return cached;

  const state = defaultPreflightState({ project: options.project, cwd: options.cwd });
  setCachedPreflightState(state);
  return state;
}

function formatContractJson(contract: PhasePersistenceContract): string {
  return JSON.stringify(contract, null, 2);
}

function contractForPhase(
  preflight: SddPreflightState,
  input: { change: string; phase: ArtifactPhase },
): PhasePersistenceContract {
  if (input.phase === "tasks") {
    return buildSddTasksAtlasContract(preflight, { change: input.change });
  }

  return buildPhasePersistenceContract(preflight, input);
}

function buildPersistenceContractLines(contract: PhasePersistenceContract): string[] {
  const atlasPath = contract.humanArtifact.backend === "atlas" ? contract.humanArtifact.logicalPath : "not-selected";
  return [
    `Artifact store: ${contract.artifactStore}`,
    `Engram topic key: ${contract.engram.topicKey}`,
    `Engram role: agent memory summary/pointer`,
    `Atlas logical path: ${atlasPath}`,
    `Human artifact backend: ${contract.humanArtifact.backend}`,
    `Approval state: ${contract.humanArtifact.approvalState}`,
    `Mutation permitted: ${String(contract.humanArtifact.mutationPermitted)}`,
    `No Atlas mutation unless approved: Do not create or update Atlas records unless mutationPermitted is true and approvalState is approved.`,
    `Persistence contract JSON:`,
    ...formatContractJson(contract).split("\n"),
  ];
}

function packageManagerSummary(detection: SddProjectDetection): string {
  if (detection.packageManagers.length === 0) return "none detected";
  return detection.packageManagers
    .map((manager) => `${manager.name}${manager.version ? `@${manager.version}` : ""}`)
    .join(", ");
}

function stackSummary(detection: SddProjectDetection): string {
  if (detection.stack.length === 0) return "none detected";
  return detection.stack.map((item) => item.name).join(", ");
}

function commandSummary(command: SddProjectDetection["commands"]["test"]): string {
  return command?.command ?? "not detected";
}

function buildDetectionLines(detection: SddProjectDetection): string[] {
  return [
    `Detected project facts:`,
    `Project name: ${detection.projectName}`,
    `Detected at: ${detection.detectedAt}`,
    `Package managers: ${packageManagerSummary(detection)}`,
    `Stack: ${stackSummary(detection)}`,
    `Primary test command: ${commandSummary(detection.commands.test)}`,
    `Primary check command: ${commandSummary(detection.commands.check)}`,
    `Runtime verification command: ${commandSummary(detection.commands.runtimeVerify)}`,
    `Strict TDD: ${String(detection.strictTdd)}`,
    `Evidence: ${detection.evidence.length > 0 ? detection.evidence.join(", ") : "none detected"}`,
    `Rendered init artifact draft:`,
    ...renderSddInitMarkdown(detection).split("\n"),
  ];
}

/**
 * Builds a delegation message for a single SDD phase.
 *
 * The resulting message is injected into the main agent session, which is
 * expected to call the `subagent` tool with the parameters listed in the message.
 */
export function buildDelegationMessage(options: {
  phase: ArtifactPhase;
  changeName: string;
  project: string;
  cwd: string;
  dependencies: EngramObservation[];
  preflight?: SddPreflightState;
}): string {
  const info = phaseInfo(options.phase);
  const contract = contractForPhase(
    preflightFor({ project: options.project, cwd: options.cwd, preflight: options.preflight }),
    { change: options.changeName, phase: options.phase },
  );
  const topicKey = contract.engram.topicKey;
  const depText = buildDependencyText(options.dependencies);
  const depTopicKeyText = buildDependencyTopicKeyText(options.changeName, options.phase);

  const taskLines = [
    `    You are executing the SDD ${info.label} phase.`,
    `    Change: ${options.changeName}`,
    `    Project: ${options.project}`,
    `    Working directory: ${options.cwd}`,
    ...buildPersistenceContractLines(contract).map((line) => `    ${line}`),
    `    Target topic_key: ${topicKey}`,
    ``,
    `    Dependency artifacts (retrieve via mem_get_observation):`,
    ...depText.split("\n").map((l) => `    ${l}`),
    `    Required dependency topic keys:`,
    ...depTopicKeyText.split("\n").map((l) => `    ${l}`),
    ``,
    `    Instructions: Read and follow /home/iperez/.tabularium/AI/skills/${info.skill}/SKILL.md.`,
    `    Save agent memory to Engram with topic_key "${topicKey}" and project "${options.project}".`,
    `    Save the full human-readable artifact to the selected human backend only when the contract permits it; otherwise return partial and embed the full artifact in Engram if allowed.`,
  ];

  return [
    `[SDD] Execute ${options.phase} phase for change '${options.changeName}'.`,
    "",
    `Call the Agent tool with these parameters:`,
    `- subagent_type: "${info.skill}"`,
    `- prompt: |`,
    ...taskLines,
    "",
    `Do not respond with text before calling the tool. Execute immediately.`,
  ].join("\n");
}

export function buildInitDelegationMessage(options: {
  project: string;
  cwd: string;
  detection: SddProjectDetection;
  preflight?: SddPreflightState;
}): string {
  const contract = buildInitPersistenceContract(
    preflightFor({ project: options.project, cwd: options.cwd, preflight: options.preflight }),
    options.project,
  );
  const topicKey = contract.engram.topicKey;
  const taskLines = [
    `    Initialize SDD for project '${options.project}'.`,
    `    Working directory: ${options.cwd}`,
    ...buildPersistenceContractLines(contract).map((line) => `    ${line}`),
    `    Target topic_key: ${topicKey}`,
    ``,
    ...buildDetectionLines(options.detection).map((line) => `    ${line}`),
    ``,
    `    Instructions: Read and follow /home/iperez/.tabularium/AI/skills/sdd-init/SKILL.md.`,
    `    Persist using the init contract: Engram topic_key "${topicKey}" is mandatory and the Atlas logical path is "${contract.humanArtifact.logicalPath}" when Atlas writes are approved.`,
  ];

  return [
    `[SDD] Initialize project '${options.project}'.`,
    "",
    `Call the Agent tool with these parameters:`,
    `- subagent_type: "sdd-init"`,
    `- prompt: |`,
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
  preflight?: SddPreflightState;
}): string {
  const preflight = preflightFor({ project: options.project, cwd: options.cwd, preflight: options.preflight });
  const phaseBlocks = options.phases.map((phase, index) => {
    const info = phaseInfo(phase);
    const contract = contractForPhase(preflight, { change: options.changeName, phase });
    const topicKey = contract.engram.topicKey;

    // For the first phase, use pre-loaded deps. For later phases, the agent must
    // retrieve the artifact saved by the preceding subagent call.
    const deps = dependencyObservations(options.status, phase);
    const depText = buildDependencyText(deps);
    const depTopicKeyText = buildDependencyTopicKeyText(options.changeName, phase);

    const taskLines = [
      `      You are executing the SDD ${info.label} phase.`,
      `      Change: ${options.changeName}`,
      `      Project: ${options.project}`,
      `      Working directory: ${options.cwd}`,
      ...buildPersistenceContractLines(contract).map((line) => `      ${line}`),
      `      Target topic_key: ${topicKey}`,
      ``,
      `      Dependency artifacts (retrieve via mem_get_observation):`,
      ...depText.split("\n").map((l) => `      ${l}`),
      `      Required dependency topic keys:`,
      ...depTopicKeyText.split("\n").map((l) => `      ${l}`),
      ``,
      `      Instructions: Read and follow /home/iperez/.tabularium/AI/skills/${info.skill}/SKILL.md.`,
      `      Save agent memory to Engram with topic_key "${topicKey}" and project "${options.project}".`,
      `      Save the full human-readable artifact to the selected human backend only when the contract permits it; otherwise return partial and embed the full artifact in Engram if allowed.`,
    ];

    return [
      `Step ${index + 1}: ${info.label} (agent: "${info.skill}")`,
      `  Call the Agent tool with:`,
      `  - subagent_type: "${info.skill}"`,
      `  - prompt: |`,
      ...taskLines,
    ].join("\n");
  });

  return [
    `[SDD] Run change '${options.changeName}': execute ${options.phases.map((p) => phaseInfo(p).label).join(" → ")} phases sequentially.`,
    "",
    `Execute each step in order. Wait for each Agent call to complete before starting the next.`,
    `After each phase, the artifact is available in Engram under the target topic key; use the required dependency topic keys for the following phase.`,
    "",
    ...phaseBlocks,
    "",
    `Do not respond with text before calling the first Agent tool. Execute immediately.`,
  ].join("\n");
}

function buildTestingPersistenceContract(options: {
  project: string;
  projectSlug: string;
  featureSlug: string;
  phase: string;
  topicKey: string;
  atlasLogicalPath: string;
  sessionId?: string;
  unitId?: string;
  parentOwnsRunMerge?: boolean;
}): TestingPersistenceContract {
  const contract: TestingPersistenceContract = {
    contractName: "TestingPersistenceContract",
    version: 1,
    project: options.project,
    projectSlug: options.projectSlug,
    featureSlug: options.featureSlug,
    phase: options.phase,
    artifact: {
      topicKey: options.topicKey,
      atlasLogicalPath: options.atlasLogicalPath,
      sessionId: options.sessionId,
      unitId: options.unitId,
    },
    authorities: {
      agentOrchestratorSourceOfTruth: "engram",
      humanReadableDocumentationMirror: "atlas",
    },
    engram: {
      required: true,
      project: options.project,
      topicKey: options.topicKey,
      role: "source-of-truth-for-agents-and-orchestrator",
      write: options.phase === "run-testing" ? "run-shard-full-content-and-pointer" : "summary-pointer-and-recovery",
    },
    atlas: {
      backend: "atlas",
      logicalPath: options.atlasLogicalPath,
      role: "human-readable-documentation-mirror",
      approvalRequired: true,
      approvalState: "needs-approval",
      mutationPermitted: false,
      writeBehavior: "write-only-when-approved-and-available",
    },
    fallback: {
      ifEngramUnavailable: "blocked",
      ifAtlasUnavailableOrUnapproved: "save-allowed-engram-artifact-or-pointer-and-return-partial",
    },
  };

  if (options.parentOwnsRunMerge) contract.parentOwned = { runLatest: true, runSummary: true };
  return contract;
}

function buildTestingPersistenceContractLines(contract: TestingPersistenceContract): string[] {
  return [
    "TestingPersistenceContract JSON:",
    ...JSON.stringify(contract, null, 2).split("\n"),
    "Engram is the source of truth for agents/orchestrator recovery and phase progression.",
    "Atlas is a human-readable documentation mirror; write Atlas only after explicit approval and target availability.",
    "If Atlas is unavailable or unapproved, save the allowed Engram artifact/pointer and return partial. If Engram is unavailable, return blocked.",
  ];
}

function testingModeLines(prefix = ""): string[] {
  return [
    `${prefix}- Playwright/browser: keep cases visible; mark blocked/unsupported when package, browsers, target URL, setup, or auth is missing.`,
    `${prefix}- Backend: run only known safe project commands; block when no safe command or environment is known.`,
    `${prefix}- API: block when endpoint, auth, environment, or safe credentials are missing; never guess or expose secrets.`,
    `${prefix}- Live browser/no-code: preserve the real-session mode; mark unsupported when no Pi browser bridge/session capability exists.`,
    `${prefix}- Mobile/Maestro: mark unsupported/blocked when Maestro, device, app target, or write approval is missing.`,
    `${prefix}- Visual diff/visual-diff: keep visual cases visible; report partial/skipped when reference or capture capability is missing; pixel diff never gates pass/fail.`,
  ];
}

export function buildSddTestIntakeMessage(options: { featureName?: string; project: string; cwd: string }): string {
  const projectSlug = slugTestingName(options.project);
  const featureName = options.featureName?.trim();
  const featureSlug = featureName ? slugTestingName(featureName) : "feature-slug-after-intake";
  const featureLine = featureName
    ? `Feature: ${quotePromptValue(featureName)}\nFeature slug: ${featureSlug}`
    : "Feature: not provided. Run guided intake one question at a time before selecting feature_slug.";
  const exploreTopicKey = testingTopicKey({ projectSlug, featureSlug, phase: "explore" });
  const exploreLogicalPath = testingAtlasLogicalPath({ projectSlug, featureSlug, phase: "explore" });
  const contract = buildTestingPersistenceContract({
    project: options.project,
    projectSlug,
    featureSlug,
    phase: "explore-testing",
    topicKey: exploreTopicKey,
    atlasLogicalPath: exploreLogicalPath,
  });

  return [
    `[SDD Testing] Start testing intake for project ${quotePromptValue(options.project)}.`,
    "",
    featureLine,
    `Project slug: ${projectSlug}`,
    `Working directory: ${options.cwd}`,
    "",
    "This is the independent SDD-testing pipeline. Do not route development `/sdd-verify`, `/sdd-continue`, `/sdd-sync`, or `/sdd-archive` into testing.",
    "Follow this graph: /sdd-test -> intake -> sdd-explore-testing -> suites gate -> sdd-plan-testing -> sdd-run-testing shards -> parent merge/latest -> sdd-report-testing.",
    "The suites gate is mandatory: planning requires user-approved suites from conversation, existing testing suites, or test-suite-generator output.",
    "No-remediation rule: testing agents report findings and evidence; they must not fix product code.",
    "",
    "Testing artifact namespace:",
    `- Setup state: ${testingTopicKey({ projectSlug, phase: "setup-state" })} | ${testingAtlasLogicalPath({ projectSlug, phase: "setup-state" })}`,
    `- Suites: ${testingTopicKey({ projectSlug, featureSlug, phase: "suites" })} | ${testingAtlasLogicalPath({ projectSlug, featureSlug, phase: "suites" })}`,
    `- Explore: ${exploreTopicKey} | ${exploreLogicalPath}`,
    `- Plan: ${testingTopicKey({ projectSlug, featureSlug, phase: "plan" })} | ${testingAtlasLogicalPath({ projectSlug, featureSlug, phase: "plan" })}`,
    `- Run shard: testing/${projectSlug}/${featureSlug}/run/<session_id>/<unit_id> | testing/${projectSlug}/${featureSlug}/runs/<session_id>/<unit_id>.md`,
    `- Run summary: testing/${projectSlug}/${featureSlug}/run/<session_id> | testing/${projectSlug}/${featureSlug}/runs/<session_id>/summary.md`,
    `- Latest run: ${testingTopicKey({ projectSlug, featureSlug, phase: "run-latest" })} | ${testingAtlasLogicalPath({ projectSlug, featureSlug, phase: "run-latest" })}`,
    `- Report: ${testingTopicKey({ projectSlug, featureSlug, phase: "report" })} | ${testingAtlasLogicalPath({ projectSlug, featureSlug, phase: "report" })}`,
    "",
    ...buildTestingPersistenceContractLines(contract),
    "",
    "Modes and degraded behavior:",
    ...testingModeLines(),
    "",
    "If the feature is missing, ask the user one focused intake question at a time for feature, target surfaces, environments, credentials/setup constraints, desired suites, and mode priorities.",
    "When ready, launch `sdd-explore-testing` with the TestingPersistenceContract above for the `testing/.../explore` artifact. Engram is mandatory source-of-truth storage for agents/orchestrator; Atlas is the human-readable documentation mirror when approved.",
  ].join("\n");
}

function testingPhaseDependencyText(options: {
  phase: TestingDirectPhase;
  projectSlug: string;
  featureSlug: string;
  sessionId?: string;
  unitId?: string;
}): string[] {
  switch (options.phase) {
    case "explore-testing":
      return ["- Intake/feature scope from the current conversation or prior testing memories."];
    case "plan-testing":
      return [
        `- Requires approved suites and explore: ${testingTopicKey({ projectSlug: options.projectSlug, featureSlug: options.featureSlug, phase: "suites" })}`,
        `- Explore: ${testingTopicKey({ projectSlug: options.projectSlug, featureSlug: options.featureSlug, phase: "explore" })}`,
        "- Block at the suites gate if suites are missing or not user-approved.",
      ];
    case "run-testing":
      return [
        `- Requires plan and parent fan-out: ${testingTopicKey({ projectSlug: options.projectSlug, featureSlug: options.featureSlug, phase: "plan" })}`,
        `- Direct run assignment: session_id=${options.sessionId}, unit_id=${options.unitId}.`,
        `- Runner writes only ${testingTopicKey({ projectSlug: options.projectSlug, featureSlug: options.featureSlug, phase: "run", sessionId: options.sessionId, unitId: options.unitId })}.`,
        "- Runner must not write run/latest; parent merges shards and writes latest.",
      ];
    case "report-testing":
      return [
        `- Requires plan: ${testingTopicKey({ projectSlug: options.projectSlug, featureSlug: options.featureSlug, phase: "plan" })}`,
        `- Requires latest run: ${testingTopicKey({ projectSlug: options.projectSlug, featureSlug: options.featureSlug, phase: "run-latest" })}`,
      ];
  }
}

export function buildSddTestingPhaseMessage(options: {
  phase: TestingDirectPhase;
  featureName: string;
  project: string;
  cwd: string;
  sessionId?: string;
  unitId?: string;
}): string {
  if (options.phase === "run-testing" && (!options.sessionId || !options.unitId)) {
    throw new Error("sdd-run-testing requires explicit session_id and unit_id.");
  }

  const projectSlug = slugTestingName(options.project);
  const featureSlug = slugTestingName(options.featureName);
  const agent = TESTING_DIRECT_PHASE_TO_AGENT[options.phase];
  const artifactPhase = TESTING_DIRECT_PHASE_TO_ARTIFACT[options.phase];
  const topicKey = testingTopicKey({
    projectSlug,
    featureSlug,
    phase: artifactPhase,
    sessionId: options.sessionId,
    unitId: options.unitId,
  });
  const logicalPath = testingAtlasLogicalPath({
    projectSlug,
    featureSlug,
    phase: artifactPhase,
    sessionId: options.sessionId,
    unitId: options.unitId,
  });
  const contract = buildTestingPersistenceContract({
    project: options.project,
    projectSlug,
    featureSlug,
    phase: options.phase,
    topicKey,
    atlasLogicalPath: logicalPath,
    sessionId: options.sessionId,
    unitId: options.unitId,
    parentOwnsRunMerge: options.phase === "run-testing",
  });

  return [
    `[SDD Testing] Execute ${options.phase} for feature ${quotePromptValue(options.featureName)}.`,
    "",
    `Call the Agent tool with these parameters:`,
    `- subagent_type: "${agent}"`,
    `- prompt: |`,
    `    You are executing the SDD-testing ${options.phase} phase.`,
    `    Project: ${quotePromptValue(options.project)}`,
    `    Project slug: ${projectSlug}`,
    `    Feature: ${quotePromptValue(options.featureName)}`,
    `    Feature slug: ${featureSlug}`,
    `    Working directory: ${options.cwd}`,
    `    Target topic_key: ${topicKey}`,
    `    Atlas logical path: ${logicalPath}`,
    `    Engram topic namespace: testing/${projectSlug}/${featureSlug}`,
    ``,
    ...buildTestingPersistenceContractLines(contract).map((line) => `    ${line}`),
    ``,
    `    Dependency requirements:`,
    ...testingPhaseDependencyText({
      phase: options.phase,
      projectSlug,
      featureSlug,
      sessionId: options.sessionId,
      unitId: options.unitId,
    }).map((line) => `    ${line}`),
    ``,
    `    Modes and degraded behavior to preserve:`,
    ...testingModeLines("    "),
    ``,
    `    No-remediation rule: record findings, blocked/unsupported modes, evidence, severity, and follow-up recommendations; do not fix product code.`,
    `    Development SDD commands and artifacts under sdd/... are out of scope for this testing phase.`,
    "",
    `Do not respond with text before calling the tool. Execute immediately.`,
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

        const detection = await detectSddProject({ cwd: ctx.cwd, projectName: project });
        const message = buildInitDelegationMessage({ project, cwd: ctx.cwd, detection });

        await pi.sendUserMessage(message, { deliverAs: "followUp" });
      } catch (error: any) {
        report(pi, ctx, `SDD init failed: ${project}`, error.message || String(error));
      }
    },
  });

  pi.registerCommand("sdd-test", {
    description: "Start the independent SDD-testing intake flow. Usage: /sdd-test [feature]",
    async handler(args, ctx) {
      await ctx.waitForIdle();
      const project = defaultProject(ctx.cwd);
      const message = buildSddTestIntakeMessage({ featureName: args.trim() || undefined, project, cwd: ctx.cwd });
      await pi.sendUserMessage(message, { deliverAs: "followUp" });
    },
  });

  pi.registerCommand("sdd-test-status", {
    description: "Show independent SDD-testing artifact status from Engram. Usage: /sdd-test-status [feature]",
    async handler(args, ctx) {
      await ctx.waitForIdle();
      const project = defaultProject(ctx.cwd);

      try {
        const data = await loadExport();
        const resolved = resolveSddTestingStatus({
          data,
          project,
          featureName: args.trim() || undefined,
        });
        report(pi, ctx, `SDD testing status: ${resolved.featureSlug ?? "intake"}`, formatTestingStatus(resolved));
      } catch (error: any) {
        report(pi, ctx, "SDD testing status failed", error.message || String(error));
      }
    },
  });

  for (const phase of ["explore-testing", "plan-testing", "run-testing", "report-testing"] as TestingDirectPhase[]) {
    const commandName = `sdd-${phase}`;
    const usage = phase === "run-testing"
      ? `Usage: /${commandName} <feature> <session_id> <unit_id>`
      : `Usage: /${commandName} <feature>`;
    pi.registerCommand(commandName, {
      description: `Execute the SDD-testing ${phase} phase. ${usage}`,
      async handler(args, ctx) {
        await ctx.waitForIdle();
        let featureName = args.trim();
        let sessionId: string | undefined;
        let unitId: string | undefined;

        if (phase === "run-testing") {
          const parsed = parseSddRunTestingArgs(args);
          if (!parsed.ok) {
            ctx.ui.notify(parsed.error, "error");
            return;
          }
          featureName = parsed.featureName;
          sessionId = parsed.sessionId;
          unitId = parsed.unitId;
        } else if (!featureName) {
          ctx.ui.notify(usage, "error");
          return;
        }

        const project = defaultProject(ctx.cwd);
        const message = buildSddTestingPhaseMessage({ phase, featureName, project, cwd: ctx.cwd, sessionId, unitId });
        await pi.sendUserMessage(message, { deliverAs: "followUp" });
      },
    });
  }

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
        const resolved = resolveSddStatus({ data, project, changeName: args.trim() });

        if (!resolved.changeName) {
          report(pi, ctx, "SDD continue failed", "No SDD change could be inferred. Pass a change name explicitly.");
          return;
        }

        if (!resolved.nextPhase) {
          report(pi, ctx, `SDD continue: ${resolved.changeName}`, "All known SDD phases already have artifacts.");
          return;
        }

        const message = buildDelegationMessage({
          phase: resolved.nextPhase,
          changeName: resolved.changeName,
          project,
          cwd: ctx.cwd,
          dependencies: resolved.dependencies,
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
        const resolved = resolveSddStatus({ data, project, changeName: args.trim() });

        if (!resolved.changeName) {
          report(pi, ctx, "SDD status", "No SDD change found for this project.");
          return;
        }

        report(pi, ctx, `SDD status: ${resolved.changeName}`, formatStatus(resolved.changeName, resolved.status));
      } catch (error: any) {
        report(pi, ctx, "SDD status failed", error.message || String(error));
      }
    },
  });
}
