/**
 * Engram Memory Extension for Pi
 *
 * Wraps the `engram` CLI as custom tools. Where the CLI exposes exact
 * semantics directly, the wrappers use them. Where it does not (for example
 * exact observation lookup by ID), the wrappers fall back to parsing the JSON
 * export instead of pretending a fuzzy search is exact.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(execFile);
const ENGRAM = "engram";

interface EngramSession {
  id: string;
  project: string;
  directory?: string;
  started_at: string;
}

interface EngramObservation {
  id: number;
  session_id?: string;
  type: string;
  title: string;
  content: string;
  project: string;
  scope?: string;
  topic_key?: string;
  created_at: string;
  updated_at?: string;
}

interface EngramPrompt {
  id: number;
  session_id?: string;
  content: string;
  project: string;
  created_at: string;
}

interface EngramExportData {
  version: string;
  exported_at: string;
  sessions: EngramSession[];
  observations: EngramObservation[];
  prompts: EngramPrompt[];
}

function engram(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execAsync(ENGRAM, args, { maxBuffer: 10 * 1024 * 1024 });
}

function toProject(paramsProject?: string, ctxCwd?: string): string | undefined {
  if (paramsProject?.trim()) return paramsProject.trim();

  if (!ctxCwd) return undefined;

  const parts = ctxCwd.split("/").filter(Boolean);
  return parts.at(-1);
}

function formatObservation(observation: EngramObservation): string {
  const lines = [
    `#${observation.id} — ${observation.title}`,
    `Type: ${observation.type}`,
    `Project: ${observation.project}`,
  ];

  if (observation.scope) lines.push(`Scope: ${observation.scope}`);
  if (observation.topic_key) lines.push(`Topic Key: ${observation.topic_key}`);
  if (observation.session_id) lines.push(`Session ID: ${observation.session_id}`);
  lines.push(`Created: ${observation.created_at}`);
  lines.push("");
  lines.push(observation.content);

  return lines.join("\n");
}

async function loadExport(): Promise<EngramExportData> {
  const filePath = join(tmpdir(), `engram-export-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  try {
    await engram("export", filePath);
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as EngramExportData;
  } finally {
    await unlink(filePath).catch(() => {});
  }
}

function filterObservations(data: EngramExportData, options: { project?: string; scope?: string; type?: string }) {
  return data.observations.filter((observation) => {
    if (options.project && observation.project !== options.project) return false;
    if (options.scope && observation.scope !== options.scope) return false;
    if (options.type && observation.type !== options.type) return false;
    return true;
  });
}

function recentSessions(data: EngramExportData, project?: string, limit = 5): EngramSession[] {
  return data.sessions
    .filter((session) => !project || session.project === project)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, limit);
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "mem_save",
    label: "Memory Save",
    description:
      "Save an important observation to persistent memory. Use for decisions, bug fixes, patterns, config changes, and important discoveries.",
    promptSnippet: "Save observation to persistent memory (engram)",
    promptGuidelines: [
      "Save important discoveries, decisions, and bug fixes proactively.",
      "Prefer structured content with **What**, **Why**, **Where**, and **Learned** sections.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Short searchable title" }),
      content: Type.String({ description: "Observation body" }),
      type: Type.Optional(Type.String({ description: "Category: decision, architecture, bugfix, pattern, config, discovery, learning, manual", default: "manual" })),
      project: Type.Optional(Type.String({ description: "Project name" })),
      scope: Type.Optional(Type.String({ description: "Scope: project or personal", default: "project" })),
      topic_key: Type.Optional(Type.String({ description: "Stable topic key for upserts" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const project = toProject(params.project, ctx.cwd);
      const args = ["save", params.title, params.content];

      if (params.type) args.push("--type", params.type);
      if (project) args.push("--project", project);
      if (params.scope) args.push("--scope", params.scope);
      if (params.topic_key) args.push("--topic", params.topic_key);

      const { stdout } = await engram(...args);

      return {
        content: [{ type: "text", text: stdout.trim() || `Saved: ${params.title}` }],
        details: { title: params.title, project, topic_key: params.topic_key },
      };
    },
  });

  pi.registerTool({
    name: "mem_search",
    label: "Memory Search",
    description:
      "Search persistent memory across sessions. Use it to find previous decisions, bug fixes, patterns, and prior task context.",
    promptSnippet: "Search persistent memory for prior context",
    parameters: Type.Object({
      query: Type.String({ description: "Natural language or keyword search query" }),
      project: Type.Optional(Type.String({ description: "Filter by project name" })),
      type: Type.Optional(Type.String({ description: "Filter by type" })),
      scope: Type.Optional(Type.String({ description: "Filter by scope" })),
      limit: Type.Optional(Type.Number({ description: "Max results (default 10)", default: 10 })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const project = toProject(params.project, ctx.cwd);
      const args = ["search", params.query];

      if (params.type) args.push("--type", params.type);
      if (project) args.push("--project", project);
      if (params.scope) args.push("--scope", params.scope);
      if (params.limit) args.push("--limit", String(params.limit));

      const { stdout } = await engram(...args);

      return {
        content: [{ type: "text", text: stdout.trim() || "No memories found." }],
        details: { query: params.query, project },
      };
    },
  });

  pi.registerTool({
    name: "mem_get_observation",
    label: "Memory Get Observation",
    description:
      "Get the full content of a specific observation by ID. This uses Engram's JSON export for exact lookup instead of fuzzy search.",
    parameters: Type.Object({
      id: Type.Number({ description: "Observation ID to retrieve" }),
    }),
    async execute(_id, params) {
      const data = await loadExport();
      const observation = data.observations.find((item) => item.id === params.id);

      if (!observation) {
        const details: { id: number; found: boolean; topic_key?: string; session_id?: string } = {
          id: params.id,
          found: false,
        };
        return {
          content: [{ type: "text", text: `Observation #${params.id} not found.` }],
          details,
        };
      }

      return {
        content: [{ type: "text", text: formatObservation(observation) }],
        details: { id: params.id, found: true, topic_key: observation.topic_key, session_id: observation.session_id },
      };
    },
  });

  pi.registerTool({
    name: "mem_context",
    label: "Memory Context",
    description:
      "Get recent memory context from previous sessions. This wrapper builds context from Engram's export so project and limit filters actually work.",
    parameters: Type.Object({
      project: Type.Optional(Type.String({ description: "Filter by project" })),
      limit: Type.Optional(Type.Number({ description: "Number of recent observations to include (default 20)", default: 20 })),
      scope: Type.Optional(Type.String({ description: "Filter observations by scope" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const project = toProject(params.project, ctx.cwd);
      const data = await loadExport();
      const limit = params.limit || 20;

      const sessions = recentSessions(data, project, 5);
      const observations = filterObservations(data, { project, scope: params.scope })
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit);

      if (sessions.length === 0 && observations.length === 0) {
        return {
          content: [{ type: "text", text: "No previous context found." }],
          details: { project, count: 0 },
        };
      }

      const sessionLines = sessions.length === 0
        ? ["### Recent Sessions", "- None found"]
        : [
            "### Recent Sessions",
            ...sessions.map((session) => `- ${session.project} — ${session.started_at}${session.directory ? ` (${session.directory})` : ""}`),
          ];

      const observationLines = observations.length === 0
        ? ["### Recent Observations", "- None found"]
        : [
            "### Recent Observations",
            ...observations.map((observation) => `- #${observation.id} [${observation.type}] ${observation.title} — ${observation.created_at}`),
          ];

      return {
        content: [{ type: "text", text: ["## Memory Context", ...sessionLines, "", ...observationLines].join("\n") }],
        details: { project, observation_count: observations.length, session_count: sessions.length },
      };
    },
  });

  pi.registerTool({
    name: "mem_timeline",
    label: "Memory Timeline",
    description:
      "Show chronological context around a specific observation using Engram's timeline command.",
    parameters: Type.Object({
      observation_id: Type.Number({ description: "Observation ID to center on" }),
      before: Type.Optional(Type.Number({ description: "Observations before (default 5)", default: 5 })),
      after: Type.Optional(Type.Number({ description: "Observations after (default 5)", default: 5 })),
    }),
    async execute(_id, params) {
      const args = ["timeline", String(params.observation_id)];
      if (params.before != null) args.push("--before", String(params.before));
      if (params.after != null) args.push("--after", String(params.after));

      const { stdout } = await engram(...args);

      return {
        content: [{ type: "text", text: stdout.trim() || "No timeline found." }],
        details: { observation_id: params.observation_id },
      };
    },
  });

  pi.registerTool({
    name: "mem_session_summary",
    label: "Memory Session Summary",
    description:
      "Save an end-of-session summary. Engram's CLI does not expose a dedicated session-summary API, so this stores a normal observation tagged with the session topic key.",
    parameters: Type.Object({
      content: Type.String({ description: "Full session summary in Goal/Instructions/Discoveries/Accomplished/Files format" }),
      project: Type.String({ description: "Project name" }),
      session_id: Type.Optional(Type.String({ description: "Session identifier" })),
    }),
    async execute(_id, params) {
      const topicKey = params.session_id ? `session/${params.session_id}/summary` : undefined;
      const title = params.session_id ? `Session Summary: ${params.session_id}` : "Session Summary";
      const args = ["save", title, params.content, "--type", "manual", "--project", params.project];
      if (topicKey) args.push("--topic", topicKey);

      const { stdout } = await engram(...args);

      return {
        content: [{ type: "text", text: stdout.trim() || "Session summary saved." }],
        details: { project: params.project, session_id: params.session_id, topic_key: topicKey, emulated_session_tracking: true },
      };
    },
  });

  pi.registerTool({
    name: "mem_stats",
    label: "Memory Stats",
    description: "Show memory system statistics — total sessions, observations, and tracked projects.",
    parameters: Type.Object({}),
    async execute() {
      const { stdout } = await engram("stats");
      return {
        content: [{ type: "text", text: stdout.trim() }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "mem_delete",
    label: "Memory Delete",
    description:
      "Delete an observation by ID. Engram's public CLI does not expose delete, so this wrapper only explains the limitation instead of pretending it deleted anything.",
    parameters: Type.Object({
      id: Type.Number({ description: "Observation ID to delete" }),
      hard_delete: Type.Optional(Type.Boolean({ description: "Ignored: CLI delete is not available", default: false })),
    }),
    async execute(_id, params) {
      return {
        content: [{ type: "text", text: `Engram CLI does not expose delete. Observation #${params.id} was not deleted. Use Engram's MCP/admin path or TUI if deletion is required.` }],
        details: { id: params.id, deleted: false },
      };
    },
  });

  pi.registerTool({
    name: "mem_suggest_topic_key",
    label: "Memory Suggest Topic Key",
    description: "Suggest a stable topic_key for memory upserts based on title and type.",
    parameters: Type.Object({
      title: Type.Optional(Type.String({ description: "Observation title" })),
      type: Type.Optional(Type.String({ description: "Observation category" })),
    }),
    async execute(_id, params) {
      const title = params.title || "";
      const type = params.type || "manual";
      const key = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 64);

      const topicKey = key ? `${type}/${key}` : undefined;

      return {
        content: [{ type: "text", text: topicKey ? `Suggested topic_key: ${topicKey}` : "Provide a title to generate a topic key." }],
        details: { topic_key: topicKey },
      };
    },
  });

  pi.registerTool({
    name: "mem_session_start",
    label: "Memory Session Start",
    description:
      "Record the start of a coding session. Engram's CLI does not expose session-start registration, so this wrapper stores a tagged observation keyed by session ID.",
    parameters: Type.Object({
      id: Type.String({ description: "Unique session identifier" }),
      project: Type.String({ description: "Project name" }),
      directory: Type.Optional(Type.String({ description: "Working directory" })),
    }),
    async execute(_id, params) {
      const topicKey = `session/${params.id}/start`;
      const content = [
        `**What**: Started coding session ${params.id}`,
        `**Why**: Register the start of work for later recovery and summaries`,
        `**Where**: ${params.directory || "unknown"}`,
      ].join("\n");

      const { stdout } = await engram(
        "save",
        `Session Start: ${params.id}`,
        content,
        "--type",
        "manual",
        "--project",
        params.project,
        "--topic",
        topicKey,
      );

      return {
        content: [{ type: "text", text: stdout.trim() || `Session ${params.id} recorded.` }],
        details: { session_id: params.id, project: params.project, topic_key: topicKey, emulated_session_tracking: true },
      };
    },
  });

  pi.registerTool({
    name: "mem_save_prompt",
    label: "Memory Save Prompt",
    description:
      "Save a user prompt to persistent memory. Engram's CLI does not expose a prompt-specific write API, so this stores a manual observation with a prompt topic key.",
    parameters: Type.Object({
      content: Type.String({ description: "The user prompt text" }),
      project: Type.Optional(Type.String({ description: "Project name" })),
      session_id: Type.Optional(Type.String({ description: "Optional session identifier for grouping prompts" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const project = toProject(params.project, ctx.cwd);
      const topicKey = params.session_id ? `session/${params.session_id}/prompt` : undefined;
      const args = ["save", "User Prompt", params.content, "--type", "manual"];

      if (project) args.push("--project", project);
      if (topicKey) args.push("--topic", topicKey);

      const { stdout } = await engram(...args);

      return {
        content: [{ type: "text", text: stdout.trim() || "Prompt saved." }],
        details: { project, session_id: params.session_id, topic_key: topicKey, emulated_prompt_tracking: true },
      };
    },
  });
}
