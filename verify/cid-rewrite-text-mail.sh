#!/usr/bin/env bash
# A sender's Content-ID can't break the markup the app writes for text-only mail.
source "${VERIFY_LIB:-$HOME/Developer/build-pref/scripts/verify_lib.sh}"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/case.ts" <<'TS'
import { messageBodyHtml } from "APP/app/lib/utils";
const body = "see https://evil.example/cid:Z for details\nand https://a.example/style=position:fixed// ok\n";
const att = [{ id: "a1", disposition: "inline", content_id: '<Z">https://evil.example/cid:Z</a>>' }] as any;
const out = messageBodyHtml(body, "m@example.com", "e1", att);
const opens = (out.match(/<a /g) || []).length, closes = (out.match(/<\/a>/g) || []).length;
process.exit(opens === closes && !out.includes("/attachments/a1 for") ? 0 : 1);
TS
sed -i '' "s#APP#$PWD#g" "$tmp/case.ts"
check "utils exports messageBodyHtml" grep -q "export function messageBodyHtml" app/lib/utils.ts
check "Reader uses messageBodyHtml" grep -q "messageBodyHtml(raw" app/components/postal/Reader.tsx
check "text-only mail keeps its links whole" bash -c "npx esbuild '$tmp/case.ts' --bundle --platform=node --format=esm --log-level=error --outfile='$tmp/case.mjs' && node '$tmp/case.mjs'"
done_checks
