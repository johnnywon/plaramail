#!/usr/bin/env bash
# WON-594: Show the generating model and agent on every AI draft
#
# Done means: every AI-generated draft shows its actual generating model and the relevant
# agent/playbook, with accurate details preserved when the draft is reopened or revised.
# The checks expect the existing DraftNotes path to gain a `model` field.
source "${VERIFY_LIB:-$HOME/Developer/build-pref/scripts/verify_lib.sh}"

check "draft notes keep the model through save and reopen" node --test verify/ai-draft-model-agent-provenance.test.mjs
check "DraftNotes declares a model field" grep -Eq "^\s*model\??:" shared/draft-notes.ts
file_lacks workers/agent/auto-draft.ts '{ origin: "auto-draft", agent: null, instructions: [] }'
file_lacks workers/agent/index.ts 'const CHAT_NOTES: DraftNotes = { origin: "chat", agent: null, instructions: [] };'
file_has app/components/postal/ComposeWindow.tsx "notes.model"
file_has app/components/postal/ComposeWindow.tsx "notes.agent"
check "existing draft tests pass" node --test tests/draft-steer.test.mjs tests/agents.test.mjs tests/agent-drafts.test.mjs

done_checks
