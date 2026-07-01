import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

function moduleEval(): any {
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
		  wrapperText = evaluated.config.home.file.".local/bin/pi-harness-pi".text;
		  wrapperExecutable = evaluated.config.home.file.".local/bin/pi-harness-pi".executable;
		}
	`;
	return nixJson(["eval", "--json", "--impure", "--no-write-lock-file", "--expr", expression]);
}

test("Pi mutable activation preserves local fields while applying generated settings and models", () => {
	const result = moduleEval();
	assert.ok(result.optionKeys.includes("models"));
	assert.ok(result.optionKeys.includes("wrapper"));
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
	assert.equal(settings.theme, "kept");
	assert.equal(models.default, "sonnet");
	assert.equal(models.providers.local.displayName, "Local");
	assert.equal(models.providers.anthropic.displayName, "Anthropic");
	assert.equal(models.keep, true);
});

test("Pi runtime wrapper carries resources and mutable config paths without taking over runtime state", () => {
	const result = moduleEval();

	assert.equal(result.wrapperExecutable, true);
	assert.match(result.wrapperText, /export AI_HARNESS_MCP_ENV_FILE='?\/home\/tester\/\.config\/ai-harness\/secrets\/mcp\.env'?/);
	assert.match(result.wrapperText, /export PI_HARNESS_SETTINGS_FILE="\$HOME\/\.pi\/agent\/settings\.json"/);
	assert.match(result.wrapperText, /export PI_HARNESS_MODELS_FILE="\$HOME\/\.pi\/agent\/models\.json"/);
	assert.match(result.wrapperText, /export PI_HARNESS_RESOURCES_JSON=/);
	assert.match(result.wrapperText, /--extension/);
	assert.match(result.wrapperText, /--model sonnet/);
	assert.match(result.wrapperText, /exec \/nix\/store\/.+-hello-.+\/bin\/hello/);
	assert.doesNotMatch(result.wrapperText, /\.pi\/agent\/(cache|session|auth|logs|history|telemetry|db)/);
});

