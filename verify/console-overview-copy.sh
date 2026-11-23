#!/usr/bin/env bash
# The console has no helper sentences, subtitles or false claims.
source "${VERIFY_LIB:-$HOME/Developer/build-pref/scripts/verify_lib.sh}"
file_lacks app/components/postal/OverviewTab.tsx "Limits are set in Limits"
file_lacks app/components/postal/OverviewTab.tsx "Sends per address against the limits."
file_lacks app/components/postal/Modals.tsx "saved to your deployment"
file_lacks app/components/postal/Modals.tsx "Dark is the default"
file_lacks app/components/postal/Modals.tsx "Nothing is sent while you"
file_lacks app/components/postal/StorageTab.tsx "Messages per address."
file_lacks app/components/postal/Agent.tsx "Ask about your mail. The agent reads"
done_checks
