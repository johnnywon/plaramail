#!/usr/bin/env bash
# WON-596: Show /health with the Console MCP page bypass paths
#
# Done means: the MCP page lists /health with the other bypass paths and says when Access still
# blocks it.
source "${VERIFY_LIB:-$HOME/Developer/build-pref/scripts/verify_lib.sh}"

check "MCP page code lists /health" bash -c 'grep -qF "/health" app/components/postal/McpTab.tsx || grep -qF "\"/health\"" app/components/postal/mcp-access.ts'
file_lacks app/components/postal/McpTab.tsx "these two paths"
check "bypass check tests pass (tests/mcp-bypass.test.mjs)" node --test tests/mcp-bypass.test.mjs
file_lacks docs/setup.md "shows the two paths"

done_checks
