import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	classifyGuardedCommand,
	degradeForHeadless,
	loadGuardrailsConfig,
	SAFE_DEFAULTS,
	type GuardrailsConfig,
} from "../../packages/shell-guard/policy.ts";

const DEFAULT_CONFIG: GuardrailsConfig = { autonomousMode: false, guardedCommands: {} };
const AUTONOMOUS_CONFIG: GuardrailsConfig = { autonomousMode: true, guardedCommands: {} };

test("hard-deny commands always block, with or without autonomousMode", () => {
	for (const command of [
		"rm -rf /",
		"rm -rf ~",
		"rm -rf $HOME",
		"git reset --hard",
		"git clean -fd",
		"git push --force",
		"git push --force-with-lease",
		"chmod -R 777 .",
		"chown -R user:user .",
	]) {
		assert.equal(classifyGuardedCommand(command, DEFAULT_CONFIG), "block");
		assert.equal(classifyGuardedCommand(command, AUTONOMOUS_CONFIG), "block");
	}
});

test("guarded commands require confirmation when autonomousMode is disabled", () => {
	for (const command of ["git push", "git rebase main", "git branch -D old", "npm publish", "pi remove foo"]) {
		assert.equal(classifyGuardedCommand(command, DEFAULT_CONFIG), "confirm");
	}
});

test("unguarded commands allow unconditionally", () => {
	assert.equal(classifyGuardedCommand("git status", DEFAULT_CONFIG), "allow");
	assert.equal(classifyGuardedCommand("ls -la", AUTONOMOUS_CONFIG), "allow");
});

test("autonomousMode applies the per-command default action when unconfigured", () => {
	assert.equal(classifyGuardedCommand("git push origin main", AUTONOMOUS_CONFIG), "allow");
	assert.equal(classifyGuardedCommand("git rebase main", AUTONOMOUS_CONFIG), "confirm");
	assert.equal(classifyGuardedCommand("git branch -D old", AUTONOMOUS_CONFIG), "confirm");
	assert.equal(classifyGuardedCommand("npm publish", AUTONOMOUS_CONFIG), "block");
	assert.equal(classifyGuardedCommand("pi remove foo", AUTONOMOUS_CONFIG), "confirm");
});

test("autonomousMode honors a configured override for a guarded command", () => {
	const config: GuardrailsConfig = {
		autonomousMode: true,
		guardedCommands: { gitRebase: "allow", npmPublish: "confirm" },
	};

	assert.equal(classifyGuardedCommand("git rebase main", config), "allow");
	assert.equal(classifyGuardedCommand("npm publish", config), "confirm");
});

test("degradeForHeadless blocks a confirm verdict when no UI is available", () => {
	assert.equal(degradeForHeadless("confirm", false), "block");
	assert.equal(degradeForHeadless("confirm", true), "confirm");
	assert.equal(degradeForHeadless("allow", false), "allow");
	assert.equal(degradeForHeadless("block", false), "block");
});

test("headless + autonomousMode still blocks a command that resolves to confirm", () => {
	const classification = classifyGuardedCommand("git rebase main", AUTONOMOUS_CONFIG);
	assert.equal(classification, "confirm");
	assert.equal(degradeForHeadless(classification, false), "block");
});

test("loadGuardrailsConfig returns SAFE_DEFAULTS when no config files exist", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-harness-guardrails-agent-"));
	const cwd = mkdtempSync(join(tmpdir(), "pi-harness-guardrails-cwd-"));

	try {
		const config = loadGuardrailsConfig(cwd, { agentDir });
		assert.deepEqual(config, SAFE_DEFAULTS);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("loadGuardrailsConfig fails safe on malformed JSON, never fails open", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-harness-guardrails-agent-"));
	const cwd = mkdtempSync(join(tmpdir(), "pi-harness-guardrails-cwd-"));

	try {
		writeFileSync(join(agentDir, "runtime-guardrails.json"), "{ not json");
		const config = loadGuardrailsConfig(cwd, { agentDir });
		assert.deepEqual(config, SAFE_DEFAULTS);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("loadGuardrailsConfig fails safe when the config is valid JSON but not an object", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-harness-guardrails-agent-"));
	const cwd = mkdtempSync(join(tmpdir(), "pi-harness-guardrails-cwd-"));

	try {
		writeFileSync(join(agentDir, "runtime-guardrails.json"), "[1, 2, 3]");
		const config = loadGuardrailsConfig(cwd, { agentDir });
		assert.deepEqual(config, SAFE_DEFAULTS);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("loadGuardrailsConfig merges project config on top of global, project autonomousMode wins", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-harness-guardrails-agent-"));
	const cwd = mkdtempSync(join(tmpdir(), "pi-harness-guardrails-cwd-"));

	try {
		writeFileSync(
			join(agentDir, "runtime-guardrails.json"),
			JSON.stringify({
				autonomousMode: true,
				guardedCommands: { gitRebase: "allow", npmPublish: "block" },
			}),
		);

		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "runtime-guardrails.json"),
			JSON.stringify({
				autonomousMode: false,
				guardedCommands: { npmPublish: "confirm" },
			}),
		);

		const config = loadGuardrailsConfig(cwd, { agentDir });
		assert.deepEqual(config, {
			autonomousMode: false,
			guardedCommands: { gitRebase: "allow", npmPublish: "confirm" },
		});
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("loadGuardrailsConfig ignores unknown guarded command keys and invalid actions", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-harness-guardrails-agent-"));
	const cwd = mkdtempSync(join(tmpdir(), "pi-harness-guardrails-cwd-"));

	try {
		writeFileSync(
			join(agentDir, "runtime-guardrails.json"),
			JSON.stringify({
				autonomousMode: true,
				guardedCommands: { gitRebase: "maybe", somethingUnknown: "allow" },
			}),
		);

		const config = loadGuardrailsConfig(cwd, { agentDir });
		assert.deepEqual(config, { autonomousMode: true, guardedCommands: {} });
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
		rmSync(cwd, { recursive: true, force: true });
	}
});
