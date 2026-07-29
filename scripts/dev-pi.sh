#!/usr/bin/env bash
# Run Pi against an isolated, repo-built pi-harness config directory.
#
# This is the Nix/dev equivalent of scripts/link.sh, but it writes into a temp
# PI_CODING_AGENT_DIR instead of ~/.pi/agent so global Pi configuration cannot
# mask missing harness wiring. Official packages are declared in settings.json
# for Pi to discover natively at startup.
set -euo pipefail

REPO_DIR="${PI_HARNESS_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PI_COMMAND="${PI_HARNESS_PI_COMMAND:-pi}"
KEEP=0
WITH_AUTH=0
MCP_CONFIG=""
ROOT=""
CREATED_ROOT=0

usage() {
	cat <<'USAGE'
Usage: pi-harness-dev-pi [options] -- [pi args...]

Options:
  --keep                 Keep the generated temp directory and print its path.
  --root DIR             Use DIR as the temp root instead of mktemp -d.
  --mcp FILE             Copy FILE to the isolated agent dir as mcp.json.
  --with-auth            Copy ~/.pi/agent/auth.json into the isolated agent dir.
  -h, --help             Show this help.

Examples:
  nix run .#dev-pi -- --no-session --no-tools
  nix run .#dev-pi -- --mcp ~/.pi/agent/mcp.json --with-auth --no-session

The script sets PI_CODING_AGENT_DIR to <root>/agent and HOME to <root>/home.
This prevents Pi from discovering ~/.pi/agent and ~/.agents resources. If your
MCP server or auth flow needs real HOME, pass explicit env vars in the command
you run or use --mcp with absolute paths.
USAGE
}

while [ "$#" -gt 0 ]; do
	case "$1" in
		--keep)
			KEEP=1
			shift
			;;
		--with-auth)
			WITH_AUTH=1
			shift
			;;
		--mcp)
			MCP_CONFIG="${2:?--mcp requires a file}"
			shift 2
			;;
		--root)
			ROOT="${2:?--root requires a directory}"
			shift 2
			;;
		-h|--help)
			usage
			exit 0
			;;
		--)
			shift
			break
			;;
		*)
			break
			;;
	esac
done

if [ -z "$ROOT" ]; then
	ROOT="$(mktemp -d -t pi-harness-dev.XXXXXX)"
	CREATED_ROOT=1
else
	mkdir -p "$ROOT"
fi

if [ "$KEEP" -eq 0 ] && [ "$CREATED_ROOT" -eq 1 ]; then
	cleanup() { rm -rf "$ROOT"; }
	trap cleanup EXIT
fi

AGENT_DIR="$ROOT/agent"
DEV_HOME="$ROOT/home"
mkdir -p "$AGENT_DIR/extensions" "$AGENT_DIR/agents" "$AGENT_DIR/chains" "$AGENT_DIR/support" "$DEV_HOME"

link_file() {
	local src="$1" dst="$2"
	mkdir -p "$(dirname "$dst")"
	ln -s "$src" "$dst"
}

write_extension_loader() {
	local src="$1" dst="$2"
	mkdir -p "$(dirname "$dst")"
	printf 'export { default } from "%s";\n' "$src" > "$dst"
}

for f in "$REPO_DIR"/extensions/*.ts; do
	[ -e "$f" ] || continue
	write_extension_loader "$f" "$AGENT_DIR/extensions/$(basename "$f")"
done

write_extension_loader "${REPO_DIR}/vendor/pi-tool-renderer/extensions/tool-renderer.ts" "$AGENT_DIR/extensions/pi-tool-renderer.ts"

link_file "$REPO_DIR/packages" "$AGENT_DIR/packages"
link_file "$REPO_DIR/assets/orchestrator.md" "$AGENT_DIR/AGENTS.md"

for f in "$REPO_DIR"/assets/agents/*.md; do
	[ -e "$f" ] || continue
	link_file "$f" "$AGENT_DIR/agents/$(basename "$f")"
done

for f in "$REPO_DIR"/assets/chains/*; do
	[ -e "$f" ] || continue
	link_file "$f" "$AGENT_DIR/chains/$(basename "$f")"
done

for f in "$REPO_DIR"/assets/support/*; do
	[ -e "$f" ] || continue
	link_file "$f" "$AGENT_DIR/support/$(basename "$f")"
done

for f in "$REPO_DIR"/assets/themes/*.json; do
	[ -e "$f" ] || continue
	link_file "$f" "$AGENT_DIR/themes/$(basename "$f")"
done

cat > "$AGENT_DIR/settings.json" <<'JSON'
{
  "harness": {
    "managedBy": "pi-harness-dev-pi",
    "source": "repo"
  },
  "theme": "ayu-dark",
  "packages": [
    "npm:pi-subagents-j0k3r@1.4.4"
  ]
}
JSON

if [ -n "$MCP_CONFIG" ]; then
	cp "$MCP_CONFIG" "$AGENT_DIR/mcp.json"
fi

if [ "$WITH_AUTH" -eq 1 ]; then
	if [ -f "$HOME/.pi/agent/auth.json" ]; then
		cp "$HOME/.pi/agent/auth.json" "$AGENT_DIR/auth.json"
	else
		echo "warning: --with-auth requested but ~/.pi/agent/auth.json does not exist" >&2
	fi
fi

cat >&2 <<EOF
pi-harness dev runtime:
  root: $ROOT
  PI_CODING_AGENT_DIR: $AGENT_DIR
  HOME: $DEV_HOME
  extensions: $(find "$AGENT_DIR/extensions" -maxdepth 1 -type f -o -type l | wc -l)
  agents: $(find "$AGENT_DIR/agents" -maxdepth 1 -type f -o -type l | wc -l)
EOF

PI_CODING_AGENT_DIR="$AGENT_DIR" HOME="$DEV_HOME" "$PI_COMMAND" "$@"
