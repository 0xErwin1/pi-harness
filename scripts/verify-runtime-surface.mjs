#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
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
  { path: "extensions", kind: "dir" },
  { path: "extensions/harness.ts", kind: "file" },
  { path: "extensions/shell-guard.ts", kind: "file" },
  { path: "extensions/mcp.ts", kind: "file" },
  { path: "extensions/engram.ts", kind: "file" },
  { path: "extensions/sdd-orchestrator.ts", kind: "file" },
  { path: "extensions/skill-registry.ts", kind: "file" },
  { path: "packages", kind: "dir" },
  { path: "packages/icons/index.ts", kind: "file" },
  { path: "packages/prompt-stash/index.ts", kind: "file" },
  { path: "packages/shared/overlay-gate.ts", kind: "file" },
  { path: "packages/statusbar/index.ts", kind: "file" },
  { path: "packages/subagents-compat/index.ts", kind: "file" },
  { path: "vendor", kind: "dir" },
  { path: "vendor/pi-subagents", kind: "dir" },
  { path: "vendor/pi-subagents/j0k3r/index.ts", kind: "file" },
  { path: "vendor/pi-tool-renderer", kind: "dir" },
  { path: "vendor/pi-tool-renderer/extensions/tool-renderer.ts", kind: "file" },
];

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
  };
}

function runCli() {
  const result = verifyRuntimeSurface();

  if (result.missing.length > 0) {
    console.error("pi-harness runtime surface is incomplete:");
    for (const entry of result.missing) {
      console.error(`- ${entry.path} (${entry.kind})`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`pi-harness runtime surface verified (${result.checked.length} entries).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
