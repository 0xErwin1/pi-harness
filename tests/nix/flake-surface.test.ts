import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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

test("flake exposes the Home Manager consumption surface", () => {
	const show = nixJson(["flake", "show", "--json", "--no-write-lock-file", `path:${repoRoot}`]) as any;

	assert.equal(show.packages["x86_64-linux"].default.type, "derivation");
	assert.equal(show.packages["x86_64-linux"]["pi-harness-assets"].type, "derivation");
	assert.equal(show.checks["x86_64-linux"]["assets-present"].type, "derivation");
	assert.equal(show.formatter["x86_64-linux"].type, "derivation");
	assert.equal(show.overlays.default.type, "nixpkgs-overlay");
	assert.equal(show.homeModules.type, "unknown");
	assert.equal(show.homeManagerModules.type, "unknown");
	assert.equal(show.apps["x86_64-linux"].relink.type, "app");
});

test("flake helper library exposes assets, projections, JSON merge, and wrappers", () => {
	const expression = `
		let
		  flake = builtins.getFlake "path:${repoRoot}";
		  pkgs = import flake.inputs.nixpkgs { system = "x86_64-linux"; };
		  homeModule = flake.homeModules.default {
		    config.programs.pi.coding-agent = {
		      enable = false;
		      package = null;
		      settings = { };
		      resources = [ ];
		      environment = { };
		      extraArgs = [ ];
		    };
		    lib = pkgs.lib;
		    inherit pkgs;
		  };
		in {
		  assetKeys = builtins.attrNames flake.assets;
		  libAssetKeys = builtins.attrNames flake.lib.assets;
		  homeModuleKeys = builtins.attrNames flake.homeModules;
		  homeManagerModuleKeys = builtins.attrNames flake.homeManagerModules;
		  homeOptionKeys = builtins.attrNames homeModule.options.programs.pi.coding-agent;
		  projection = flake.lib.mkProjection {
		    source = flake.assets.agents;
		    target = ".pi/agent/agents";
		    recursive = true;
		  };
		  merged = flake.lib.mergeJsonAttrs {
		    keep = true;
		    nested.left = 1;
		  } {
		    nested.right = 2;
		    added = "yes";
		  };
		  wrapper = flake.lib.mkWrapperScript {
		    command = "pi";
		    environment = { ATLAS_TOKEN_FILE = "/run/secrets/atlas token"; };
		    extraArgs = [ "--model" "sonnet" ];
		  };
		}
	`;
	const result = nixJson(["eval", "--json", "--impure", "--no-write-lock-file", "--expr", expression]) as any;

	for (const key of ["agents", "chains", "support", "orchestrator", "extensions", "packages"]) {
		assert.ok(result.assetKeys.includes(key), `assets includes ${key}`);
		assert.ok(result.libAssetKeys.includes(key), `lib.assets includes ${key}`);
	}
	assert.deepEqual(result.homeModuleKeys, ["default", "pi-harness"]);
	assert.deepEqual(result.homeManagerModuleKeys, ["default", "pi-harness"]);
	assert.deepEqual(result.homeOptionKeys, ["enable", "environment", "extraArgs", "package", "resources", "settings"]);
	assert.equal(result.projection.target, ".pi/agent/agents");
	assert.equal(result.projection.recursive, true);
	assert.equal(result.merged.keep, true);
	assert.equal(result.merged.nested.left, 1);
	assert.equal(result.merged.nested.right, 2);
	assert.equal(result.merged.added, "yes");
	assert.match(result.wrapper, /export ATLAS_TOKEN_FILE='\/run\/secrets\/atlas token'/);
	assert.match(result.wrapper, /exec pi --model sonnet "\$@"/);
});
