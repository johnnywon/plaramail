#!/usr/bin/env bash
# A demo keeps its agent entry points with a notice in the chat, and its settings are read-only.
source "${VERIFY_LIB:-$HOME/Developer/build-pref/scripts/verify_lib.sh}"
check "demo UI test passes" node --test --test-name-pattern "agent entry points" tests/demo.test.mjs
check "demo agent panel shows the notice" grep -q "DEMO_AGENT_NOTICE" app/components/postal/Agent.tsx
check "test: demo hides agent entry points" grep -q "agent entry points" tests/demo.test.mjs
done_checks
