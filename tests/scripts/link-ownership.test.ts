import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const linkScript = join(repoRoot, "scripts", "link.sh");
const devPiScript = join(repoRoot, "scripts", "dev-pi.sh");
const ownerMarkerContent = "schema=1\nowner=home-manager\nscope=global\n";

type SnapshotEntry =
	| { type: "directory"; mode: number }
	| { type: "file"; mode: number; bytes: string }
	| { type: "file"; mode: number; readError: string }
	| { type: "symlink"; mode: number; target: string };

function snapshotTree(root: string): Record<string, SnapshotEntry> {
	const snapshot: Record<string, SnapshotEntry> = {};

	function visit(path: string): void {
		const stat = lstatSync(path);
		const key = relative(root, path) || ".";
		const mode = stat.mode & 0o7777;

		if (stat.isSymbolicLink()) {
			snapshot[key] = { type: "symlink", mode, target: readlinkSync(path) };
			return;
		}
		if (stat.isDirectory()) {
			snapshot[key] = { type: "directory", mode };
			for (const entry of readdirSync(path).sort()) visit(join(path, entry));
			return;
		}
		try {
			snapshot[key] = { type: "file", mode, bytes: readFileSync(path).toString("base64") };
		} catch (error) {
			snapshot[key] = {
				type: "file",
				mode,
				readError: (error as NodeJS.ErrnoException).code ?? "unknown",
			};
		}
	}

	if (existsSync(root)) visit(root);
	return snapshot;
}

function createManagedHome(markerContent = ownerMarkerContent): string {
	const home = mkdtempSync(join(tmpdir(), "pi-harness-link-owner-"));
	const agentDir = join(home, ".pi", "agent");
	const extensionsDir = join(agentDir, "extensions");
	mkdirSync(extensionsDir, { recursive: true });
	writeFileSync(join(agentDir, ".pi-harness-owner"), markerContent);
	writeFileSync(join(agentDir, "settings.json"), '{"sentinel":"keep-byte-for-byte"}\n');
	writeFileSync(join(extensionsDir, "local.ts"), Buffer.from([0x00, 0x01, 0x7f, 0x80, 0xff]));
	symlinkSync("local.ts", join(extensionsDir, "sentinel-link.ts"));
	return home;
}

function runLink(home: string) {
	return spawnSync("bash", [linkScript], {
		cwd: repoRoot,
		env: { ...process.env, HOME: home, ATLAS_MCP_BIN: join(home, "missing-atlas-mcp") },
		encoding: "utf8",
	});
}

function assertRefusalWithoutMutation(home: string, message: RegExp): void {
	const before = snapshotTree(home);
	const result = runLink(home);
	const output = `${result.stdout}${result.stderr}`;

	assert.notEqual(result.status, 0);
	assert.match(output, message);
	assert.match(output, /Home Manager/);
	assert.match(output, /scripts\/dev-pi\.sh/);
	assert.deepEqual(snapshotTree(home), before);
}

test("link.sh checks ownership immediately after resolving its roots", () => {
	const source = readFileSync(linkScript, "utf8");
	const agentRoot = source.indexOf('PI_AGENT="${HOME}/.pi/agent"');
	const markerCheck = source.indexOf("\nif ", source.indexOf('OWNER_MARKER="${PI_AGENT}/.pi-harness-owner"'));
	const firstMutation = source.indexOf("mkdir -p", markerCheck);

	assert.ok(agentRoot >= 0);
	assert.ok(markerCheck > agentRoot);
	assert.ok(firstMutation > markerCheck);
});

test("link.sh refuses an exact Home Manager marker without changing any bytes", (t) => {
	const home = createManagedHome();
	t.after(() => rmSync(home, { recursive: true, force: true }));

	assertRefusalWithoutMutation(home, /managed by Home Manager/i);
});

test("link.sh fails closed on a malformed ownership marker", (t) => {
	const home = createManagedHome("not-an-ownership-record\n");
	t.after(() => rmSync(home, { recursive: true, force: true }));

	assertRefusalWithoutMutation(home, /refusing to mutate/i);
});

