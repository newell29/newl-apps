resolve_codex_cli() {
  local candidate=""

  if [[ -n "${CODEX_BIN:-}" ]]; then
    if [[ ! -x "${CODEX_BIN}" ]]; then
      echo "CODEX_BIN does not point to an executable Codex CLI." >&2
      return 1
    fi
    codex_bin="${CODEX_BIN}"
    return 0
  fi

  candidate="$(command -v codex 2>/dev/null || true)"
  if [[ -n "${candidate}" && -x "${candidate}" ]]; then
    codex_bin="${candidate}"
    return 0
  fi

  for candidate in \
    "${HOME}/.local/bin/codex" \
    "${HOME}/Applications/ChatGPT.app/Contents/Resources/codex" \
    "/Applications/ChatGPT.app/Contents/Resources/codex"; do
    if [[ -x "${candidate}" ]]; then
      codex_bin="${candidate}"
      return 0
    fi
  done

  echo "Codex CLI is required. Install it or set CODEX_BIN to its executable path." >&2
  return 1
}
