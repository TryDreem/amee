#!/usr/bin/env bash
# PreToolUse guard: hard-block writes to binding docs and generated files.
# Exit 2 = block the tool call and surface stderr to Claude.
# If Claude Code changes the hook payload shape, check `/hooks` and adjust the jq paths.
set -uo pipefail

payload="$(cat)"

if ! command -v jq >/dev/null 2>&1; then
  # Fail CLOSED, not open: if jq is missing we cannot parse the payload, so we
  # cannot tell whether this write targets a protected file. Blocking every
  # Edit/Write until jq is installed is the safe default -- silently doing
  # nothing here would mean the protection is off and nobody notices.
  echo "BLOCKED: this hook needs 'jq' to parse tool input and it is not installed. Install jq (apt/brew install jq) or this hook cannot protect docs/architecture.md, docs/api-contract.md, or types.gen.ts." >&2
  exit 2
fi

path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.path // empty')"
[ -z "$path" ] && exit 0

case "$path" in
  *docs/architecture.md|*references/architecture.md)
    echo "BLOCKED: architecture.md is the binding source of truth, read-only (this may be the docs/ file or the amee-arch-check skill's symlink to it -- same file either way). If the task seems to require changing it, stop and tell the human which decision it contradicts." >&2
    exit 2 ;;
  *docs/api-contract.md|*references/api-contract.md)
    echo "BLOCKED: api-contract.md is binding and read-only (docs/ file or the skill's symlink -- same file). Contract changes are a human decision." >&2
    exit 2 ;;
  *frontend/src/api/types.gen.ts)
    echo "BLOCKED: types.gen.ts is generated from the backend OpenAPI schema. Run 'make types'. If the type is wrong, the backend Pydantic model is wrong." >&2
    exit 2 ;;
  *pnpm-lock.yaml|*uv.lock|*poetry.lock)
    echo "BLOCKED: lockfiles are owned by the main session. Ask for the dependency; do not install it." >&2
    exit 2 ;;
esac
exit 0
