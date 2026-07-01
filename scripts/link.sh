#!/usr/bin/env bash
#
# Symlink pi-harness assets into ~/.pi/agent/ (non-destructive).
#
# Harness-owned surfaces are linked: extensions/, packages/, agents/,
# assets/chains/, and assets/support/. packages/ is linked as a whole directory. extensions/ is linked
# PER FILE so that vendored third-party entries (vendor/*/...) can be loaded
# alongside the repo's own extensions WITHOUT importing them from any repo source
# file — that keeps the vendored code out of the harness `tsc --noEmit` program
# (the harness tsconfig only includes extensions/, packages/, tests/). The cost is
# that adding a NEW repo extension requires re-running this script (then /reload).
# agents/ and assets/chains/ stay per-file because that target dir is shared with
# assets this repo does not own. Skills are intentionally left untouched — they are
# managed by the upstream-ai-sync flow, not by this repo.
#
# An existing real file/dir at a target path is backed up to <path>.bak before
# being replaced. An existing symlink is replaced silently.
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_AGENT="${HOME}/.pi/agent"

configure_atlas_mcp() {
	local mcp_file="${PI_AGENT}/mcp.json"
	local atlas_bin="${ATLAS_MCP_BIN:-/home/iperez/dev/personal/atlas/target/release/atlas_mcp}"
	local atlas_url="${ATLAS_BASE_URL:-http://localhost:8080}"

	if [ ! -x "$atlas_bin" ]; then
		echo "skipped:   atlas MCP binary not executable at ${atlas_bin}"
		return 0
	fi

	mkdir -p "$(dirname "$mcp_file")"

	MCP_FILE="$mcp_file" ATLAS_MCP_BIN="$atlas_bin" ATLAS_BASE_URL="$atlas_url" node <<'NODE'
const fs = require("node:fs");

const file = process.env.MCP_FILE;
const atlasToken = process.env.ATLAS_TOKEN;
const atlasBin = process.env.ATLAS_MCP_BIN;
const atlasUrl = process.env.ATLAS_BASE_URL;

let config = { mcpServers: {} };

if (fs.existsSync(file)) {
	config = JSON.parse(fs.readFileSync(file, "utf8"));
}

if (!config || typeof config !== "object" || Array.isArray(config)) {
	config = { mcpServers: {} };
}

if (!config.mcpServers || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers)) {
	config.mcpServers = {};
}

const previous = config.mcpServers.atlas;
const previousToken = previous?.env?.ATLAS_TOKEN;
const token = atlasToken || previousToken;

if (!token) {
	console.log("skipped:   atlas MCP token missing; set ATLAS_TOKEN or keep an existing atlas entry");
	process.exit(0);
}

config.mcpServers.atlas = {
	command: atlasBin,
	args: ["--transport", "stdio"],
	env: {
		ATLAS_BASE_URL: atlasUrl,
		ATLAS_TOKEN: token,
	},
	lifecycle: "lazy",
};

fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
console.log(`configured: ${file} -> atlas`);
NODE
}

link_file() {
	local src="$1" dst="$2"

	mkdir -p "$(dirname "$dst")"

	if [ -L "$dst" ]; then
		rm "$dst"
	elif [ -e "$dst" ]; then
		mv "$dst" "${dst}.bak"
		echo "backed up: ${dst} -> ${dst}.bak"
	fi

	ln -s "$src" "$dst"
	echo "linked:    ${dst} -> ${src}"
}

# Writes a generated re-export loader for a vendored extension instead of symlinking
# it. Pi resolves an extension's relative imports against the LOADED FILE'S OWN
# directory, not the symlink target's — so a symlinked entry's `./sibling.ts` imports
# resolve in ${PI_EXT} (where the siblings do not exist) and fail. A real file that
# re-exports the entry by ABSOLUTE path loads the entry from its true directory, so
# its siblings resolve. Generated outside the repo, so it never enters the tsconfig.
write_vendor_loader() {
	local entry="$1" dst="$2" expected

	if [ ! -f "$entry" ]; then
		[ -e "$dst" ] && rm -f "$dst"   # drop a stale loader if the vendored entry is gone
		return 0
	fi

	expected="export { default } from \"${entry}\";"

	if [ -f "$dst" ] && [ "$(cat "$dst")" = "$expected" ]; then
		echo "kept:      ${dst} -> re-export ${entry}"
		return 0
	fi

	if [ -L "$dst" ]; then
		rm "$dst"
	elif [ -e "$dst" ]; then
		mv "$dst" "${dst}.bak"
		echo "backed up: ${dst} -> ${dst}.bak"
	fi

	printf '%s\n' "$expected" > "$dst"
	echo "wrote:     ${dst} -> re-export ${entry}"
}

# extensions/: per-file links plus the vendored entries. The target dir is reset to
# a clean set of managed symlinks each run (stale links from removed extensions are
# pruned), while any real file a user dropped in there is preserved.
PI_EXT="${PI_AGENT}/extensions"
if [ -L "${PI_EXT}" ]; then
	rm "${PI_EXT}"
elif [ -d "${PI_EXT}" ]; then
	find "${PI_EXT}" -maxdepth 1 -type l -delete
fi
mkdir -p "${PI_EXT}"

for f in "${REPO_DIR}"/extensions/*.ts; do
	[ -e "$f" ] || continue
	link_file "$f" "${PI_EXT}/$(basename "$f")"
done

# Vendored third-party extensions: loaded via generated absolute-path re-export
# files (see write_vendor_loader) so their internal relative imports resolve, and so
# the vendored code stays out of the harness tsconfig. See vendor/*/VENDORED.md.
write_vendor_loader "${REPO_DIR}/vendor/pi-tool-renderer/extensions/tool-renderer.ts" "${PI_EXT}/pi-tool-renderer.ts"
# pi-subagents.ts points at the harness compatibility loader, which boots the
# vendored j0k3r runtime from vendor/pi-subagents/j0k3r/ and re-registers the
# legacy Agent/get_subagent_result/steer_subagent and /agents surfaces.
write_vendor_loader "${REPO_DIR}/vendor/pi-subagents/src/index.ts" "${PI_EXT}/pi-subagents.ts"

if [ -d "${REPO_DIR}/packages" ]; then
	link_file "${REPO_DIR}/packages" "${PI_AGENT}/packages"
fi

if [ -d "${REPO_DIR}/assets/agents" ]; then
	mkdir -p "${PI_AGENT}/agents"
	# Prune stale harness-owned agent symlinks so removed/renamed agents do not
	# keep appearing in /agents (for example old proposal/task aliases).
	find "${PI_AGENT}/agents" -maxdepth 1 -type l | while read -r link; do
		target="$(readlink "$link")"
		case "$target" in
			"${REPO_DIR}/assets/agents/"*)
				[ -e "$target" ] || rm "$link"
				;;
		esac
	done
	for f in "${REPO_DIR}"/assets/agents/*.md; do
		[ -e "$f" ] || continue
		link_file "$f" "${PI_AGENT}/agents/$(basename "$f")"
	done
fi

if [ -d "${REPO_DIR}/assets/chains" ]; then
	for f in "${REPO_DIR}"/assets/chains/*; do
		[ -e "$f" ] || continue
		link_file "$f" "${PI_AGENT}/chains/$(basename "$f")"
	done
fi

if [ -d "${REPO_DIR}/assets/support" ]; then
	for f in "${REPO_DIR}"/assets/support/*; do
		[ -e "$f" ] || continue
		link_file "$f" "${PI_AGENT}/support/$(basename "$f")"
	done
fi

configure_atlas_mcp

echo "Done."
