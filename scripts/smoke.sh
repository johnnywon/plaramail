#!/usr/bin/env bash
# Post-deploy smoke check. The app sits behind Cloudflare Access, so an
# unauthenticated request must redirect to the Access login. A 200 or a 5xx
# there means Access is off or the Worker is broken. /mcp and /.well-known
# bypass Access: MCP clients sign in with the Worker's own OAuth. /health
# bypasses it too and reports whether D1 and R2 answer.
set -euo pipefail

# Defaults to the first route in wrangler.jsonc; SMOKE_URL overrides it.
cd "$(dirname "$0")/.."
route=$(grep -o '"pattern": *"[^"]*"' wrangler.jsonc | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
BASE="${SMOKE_URL:-https://$route}"
if [[ "$BASE" == "https://" ]]; then
	echo "No route in wrangler.jsonc. Set SMOKE_URL." >&2
	exit 2
fi
fail=0

check() {
	local method="$1" path="$2"
	local out code location
	out=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -X "$method" \
		-H 'content-type: application/json' --max-time 15 "$BASE$path" || true)
	code=${out%% *}
	location=${out#* }
	if [[ "$code" == "302" && "$location" == *".cloudflareaccess.com/"* ]]; then
		printf '  ok   %-5s %s -> Access\n' "$method" "$path"
	else
		printf '  FAIL %-5s %s -> %s\n' "$method" "$path" "$code" >&2
		fail=1
	fi
}

# /mcp answers 401 with an OAuth challenge. An Access redirect means the bypass is missing.
check_mcp() {
	local headers code
	headers=$(curl -s -o /dev/null -D - -X POST -H 'content-type: application/json' \
		-H 'accept: application/json, text/event-stream' --max-time 15 \
		-d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' "$BASE/mcp" || true)
	code=$(printf '%s' "$headers" | awk 'NR==1{print $2}')
	if [[ "$code" == "401" ]] && printf '%s' "$headers" | grep -qi '^www-authenticate: *Bearer.*resource_metadata='; then
		printf '  ok   %-5s %s -> OAuth challenge\n' POST /mcp
	elif [[ "$code" == "302" ]]; then
		printf '  FAIL %-5s %s -> Access. Add the Access bypass for /mcp and /.well-known (docs/setup.md, step 5)\n' POST /mcp >&2
		fail=1
	else
		printf '  FAIL %-5s %s -> %s\n' POST /mcp "$code" >&2
		fail=1
	fi
}

# OAuth metadata loads without Access, as JSON naming this host.
check_metadata() {
	local path="$1" field="$2" body code
	body=$(curl -s -w '\n%{http_code}' --max-time 15 "$BASE$path" || true)
	code=${body##*$'\n'}
	body=${body%$'\n'*}
	if [[ "$code" == "200" ]] && printf '%s' "$body" | grep -q "\"$field\": *\"$BASE"; then
		printf '  ok   %-5s %s -> metadata\n' GET "$path"
	else
		printf '  FAIL %-5s %s -> %s\n' GET "$path" "$code" >&2
		fail=1
	fi
}

# The two OAuth documents list the same scopes, so a client reading either can ask for mail.send,
# and client ID metadata documents are on (they need the global_fetch_strictly_public flag).
check_oauth_documents() {
	local resource server problem
	resource=$(curl -s --max-time 15 "$BASE/.well-known/oauth-protected-resource/mcp" || true)
	server=$(curl -s --max-time 15 "$BASE/.well-known/oauth-authorization-server" || true)
	problem=$(RESOURCE="$resource" SERVER="$server" node -e '
		const read = (text) => { try { return JSON.parse(text); } catch { return {}; } };
		const r = read(process.env.RESOURCE), s = read(process.env.SERVER);
		const a = JSON.stringify(r.scopes_supported ?? []), b = JSON.stringify(s.scopes_supported ?? []);
		if (a !== b) console.log(`scopes differ: resource ${a}, server ${b}`);
		else if (s.client_id_metadata_document_supported !== true) console.log("client_id_metadata_document_supported is not true. Add the global_fetch_strictly_public compatibility flag (docs/setup.md)");
	')
	if [[ -z "$problem" ]]; then
		printf '  ok   %-5s %s\n' GET "OAuth scopes and client ID metadata documents"
	else
		printf '  FAIL %-5s %s\n' GET "OAuth documents: $problem" >&2
		fail=1
	fi
}

# /health answers 200 with {"ok":true} when D1 and R2 answer, 503 naming the store that failed.
check_health() {
	local body code
	body=$(curl -s -w '\n%{http_code}' --max-time 15 "$BASE/health" || true)
	code=${body##*$'\n'}
	body=${body%$'\n'*}
	if [[ "$code" == "200" ]] && printf '%s' "$body" | grep -q '"ok": *true'; then
		printf '  ok   %-5s %s -> D1 and R2\n' GET /health
	elif [[ "$code" == "302" ]]; then
		printf '  FAIL %-5s %s -> Access. Add /health to the Access bypass (docs/setup.md, step 5)\n' GET /health >&2
		fail=1
	else
		printf '  FAIL %-5s %s -> %s %s\n' GET /health "$code" "$body" >&2
		fail=1
	fi
}

echo "Smoke: $BASE"
check GET /
check GET /api/v1/mail
check GET /api/v1/labels
check POST /api/v1/mail/bulk
check GET /authorize
check_health
check_mcp
check_metadata /.well-known/oauth-authorization-server issuer
check_metadata /.well-known/oauth-protected-resource/mcp resource
check_oauth_documents
exit "$fail"
