#!/bin/sh
# kanthropic — Grok Build hook.
# Writes ~/.kanthropic/state/<session>.json so the menu-bar app can pop while
# Grok is thinking. Stdout MUST stay empty: Stop is a gate, and any JSON would
# be parsed as a decision. Failures are fail-open (exit 0).
STATE_DIR="${HOME}/.kanthropic/state"
mkdir -p "$STATE_DIR" || exit 0

INPUT=$(cat 2>/dev/null || true)
EVENT="${GROK_HOOK_EVENT:-}"
if [ -z "$EVENT" ]; then
  EVENT=$(printf '%s' "$INPUT" | sed -n 's/.*"hookEventName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
fi
SID="${GROK_SESSION_ID:-}"
if [ -z "$SID" ]; then
  SID=$(printf '%s' "$INPUT" | sed -n 's/.*"sessionId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
fi
[ -n "$SID" ] || SID=default

# Nested subagents are not the session — ignore their start/stop.
SUB=$(printf '%s' "$INPUT" | sed -n 's/.*"subagentType"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
[ -n "$SUB" ] && exit 0

PID=$(printf '%s' "$INPUT" | sed -n 's/.*"promptId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)

BUSY="$STATE_DIR/$SID.json"
TURN="$STATE_DIR/$SID.turn"

write_state() {
  printf '{"state":"%s","at":%s,"promptId":"%s"}' "$1" "$(date +%s)" "$2" > "$BUSY.$$" && mv -f "$BUSY.$$" "$BUSY"
}

# user_prompt_submit / UserPromptSubmit / userpromptsubmit → same bucket
NORM=$(printf '%s' "$EVENT" | tr '[:upper:]' '[:lower:]' | tr -d '_')

case "$NORM" in
  userpromptsubmit)
    printf '%s' "$PID" > "$TURN.$$" && mv -f "$TURN.$$" "$TURN"
    write_state thinking "$PID"
    ;;
  stop|stopfailure|stopcancelled|sessionend)
    # A cancelled turn's report can arrive AFTER the next UserPromptSubmit.
    # Only settle if this report has no promptId (session-level), we never
    # saw a start, or it matches the turn we marked busy.
    CUR=$(cat "$TURN" 2>/dev/null || true)
    if [ -z "$PID" ] || [ -z "$CUR" ] || [ "$PID" = "$CUR" ]; then
      write_state idle "${PID:-}"
      rm -f "$TURN"
    fi
    ;;
  notification)
    # matcher is idle_prompt — backstop for turns that report none of the three.
    write_state idle "${PID:-}"
    rm -f "$TURN"
    ;;
esac
exit 0
