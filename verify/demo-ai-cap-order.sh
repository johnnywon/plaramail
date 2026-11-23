#!/usr/bin/env bash
# A demo request uses the day's AI allowance only after it passes CSRF.
source "${VERIFY_LIB:-$HOME/Developer/build-pref/scripts/verify_lib.sh}"
check "csrf runs before the AI claim" bash -c 'c=$(grep -n "app.use(\"/api/v1/\*\", csrf)" workers/index.ts | head -1 | cut -d: -f1); a=$(grep -n "claimDemoAiCall(" workers/index.ts | head -1 | cut -d: -f1); [ -n "$c" ] && [ -n "$a" ] && [ "$c" -lt "$a" ]'
check "test: an invalid request leaves the allowance" grep -q "invalid request" tests/demo.test.mjs
done_checks
