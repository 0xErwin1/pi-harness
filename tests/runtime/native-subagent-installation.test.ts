import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LINK_SCRIPT = join(REPO_ROOT, "scripts/link.sh");
const DEV_PI_SCRIPT = join(REPO_ROOT, "scripts/dev-pi.sh");
const PACKAGE_SOURCE = "npm:pi-subagents-j0k3r@1.4.4";

async function tempDir(t: test.TestContext, prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	t.after(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

function runScript(script: string, args: string[], env: NodeJS.ProcessEnv) {
	return spawnSync("bash", [script, ...args], {
		cwd: REPO_ROOT,
		env: { ...process.env, ...env },
		encoding: "utf8",
	});
}

test("link.sh preserves settings, installs the native package once, and removes its managed stale loader", async (t) => {
	const home = await tempDir(t, "pi-harness-link-native-");
	const agentDir = join(home, ".pi/agent");
	const extensionsDir = join(agentDir, "extensions");
	const settingsFile = join(agentDir, "settings.json");
	const loaderFile = join(extensionsDir, "pi-subagents.ts");
	await mkdir(extensionsDir, { recursive: true });
	await writeFile(settingsFile, JSON.stringify({ theme: "custom", telemetry: false, packages: ["npm:another-package@2.0.0"] }));
	await writeFile(loaderFile, `export { default } from "${REPO_ROOT}/vendor/pi-subagents/src/index.ts";\n`);

	for (let run = 0; run < 2; run += 1) {
		const result = runScript(LINK_SCRIPT, [], { HOME: home, ATLAS_MCP_BIN: join(home, "missing-atlas") });
		assert.equal(result.status, 0, `link.sh failed:\n${result.stderr}\n${result.stdout}`);
	}

	const settings = JSON.parse(await readFile(settingsFile, "utf8"));
	assert.equal(settings.theme, "custom");
	assert.equal(settings.telemetry, false);
	assert.deepEqual(settings.packages, ["npm:another-package@2.0.0", PACKAGE_SOURCE]);
	await assert.rejects(readFile(loaderFile, "utf8"), { code: "ENOENT" });
});

test("link.sh preserves a user-owned pi-subagents.ts file", async (t) => {
	const home = await tempDir(t, "pi-harness-link-user-loader-");
	const extensionsDir = join(home, ".pi/agent/extensions");
	const loaderFile = join(extensionsDir, "pi-subagents.ts");
	const userSource = "export default function myPrivateExtension() {}\n";
	await mkdir(extensionsDir, { recursive: true });
	await writeFile(loaderFile, userSource);

	const result = runScript(LINK_SCRIPT, [], { HOME: home, ATLAS_MCP_BIN: join(home, "missing-atlas") });
	assert.equal(result.status, 0, `link.sh failed:\n${result.stderr}\n${result.stdout}`);
	assert.equal(await readFile(loaderFile, "utf8"), userSource);
});

test("link.sh fails without replacing an invalid packages setting", async (t) => {
	const home = await tempDir(t, "pi-harness-link-invalid-settings-");
	const agentDir = join(home, ".pi/agent");
	const settingsFile = join(agentDir, "settings.json");
	await mkdir(agentDir, { recursive: true });
	await writeFile(settingsFile, JSON.stringify({ theme: "custom", packages: "npm:not-an-array" }));

	const result = runScript(LINK_SCRIPT, [], { HOME: home, ATLAS_MCP_BIN: join(home, "missing-atlas") });
	assert.notEqual(result.status, 0);
	assert.match(`${result.stderr}\n${result.stdout}`, /packages.*array/i);
	assert.deepEqual(JSON.parse(await readFile(settingsFile, "utf8")), { theme: "custom", packages: "npm:not-an-array" });
});

test("dev-pi.sh configures native package discovery without generating a subagent loader", async (t) => {
	const root = await tempDir(t, "pi-harness-dev-native-");
	const result = runScript(DEV_PI_SCRIPT, ["--root", root], {
		HOME: join(root, "caller-home"),
		PI_HARNESS_PI_COMMAND: "true",
	});
	assert.equal(result.status, 0, `dev-pi.sh failed:\n${result.stderr}\n${result.stdout}`);

	const settings = JSON.parse(await readFile(join(root, "agent/settings.json"), "utf8"));
	assert.deepEqual(settings, {
		harness: { managedBy: "pi-harness-dev-pi", source: "repo" },
		theme: "ayu-dark",
		packages: [PACKAGE_SOURCE],
	});
	await assert.rejects(readFile(join(root, "agent/extensions/pi-subagents.ts"), "utf8"), { code: "ENOENT" });
});
