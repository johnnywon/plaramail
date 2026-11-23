#!/usr/bin/env bash
# The mail view has no hints, chatty empty states or explaining tooltips.
source "${VERIFY_LIB:-$HOME/Developer/build-pref/scripts/verify_lib.sh}"
file_lacks app/components/postal/SearchBar.tsx "try  from:stripe"
file_lacks app/components/postal/ListPane.tsx "Anything you delete lands here first."
file_lacks app/components/postal/ListPane.tsx "Nothing suspicious has arrived."
file_lacks app/components/postal/Reader.tsx "Out of the inbox, kept in Archive"
file_lacks app/components/postal/Reader.tsx "Recoverable from Trash"
file_lacks app/components/postal/ComposeWindow.tsx "Keep writing while you read other mail"
file_lacks app/components/postal/PostalMail.tsx "Nothing was changed."
done_checks
