#!/usr/bin/env bash
#
# Symlink pi-harness assets into ~/.pi/agent/ (non-destructive).
#
# Harness-owned surfaces are linked: extensions/, packages/, agents/, and
# assets/chains/. packages/ is linked as a whole directory. extensions/ is linked
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

# Vendored third-party extensions, loaded here (not via a repo re-export) so they
# stay out of the harness tsconfig. See vendor/*/VENDORED.md for provenance.
if [ -f "${REPO_DIR}/vendor/pi-tool-renderer/extensions/tool-renderer.ts" ]; then
	link_file "${REPO_DIR}/vendor/pi-tool-renderer/extensions/tool-renderer.ts" "${PI_EXT}/pi-tool-renderer.ts"
fi
if [ -f "${REPO_DIR}/vendor/pi-subagents/src/index.ts" ]; then
	link_file "${REPO_DIR}/vendor/pi-subagents/src/index.ts" "${PI_EXT}/pi-subagents.ts"
fi

if [ -d "${REPO_DIR}/packages" ]; then
	link_file "${REPO_DIR}/packages" "${PI_AGENT}/packages"
fi

if [ -d "${REPO_DIR}/assets/agents" ]; then
	mkdir -p "${PI_AGENT}/agents"
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

echo "Done."
