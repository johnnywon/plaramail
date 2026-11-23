#!/usr/bin/env bash
# The hourly reset keys off the cron's scheduled time and can't overlap a first-request seed.
source "${VERIFY_LIB:-$HOME/Developer/build-pref/scripts/verify_lib.sh}"
file_has workers/app.ts "scheduledTime"
check "test: a first request during the reset doesn't seed twice" grep -q "during the reset" tests/demo.test.mjs
done_checks
