#!/usr/bin/env bash
# README screenshots are reshot from the current UI (the demo's sample inbox).
source "${VERIFY_LIB:-$HOME/Developer/build-pref/scripts/verify_lib.sh}"
check "inbox screenshot replaced" bash -c '[ "$(shasum -a 256 docs/images/inbox.jpg | cut -c1-64)" != "de8f8b0e908ce9c5d41aa2952ca3bd3c6c8759d686f8a9f6ee7e164e770323b5" ]'
check "mobile screenshot replaced" bash -c '[ "$(shasum -a 256 docs/images/mobile.jpg | cut -c1-64)" != "32e2cc961495c4308bc63833beabd147abb25a1fff7e72caa1b952acc0166d00" ]'
check "every README image exists" bash -c 'for f in $(grep -oE "docs/images/[a-z-]+\.jpg" README.md | sort -u); do [ -f "$f" ] || exit 1; done'
done_checks
