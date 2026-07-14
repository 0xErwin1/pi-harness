#!/usr/bin/env node
/**
 * Fast pre-flight only: this checks that required files/dirs exist by path,
 * nothing more. It cannot catch an extension that loads cleanly but fails to
 * register its commands or tools. tests/runtime/extension-load.test.ts, which
 * loads the real extension set through pi's own discoverAndLoadExtensions()
 * and asserts the registered surface, is the authoritative gate.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ROOT = fileURLToPath(new URL("..", import.meta.url));

export const REQUIRED_RUNTIME_SURFACE = [
  { path: "README.md", kind: "file" },
  { path: "package.json", kind: "file" },
  { path: "tsconfig.json", kind: "file" },
  { path: "flake.nix", kind: "file" },
  { path: "flake.lock", kind: "file" },
  { path: "lib/default.nix", kind: "file" },
  { path: "nix/home-module.nix", kind: "file" },
  { path: "nix/nixos-module.nix", kind: "file" },
  { path: "scripts/link.sh", kind: "file" },
  { path: "assets", kind: "dir" },
  { path: "assets/agents", kind: "dir" },
  { path: "assets/chains", kind: "dir" },
  { path: "assets/support", kind: "dir" },
  { path: "assets/orchestrator.md", kind: "file" },
  { path: "assets/agents/sdd-explore-testing.md", kind: "file" },
  { path: "assets/agents/sdd-plan-testing.md", kind: "file" },
  { path: "assets/agents/sdd-run-testing.md", kind: "file" },
  { path: "assets/agents/sdd-report-testing.md", kind: "file" },
  { path: "assets/support/setup-testing.md", kind: "file" },
  { path: "assets/support/sdd-testing-context.md", kind: "file" },
  { path: "assets/support/visual-diff.md", kind: "file" },
  { path: "extensions", kind: "dir" },
  { path: "extensions/harness.ts", kind: "file" },
  { path: "extensions/shell-guard.ts", kind: "file" },
  { path: "extensions/mcp.ts", kind: "file" },
  { path: "extensions/engram.ts", kind: "file" },
  { path: "extensions/sdd-orchestrator.ts", kind: "file" },
  { path: "extensions/skill-registry.ts", kind: "file" },
  { path: "extensions/btw.ts", kind: "file" },
  { path: "packages", kind: "dir" },
  { path: "packages/icons/index.ts", kind: "file" },
  { path: "packages/prompt-stash/index.ts", kind: "file" },
  { path: "packages/shared/overlay-gate.ts", kind: "file" },
  { path: "packages/statusbar/index.ts", kind: "file" },
  { path: "packages/subagents-compat/index.ts", kind: "file" },
  { path: "vendor", kind: "dir" },
  { path: "vendor/pi-subagents", kind: "dir" },
  { path: "vendor/pi-subagents/src/index.ts", kind: "file" },
  { path: "vendor/pi-ask-user", kind: "dir" },
  { path: "vendor/pi-ask-user/index.ts", kind: "file" },
  { path: "vendor/pi-ask-user/upstream.ts", kind: "file" },
  { path: "vendor/pi-ask-user/single-select-layout.ts", kind: "file" },
  { path: "vendor/pi-ask-user/package.json", kind: "file" },
  { path: "vendor/pi-ask-user/LICENSE", kind: "file" },
  { path: "vendor/pi-ask-user/README.md", kind: "file" },
  { path: "vendor/pi-ask-user/skills/ask-user/SKILL.md", kind: "file" },
  { path: "vendor/pi-tool-renderer", kind: "dir" },
  { path: "vendor/pi-tool-renderer/extensions/tool-renderer.ts", kind: "file" },
];

const PROVIDER_NEUTRAL_TESTING_ASSET_PATHS = [
  "assets/agents/sdd-explore-testing.md",
  "assets/agents/sdd-plan-testing.md",
  "assets/agents/sdd-run-testing.md",
  "assets/agents/sdd-report-testing.md",
  "assets/support/setup-testing.md",
  "assets/support/sdd-testing-context.md",
  "assets/support/visual-diff.md",
];

const PROVIDER_SPECIFIC_MCP_NAME = /\bmcp__[A-Za-z0-9_]+\b/g;

function pathKind(path) {
  try {
    const stat = statSync(path);
    if (stat.isDirectory()) return "dir";
    if (stat.isFile()) return "file";
    return "missing";
  } catch {
    return "missing";
  }
}

export function findProviderSpecificMcpReferences(root = DEFAULT_ROOT) {
  const references = [];

  for (const relativePath of PROVIDER_NEUTRAL_TESTING_ASSET_PATHS) {
    const absolutePath = join(root, relativePath);
    if (!existsSync(absolutePath) || pathKind(absolutePath) !== "file") continue;

    const content = readFileSync(absolutePath, "utf8");
    const matches = content.match(PROVIDER_SPECIFIC_MCP_NAME) ?? [];
    for (const match of matches) {
      references.push({ path: relativePath, match });
    }
  }

  return references;
}

export function verifyRuntimeSurface(root = DEFAULT_ROOT) {
  const missing = [];

  for (const entry of REQUIRED_RUNTIME_SURFACE) {
    const absolutePath = join(root, entry.path);
    if (!existsSync(absolutePath) || pathKind(absolutePath) !== entry.kind) {
      missing.push(entry);
    }
  }

  return {
    root,
    checked: REQUIRED_RUNTIME_SURFACE,
    missing,
    providerSpecificReferences: findProviderSpecificMcpReferences(root),
  };
}

function runCli() {
  const result = verifyRuntimeSurface();

  if (result.missing.length > 0 || result.providerSpecificReferences.length > 0) {
    if (result.missing.length > 0) {
      console.error("pi-harness runtime surface is incomplete:");
      for (const entry of result.missing) {
        console.error(`- ${entry.path} (${entry.kind})`);
      }
    }

    if (result.providerSpecificReferences.length > 0) {
      console.error("pi-harness runtime surface contains provider-specific MCP tool names:");
      for (const reference of result.providerSpecificReferences) {
        console.error(`- ${reference.path}: ${reference.match}`);
      }
    }

    process.exitCode = 1;
    return;
  }

  console.log(`pi-harness runtime surface verified (${result.checked.length} entries).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
