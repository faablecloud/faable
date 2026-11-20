#!/bin/sh
# Every Bash command of the session runs the Faable CLI as an agent:
# read-only (nothing that changes Faable runs without the user turning it
# off), non-interactive (no prompts, the app never guessed from the working
# directory) and counted as `faable-skill` by the Faable API.
#
# Only what the user has not set already: FAABLE_READONLY=0 in their
# environment or in Claude Code's `env` setting keeps writes allowed.
[ -n "$CLAUDE_ENV_FILE" ] || exit 0
{
  [ -n "${FAABLE_READONLY+x}" ] || echo "export FAABLE_READONLY=1"
  [ -n "${FAABLE_NONINTERACTIVE+x}" ] || echo "export FAABLE_NONINTERACTIVE=1"
  [ -n "${FAABLE_CLIENT_NAME+x}" ] || echo "export FAABLE_CLIENT_NAME=faable-skill"
} >> "$CLAUDE_ENV_FILE"
exit 0
