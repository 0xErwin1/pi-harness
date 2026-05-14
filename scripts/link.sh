#!/usr/bin/env bash
#
# Symlink pi-harness assets into ~/.pi/agent/ (per-file, non-destructive).
#
# Only the harness-owned surfaces are linked: extensions/ and assets/chains/.
# agents/ and skills/ are intentionally left untouched — they are managed by
# the upstream-ai-sync flow, not by this repo.
#
# An existing real file at a target path is backed up to <path>.bak before
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

for f in "${REPO_DIR}"/extensions/*.ts; do
	[ -e "$f" ] || continue
	link_file "$f" "${PI_AGENT}/extensions/$(basename "$f")"
done

if [ -d "${REPO_DIR}/assets/chains" ]; then
	for f in "${REPO_DIR}"/assets/chains/*; do
		[ -e "$f" ] || continue
		link_file "$f" "${PI_AGENT}/chains/$(basename "$f")"
	done
fi

echo "Done."