test("link.sh fails closed on an unknown ownership marker", (t) => {
	const home = createManagedHome("schema=2\nowner=another-installer\nscope=global\n");
	t.after(() => rmSync(home, { recursive: true, force: true }));

	assertRefusalWithoutMutation(home, /refusing to mutate/i);
});

test("link.sh fails closed on an unreadable ownership marker", (t) => {
	const home = createManagedHome();
	const marker = join(home, ".pi", "agent", ".pi-harness-owner");
	chmodSync(marker, 0o000);
	t.after(() => {
		chmodSync(marker, 0o600);
		rmSync(home, { recursive: true, force: true });
	});

	assertRefusalWithoutMutation(home, /refusing to mutate/i);
	chmodSync(marker, 0o600);
	assert.equal(readFileSync(marker, "utf8"), ownerMarkerContent);
});

test("link.sh fails closed on a broken ownership marker", (t) => {
	const home = createManagedHome();
	const marker = join(home, ".pi", "agent", ".pi-harness-owner");
	unlinkSync(marker);
	symlinkSync("missing-owner-record", marker);
	t.after(() => rmSync(home, { recursive: true, force: true }));

	assertRefusalWithoutMutation(home, /refusing to mutate/i);
});

test("link.sh preserves legacy unmanaged installation when the marker is absent", (t) => {
	const home = createManagedHome();
	const marker = join(home, ".pi", "agent", ".pi-harness-owner");
	unlinkSync(marker);
	t.after(() => rmSync(home, { recursive: true, force: true }));

	const result = runLink(home);
	const settings = JSON.parse(readFileSync(join(home, ".pi", "agent", "settings.json"), "utf8"));

	assert.equal(result.status, 0, result.stderr);
	assert.equal(settings.sentinel, "keep-byte-for-byte");
	assert.deepEqual(settings.packages, ["npm:pi-subagents-j0k3r@1.4.4"]);
	assert.equal(existsSync(marker), false);
	assert.match(result.stdout, /Done\./);
});

test("dev-pi.sh ignores and preserves the global ownership marker", (t) => {
	const root = mkdtempSync(join(tmpdir(), "pi-harness-dev-owner-"));
	const globalHome = join(root, "global-home");
	const globalAgent = join(globalHome, ".pi", "agent");
	const marker = join(globalAgent, ".pi-harness-owner");
	const devRoot = join(root, "runtime");
	const fakePi = join(root, "fake-pi.sh");
	mkdirSync(globalAgent, { recursive: true });
	writeFileSync(marker, ownerMarkerContent);
	writeFileSync(join(globalAgent, "global-sentinel.bin"), Buffer.from([0xde, 0xad, 0xbe, 0xef]));
	chmodSync(marker, 0o000);
	writeFileSync(
		fakePi,
		'#!/usr/bin/env bash\nprintf "HOME=%s\\nPI_CODING_AGENT_DIR=%s\\nARGS=%s\\n" "$HOME" "$PI_CODING_AGENT_DIR" "$*"\n',
		{ mode: 0o700 },
	);
	t.after(() => {
		chmodSync(marker, 0o600);
		rmSync(root, { recursive: true, force: true });
	});
	const before = snapshotTree(globalHome);

	const result = spawnSync("bash", [devPiScript, "--root", devRoot, "--", "--probe"], {
		cwd: repoRoot,
		env: {
			...process.env,
			HOME: globalHome,
			PI_HARNESS_PI_COMMAND: fakePi,
			PI_HARNESS_REPO_DIR: repoRoot,
		},
		encoding: "utf8",
	});

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, new RegExp(`HOME=${devRoot}/home`));
	assert.match(result.stdout, new RegExp(`PI_CODING_AGENT_DIR=${devRoot}/agent`));
	assert.match(result.stdout, /ARGS=--probe/);
	assert.deepEqual(snapshotTree(globalHome), before);
	assert.doesNotMatch(readFileSync(devPiScript, "utf8"), /\.pi-harness-owner/);
	chmodSync(marker, 0o600);
	assert.equal(readFileSync(marker, "utf8"), ownerMarkerContent);
});
