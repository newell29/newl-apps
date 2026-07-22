#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

script_directory="${0:A:h}"
source "${script_directory}/lib/resolve-codex-cli.zsh"
resolve_codex_cli

if ! "${codex_bin}" mcp get semrush >/dev/null 2>&1; then
  "${codex_bin}" mcp add semrush --url https://mcp.semrush.com/v1/mcp
fi

echo "A browser window will open for the official SEMrush OAuth approval."
"${codex_bin}" mcp login semrush
"${codex_bin}" mcp get semrush

echo "SEMrush MCP is configured for Codex through OAuth. No SEMrush secret was written to this repository."
