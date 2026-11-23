#!/usr/bin/env bash
# Copy shows the user's own keys and the right modifier for the platform.
source "${VERIFY_LIB:-$HOME/Developer/build-pref/scripts/verify_lib.sh}"
file_lacks app/components/postal/ListPane.tsx "Press E on any message"
file_lacks app/components/postal/Editor.tsx "Insert link (⌘K)"
check "no hard-coded ⌘ in SearchWindow" bash -c "! grep -n '⌘' app/components/postal/SearchWindow.tsx"
check "no hard-coded keys in Console copy" bash -c "! grep -n 'Keys like ⌘K and E' app/components/postal/Modals.tsx"
done_checks
