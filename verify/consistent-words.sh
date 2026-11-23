#!/usr/bin/env bash
# One word per action, US spelling, and docs that name the Console.
source "${VERIFY_LIB:-$HOME/Developer/build-pref/scripts/verify_lib.sh}"
check "no 'Move to trash' lowercase" bash -c "! grep -rn 'Move to trash' app shared"
check "one name for a new message" bash -c "! grep -rn '\"New email\"' app shared"
check "US spelling" bash -c "! grep -rnE 'Minimise|[Cc]olour|behaviour|cancelled' app shared --include=*.ts --include=*.tsx"
check "workers say address, not mailbox, to the UI" bash -c "! grep -nE 'Mailbox already exists|Some mailboxes could not' workers/index.ts"
check "DESIGN.md names the Console" bash -c "! grep -n '?settings=' DESIGN.md"
done_checks
