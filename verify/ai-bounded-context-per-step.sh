#!/usr/bin/env bash
# WON-593: Bound AI context throughout chat and drafting runs
#
# Done means: chat and drafting apply explicit context budgets to every model request, including
# oversized current turns and long tool results. The budget bar is HISTORY_BUDGET in
# workers/agent/chat-history.ts; the per-step boundary is chatPrepareStep, which index.ts passes
# to streamText.
source "${VERIFY_LIB:-$HOME/Developer/build-pref/scripts/verify_lib.sh}"

check "budget tests pass (verify/ai-bounded-context-per-step.test.mjs)" node --test verify/ai-bounded-context-per-step.test.mjs
check "existing chat and auto-draft tests pass" node --test tests/chat-history.test.mjs tests/chat-steps.test.mjs tests/injection-scan-coverage.test.mjs tests/auto-draft-tools.test.mjs
check "chat still passes chatPrepareStep to streamText" grep -q "prepareStep: chatPrepareStep" workers/agent/index.ts

done_checks
