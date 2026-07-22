#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if ! command -v codex >/dev/null 2>&1; then
  echo "Codex CLI is required before SEMrush MCP can be configured." >&2
  exit 1
fi

if ! codex mcp get semrush >/dev/null 2>&1; then
  codex mcp add semrush --url https://mcp.semrush.com/v1/mcp
fi

echo "A browser window will open for the official SEMrush OAuth approval."
codex mcp login semrush
codex mcp get semrush

echo "SEMrush MCP is configured for Codex through OAuth. No SEMrush secret was written to this repository."
