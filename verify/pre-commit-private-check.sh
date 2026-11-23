#!/usr/bin/env bash
# The local pre-commit hook finds the deploy repo's pattern list, allows this repo's URL, and fails closed.
source "${VERIFY_LIB:-$HOME/Developer/build-pref/scripts/verify_lib.sh}"
hook="$(git rev-parse --git-common-dir)/hooks/pre-commit"
check "hook installed" test -x "$hook"
check "hook reads the pattern list that exists" bash -c "src=\$(grep -oE '\\\$HOME/[^\"]+private-patterns.sh' '$hook' | head -1); src=\${src/\\\$HOME/\$HOME}; test -f \"\$src\""
check "allow-list names this repo" bash -c "grep '^allowed=' '$hook' | grep -q plaramail"
file_lacks "$hook" "check skipped"
done_checks
