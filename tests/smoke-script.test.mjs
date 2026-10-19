import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { promisify } from "node:util";

// scripts/smoke.sh against a stand-in for a deployment: the app behind Access, /mcp and /.well-known past it.

const run = promisify(execFile);

async function serve(bypass, { resourceScopes = ["mail", "mail.send"], cimd = true } = {}) {
	const server = createServer((req, res) => {
		const base = `http://127.0.0.1:${server.address().port}`;
		const path = req.url.split("?")[0];
		const open = bypass && (path === "/mcp" || path.startsWith("/.well-known/"));
		if (!open) return res.writeHead(302, { location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/host" }).end();
		if (path === "/mcp") return res.writeHead(401, { "www-authenticate": `Bearer realm="OAuth", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` }).end();
		const metadata = path.endsWith("/mcp")
			? { resource: `${base}/mcp`, scopes_supported: resourceScopes }
			: { issuer: base, scopes_supported: ["mail", "mail.send"], client_id_metadata_document_supported: cimd };
		res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(metadata));
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	return server;
}

async function smoke(server) {
	const env = { ...process.env, SMOKE_URL: `http://127.0.0.1:${server.address().port}` };
	try {
		const { stdout } = await run("bash", ["scripts/smoke.sh"], { env });
		return { code: 0, out: stdout };
	} catch (e) {
		return { code: e.code, out: e.stdout + e.stderr };
	}
}

test("smoke passes when the app is behind Access and MCP sign-in is reachable", async () => {
	const server = await serve(true);
	try {
		const { code, out } = await smoke(server);
		assert.equal(code, 0, out);
		assert.match(out, /POST  \/mcp -> OAuth challenge/);
		assert.match(out, /\/authorize -> Access/);
	} finally {
		server.close();
	}
});

test("smoke fails and names the bypass when Access still blocks /mcp", async () => {
	const server = await serve(false);
	try {
		const { code, out } = await smoke(server);
		assert.equal(code, 1);
		assert.match(out, /Add the Access bypass for \/mcp and \/.well-known/);
	} finally {
		server.close();
	}
});

test("smoke checks both OAuth documents list the same scopes (#44)", async () => {
	const server = await serve(true, { resourceScopes: ["mail"] });
	try {
		const { code, out } = await smoke(server);
		assert.equal(code, 1);
		assert.match(out, /FAIL .*scopes differ: resource \["mail"\], server \["mail","mail.send"\]/);
	} finally {
		server.close();
	}
});

test("smoke checks client ID metadata documents are supported (#31)", async () => {
	const server = await serve(true, { cimd: false });
	try {
		const { code, out } = await smoke(server);
		assert.equal(code, 1);
		assert.match(out, /FAIL .*client_id_metadata_document_supported is not true. Add the global_fetch_strictly_public compatibility flag/);
	} finally {
		server.close();
	}
});
