#!/usr/bin/env bash
# Text and icon sizes stay on DESIGN.md's scales.
source "${VERIFY_LIB:-$HOME/Developer/build-pref/scripts/verify_lib.sh}"
check "no 14px text in postal.css" bash -c "! grep -n 'font-size: 14px' app/components/postal/postal.css"
check "no off-scale icon sizes" bash -c "! grep -rnE 'Icon size=\{(11|13|15|18)\}' app"
done_checks
