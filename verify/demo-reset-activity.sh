#!/usr/bin/env bash
# The demo's hourly reset clears the activity log, so one visitor's redraft instructions don't show to the next.
source "${VERIFY_LIB:-$HOME/Developer/build-pref/scripts/verify_lib.sh}"
check "resetDemo deletes agent_activity" bash -c "grep -A10 'export async function resetDemo' workers/lib/dev-seed/index.ts | grep -q agent_activity"
done_checks
