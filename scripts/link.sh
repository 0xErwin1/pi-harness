#!/usr/bin/env bash
#
# Symlink pi-harness assets into ~/.pi/agent/ (non-destructive).
#
# Harness-owned surfaces are linked: extensions/, packages/, agents/, and
# assets/chains/. extensions/ and packages/ are linked as whole directories so a
# newly added file is picked up with no re-link (only a Pi /reload). agents/ and
# assets/chains/ stay per-file because that target dir is shared with assets this
# repo does not own. Skills are intentionally left untouched — they are managed
# by the upstream-ai-sync flow, not by this repo.
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

if [ -d "${REPO_DIR}/extensions" ]; then
	link_file "${REPO_DIR}/extensions" "${PI_AGENT}/extensions"
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
