#!/usr/bin/env node
/**
 * Fast pre-flight for required paths and the global ownership boundary. It
 * cannot catch an extension that loads cleanly but fails to register commands
 * or tools. tests/runtime/extension-load.test.ts loads the real extension set
 * through Pi's discoverAndLoadExtensions() and remains the authoritative gate.
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
  { path: "scripts/dev-pi.sh", kind: "file" },
  { path: "assets", kind: "dir" },
  { path: "assets/agents", kind: "dir" },
  { path: "assets/chains", kind: "dir" },
  { path: "assets/support", kind: "dir" },
  { path: "assets/orchestrator.md", kind: "file" },
  { path: "assets/agents/sdd-verify.md", kind: "file" },
  { path: "assets/agents/sdd-sync.md", kind: "file" },
  { path: "assets/agents/sdd-archive.md", kind: "file" },
  { path: "assets/agents/sdd-onboard.md", kind: "file" },
  { path: "assets/support/sdd-status-contract.md", kind: "file" },
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
  { path: "vendor", kind: "dir" },
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
const HOME_MANAGER_OWNER_RESOURCE = /"\.pi\/agent\/\.pi-harness-owner"\.text\s*=\s*"schema=1\\nowner=home-manager\\nscope=global\\n";/;

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

function readExistingFile(root, relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath) || pathKind(absolutePath) !== "file") return undefined;
  return readFileSync(absolutePath, "utf8");
}

export function findOwnershipContractViolations(root = DEFAULT_ROOT) {
  const violations = [];
  const homeModule = readExistingFile(root, "nix/home-module.nix");
  const linkScript = readExistingFile(root, "scripts/link.sh");
  const devPiScript = readExistingFile(root, "scripts/dev-pi.sh");

  if (homeModule !== undefined && !HOME_MANAGER_OWNER_RESOURCE.test(homeModule)) {
    violations.push({
      path: "nix/home-module.nix",
      code: "missing-home-manager-owner-resource",
      message: "Home Manager must publish the exact global ownership marker",
    });
  }

  if (linkScript !== undefined) {
    const agentRoot = linkScript.indexOf('PI_AGENT="${HOME}/.pi/agent"');
    const marker = linkScript.indexOf('OWNER_MARKER="${PI_AGENT}/.pi-harness-owner"');
    const guard = linkScript.indexOf('if [ -e "$OWNER_MARKER" ] || [ -L "$OWNER_MARKER" ]; then');
    const firstMutationSurface = linkScript.indexOf("configure_atlas_mcp()");
    const hasExactMarker = linkScript.includes("schema=1\\nowner=home-manager\\nscope=global\\n");
    const hasGuidance = linkScript.includes("managed by Home Manager") && linkScript.includes("scripts/dev-pi.sh");
    const failsClosed = linkScript.includes("refusing to mutate") && linkScript.includes("unreadable, malformed, unknown, or broken");

    if (
      agentRoot < 0 ||
      marker <= agentRoot ||
      guard <= marker ||
      firstMutationSurface <= guard ||
      !hasExactMarker ||
      !hasGuidance ||
      !failsClosed
    ) {
      violations.push({
        path: "scripts/link.sh",
        code: "missing-link-ownership-guard",
        message: "Legacy linking must refuse managed or invalid ownership before mutation",
      });
    }
  }

  if (devPiScript !== undefined) {
    if (devPiScript.includes(".pi-harness-owner")) {
      violations.push({
        path: "scripts/dev-pi.sh",
        code: "global-owner-marker-in-dev-runtime",
        message: "The repository-development runtime must not inspect the global ownership marker",
      });
    } else if (
      !devPiScript.includes('AGENT_DIR="$ROOT/agent"') ||
      !devPiScript.includes('DEV_HOME="$ROOT/home"') ||
      !devPiScript.includes('PI_CODING_AGENT_DIR="$AGENT_DIR" HOME="$DEV_HOME" "$PI_COMMAND" "$@"')
    ) {
      violations.push({
        path: "scripts/dev-pi.sh",
        code: "missing-dev-runtime-isolation",
        message: "The repository-development runtime must use isolated agent and HOME roots",
      });
    }
  }

  return violations;
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
    ownershipContractViolations: findOwnershipContractViolations(root),
    providerSpecificReferences: findProviderSpecificMcpReferences(root),
  };
}

function runCli() {
  const result = verifyRuntimeSurface();

  if (
    result.missing.length > 0 ||
    result.ownershipContractViolations.length > 0 ||
    result.providerSpecificReferences.length > 0
  ) {
    if (result.missing.length > 0) {
      console.error("pi-harness runtime surface is incomplete:");
      for (const entry of result.missing) {
        console.error(`- ${entry.path} (${entry.kind})`);
      }
    }

    if (result.ownershipContractViolations.length > 0) {
      console.error("pi-harness runtime ownership contract is invalid:");
      for (const violation of result.ownershipContractViolations) {
        console.error(`- ${violation.path}: ${violation.message}`);
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
