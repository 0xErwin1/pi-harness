import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const nixEnv = {
	...process.env,
	NIX_CONFIG: [
		process.env.NIX_CONFIG,
		"extra-experimental-features = nix-command flakes",
	]
		.filter(Boolean)
		.join("\n"),
};

function nixJson(args: string[]): unknown {
	const output = execFileSync("nix", args, {
		cwd: repoRoot,
		env: nixEnv,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return JSON.parse(output);
}

function moduleEval(
	packagesSetting = `packages = [
		              "npm:unrelated-package@2.0.0"
		              "npm:pi-subagents-j0k3r@1.4.4"
		              "npm:pi-subagents-j0k3r@1.4.4"
		            ];`,
): any {
	const expression = `
		let
		  flake = builtins.getFlake "path:${repoRoot}";
		  pkgs = import flake.inputs.nixpkgs { system = "x86_64-linux"; };
		  evaluated = pkgs.lib.evalModules {
		    specialArgs = { inherit pkgs; };
		    modules = [
		      ({ lib, ... }: {
		        options.home = {
		          packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
		          file = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
		          activation = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
		          homeDirectory = lib.mkOption { type = lib.types.str; default = "/home/tester"; };
		        };
		      })
		      flake.homeModules.default
		      ({ pkgs, ... }: {
		        programs.pi.coding-agent = {
		          enable = true;
		          package = null;
		          settings = {
		            harness.source = "pi-harness";
		            model = "sonnet";
		            ${packagesSetting}
		          };
		          models = {
		            default = "sonnet";
		            providers.anthropic.displayName = "Anthropic";
		          };
		          environment.AI_HARNESS_MCP_ENV_FILE = "/home/tester/.config/ai-harness/secrets/mcp.env";
		          resources = [
		            {
		              source = flake.assets.orchestrator;
		              target = ".local/share/pi-harness/assets/orchestrator.md";
		            }
		            {
		              source = flake.assets.extensions;
		              target = ".pi/agent/extensions";
		              recursive = true;
		            }
		          ];
		          extensions = [ flake.assets.extensions ];
		          extraArgs = [ "--model" "sonnet" ];
		          wrapper = {
		            enable = true;
		            target = ".local/bin/pi-harness-pi";
		            command = "\${pkgs.hello}/bin/hello";
		          };
		        };
		      })
		    ];
		  };
		  activation = evaluated.config.home.activation.piCodingAgentMutableConfig;
		  activationText = if builtins.isAttrs activation && activation ? data then activation.data else activation;
		in {
		  optionKeys = builtins.attrNames evaluated.options.programs.pi.coding-agent;
		  homeFileKeys = builtins.attrNames evaluated.config.home.file;
		  activationText = activationText;
		  managedResourceForce = evaluated.config.home.file.".local/share/pi-harness/assets/orchestrator.md".force;
		  managedExtensionsForce = evaluated.config.home.file.".pi/agent/extensions".force;
		  managedExtensionsRecursive = evaluated.config.home.file.".pi/agent/extensions".recursive;
		  piToolRendererExtensionForce = evaluated.config.home.file.".pi/agent/extensions/pi-tool-renderer.ts".force;
		  piAskUserExtensionForce = evaluated.config.home.file.".pi/agent/extensions/pi-ask-user.ts".force;
		  piAskUserExtensionText = evaluated.config.home.file.".pi/agent/extensions/pi-ask-user.ts".text;
		  wrapperText = evaluated.config.home.file.".local/bin/pi-harness-pi".text;
		  wrapperExecutable = evaluated.config.home.file.".local/bin/pi-harness-pi".executable;
		}
	`;
	return nixJson(["eval", "--json", "--impure", "--no-write-lock-file", "--expr", expression]);
}

test("Pi mutable activation preserves local fields while applying generated settings and models", () => {
	const result = moduleEval();
	assert.ok(result.optionKeys.includes("models"));
	assert.ok(result.optionKeys.includes("theme"));
	assert.ok(result.optionKeys.includes("wrapper"));
	assert.ok(!result.homeFileKeys.includes(".pi/agent/extensions/pi-subagents.ts"));
	assert.ok(result.homeFileKeys.includes(".pi/agent/themes/ayu-dark.json"));
	assert.ok(result.homeFileKeys.includes(".pi/agent/themes/ayu-light.json"));
	assert.ok(result.homeFileKeys.includes(".pi/agent/extensions/pi-tool-renderer.ts"));
	assert.ok(result.homeFileKeys.includes(".pi/agent/extensions/pi-ask-user.ts"));
	assert.equal(result.managedResourceForce, true);
	assert.equal(result.managedExtensionsForce, true);
	assert.equal(result.managedExtensionsRecursive, true);
	assert.equal(result.piToolRendererExtensionForce, true);
	assert.equal(result.piAskUserExtensionForce, true);
	assert.match(result.piAskUserExtensionText, /vendor\/pi-ask-user\/index\.ts/);
	assert.ok(!result.homeFileKeys.includes(".pi/agent/settings.nix-generated.json"));
	assert.match(result.activationText, /if \[ -L "\$target" \]; then/);
	const home = mkdtempSync(join(tmpdir(), "pi-harness-home-"));
	const agentDir = join(home, ".pi", "agent");
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "settings.json"),
		JSON.stringify({ harness: { localOnly: true }, model: "local-model", theme: "kept" }),
	);
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify({ providers: { local: { displayName: "Local" } }, keep: true }),
	);

	execFileSync("bash", ["-c", result.activationText], {
		env: { ...process.env, HOME: home },
		stdio: ["ignore", "pipe", "pipe"],
	});

	const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
	const models = JSON.parse(readFileSync(join(agentDir, "models.json"), "utf8"));
	assert.deepEqual(settings.harness, { localOnly: true, source: "pi-harness" });
	assert.equal(settings.model, "sonnet");
	assert.equal(settings.theme, "ayu-dark");
	assert.deepEqual(settings.packages, [
		"npm:unrelated-package@2.0.0",
		"npm:pi-subagents-j0k3r@1.4.4",
	]);
	assert.equal(
		settings.packages.filter((source: string) => source === "npm:pi-subagents-j0k3r@1.4.4").length,
		1,
	);
	assert.equal(models.default, "sonnet");
	assert.equal(models.providers.local.displayName, "Local");
	assert.equal(models.providers.anthropic.displayName, "Anthropic");
	assert.equal(models.keep, true);
});

