#!/bin/zsh

require_codex_chatgpt_subscription() {
  local status_output
  status_output="$("${codex_bin}" login status 2>&1)" || {
    echo "Codex ChatGPT subscription authentication is unavailable. Run 'codex login' on this worker." >&2
    return 1
  }
  if [[ "${status_output}" != *"Logged in using ChatGPT"* ]]; then
    echo "Codex is not authenticated with a ChatGPT subscription. API-key fallback is disabled for Website Growth." >&2
    return 1
  fi
}
