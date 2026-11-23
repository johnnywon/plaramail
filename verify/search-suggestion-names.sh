#!/usr/bin/env bash
# Search suggestions and filter options carry accessible names with their parts separated.
source "${VERIFY_LIB:-$HOME/Developer/build-pref/scripts/verify_lib.sh}"
check "suggestion option has its own aria-label" node -e '
const s = require("fs").readFileSync("app/components/postal/SearchWindow.tsx", "utf8");
const i = s.indexOf("role=\"option\""); const tag = s.slice(s.lastIndexOf("<", i), s.indexOf(">", i));
process.exit(/aria-label=/.test(tag) ? 0 : 1);'
check "agent-readable test covers search suggestions" grep -q "SearchWindow" tests/agent-readable.test.mjs
done_checks