test("Pi settings add the pinned package when packages are missing", () => {
	const result = moduleEval("");
	const home = mkdtempSync(join(tmpdir(), "pi-harness-home-"));

	execFileSync("bash", ["-c", result.activationText], {
		env: { ...process.env, HOME: home },
		stdio: ["ignore", "pipe", "pipe"],
	});

	const settings = JSON.parse(readFileSync(join(home, ".pi", "agent", "settings.json"), "utf8"));
	assert.deepEqual(settings.packages, ["npm:pi-subagents-j0k3r@1.4.4"]);
});

test("Pi settings packages must be a list", () => {
	const expression = `
		let
		  flake = builtins.getFlake "path:${repoRoot}";
		  pkgs = import flake.inputs.nixpkgs { system = "x86_64-linux"; };
		  evaluated = pkgs.lib.evalModules {
		    specialArgs = { inherit pkgs; };
		    modules = [
		      ({ lib, ... }: {
		        options.home = {
		          packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
		          file = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
		          activation = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
		        };
		      })
		      flake.homeModules.default
		      {
		        programs.pi.coding-agent = {
		          enable = true;
		          theme = null;
		          settings.packages = "npm:not-a-list@1.0.0";
		        };
		      }
		    ];
		  };
		in evaluated.config.home.activation.piCodingAgentMutableConfig
	`;
	const result = spawnSync(
		"nix",
		["eval", "--json", "--impure", "--no-write-lock-file", "--expr", expression],
		{ cwd: repoRoot, env: nixEnv, encoding: "utf8" },
	);

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /programs\.pi\.coding-agent\.settings\.packages must be a list/);
});

test("Pi runtime wrapper carries resources and mutable config paths without taking over runtime state", () => {
	const result = moduleEval();

	assert.equal(result.wrapperExecutable, true);
	assert.match(result.wrapperText, /export AI_HARNESS_MCP_ENV_FILE='?\/home\/tester\/\.config\/ai-harness\/secrets\/mcp\.env'?/);
	assert.match(result.wrapperText, /export PI_HARNESS_SETTINGS_FILE="\$HOME\/\.pi\/agent\/settings\.json"/);
	assert.match(result.wrapperText, /export PI_HARNESS_MODELS_FILE="\$HOME\/\.pi\/agent\/models\.json"/);
	assert.match(result.wrapperText, /export PI_HARNESS_RESOURCES_JSON=/);
	assert.match(result.wrapperText, /--extension/);
	assert.match(result.wrapperText, /--theme .*assets\/themes/);
	assert.match(result.wrapperText, /--model sonnet/);
	assert.match(result.wrapperText, /exec \/nix\/store\/.+-hello-.+\/bin\/hello/);
	assert.doesNotMatch(result.wrapperText, /\.pi\/agent\/(cache|session|auth|logs|history|telemetry|db)/);
});

