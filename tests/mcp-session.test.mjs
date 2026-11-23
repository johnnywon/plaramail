import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// A session's tools are set from the token that opened it, so another token can't reuse it.

const { bindSessions, narrowProps, sessionOwner } = await loadTs("workers/mcp/session.ts");

const kv = () => {
	const m = new Map();
	return { map: m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } };
};
const grant = (scopes) => ({ userId: "owner", clientId: "c1", clientName: "Client", scopes });
let next = 0;
const inner = { fetch: async (request) => new Response("ok", { headers: request.headers.get("mcp-session-id") ? {} : { "mcp-session-id": `s${++next}` } }) };
const call = (handler, env, props, sessionId) =>
	handler.fetch(new Request("https://example.com/mcp", { method: "POST", headers: sessionId ? { "mcp-session-id": sessionId } : {} }), env, { props });

test("a session opened with Send refuses a token without it", async () => {
	const env = { OAUTH_KV: kv() };
	const mcp = bindSessions(inner);
	const opened = await call(mcp, env, grant(["mail", "mail.send"]));
	const sid = opened.headers.get("mcp-session-id");
	assert.equal((await call(mcp, env, grant(["mail", "mail.send"]), sid)).status, 200);
	const reused = await call(mcp, env, grant(["mail"]), sid);
	assert.equal(reused.status, 404);
	assert.match(await reused.text(), /Session not found/);
	assert.equal((await call(mcp, env, { ...grant(["mail", "mail.send"]), clientId: "c2" }, sid)).status, 404);
	assert.equal((await call(mcp, env, grant(["mail"]), "never-opened")).status, 404);
});

test("a token narrowed to mail loses the send scope", () => {
	assert.deepEqual(narrowProps({ props: grant(["mail", "mail.send"]), requestedScope: ["mail"] }), { accessTokenProps: grant(["mail"]) });
	assert.equal(narrowProps({ props: grant(["mail", "mail.send"]), requestedScope: ["mail", "mail.send"] }), undefined);
	assert.equal(sessionOwner(grant(["mail.send", "mail"])), sessionOwner(grant(["mail", "mail.send"])));
});
