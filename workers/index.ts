// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Context, Hono } from "hono";
import pkg from "../package.json";
import { cors } from "hono/cors";
import { parseMail } from "./lib/parse-mail";
import { bounceLink } from "./lib/bounce";
import { z } from "zod";
import { generateText } from "ai";
import { deleteAttachmentFiles, type StoredAttachment } from "./lib/attachments";
import { ensureDevMail, seedMail, seedProfile } from "./lib/dev-seed";
import { claimDemoAiCall, DEMO, demoAiCap, demoRefusal } from "./lib/demo";
import {
	validateSender,
	SenderValidationError,
	stripHtmlToText,
} from "./lib/email-helpers";
import { checkSendAt, ScheduleBody, SCHEDULE_MAX_PAYLOAD_BYTES } from "./lib/scheduled-send";
import { handleReplyEmail, handleForwardEmail, handleSendEmail } from "./routes/reply-forward";
import { Folders } from "../shared/folders";
import type { Env } from "./types";
import { interpretSearch, MAX_REQUEST_LENGTH } from "./lib/search-interpret";
import { HeaderValueSchema, MailboxSettingsSchema } from "./lib/schemas";
import { readPrefs, writePrefs } from "./lib/prefs";
import { agentModel } from "./lib/agent-model";
import { catalogFor, clearCatalogCache, languageModel, mergeAgentModelConfig, openRouterZdr, quickModel, readAgentModelConfig, viewOf, writeAgentModelConfig } from "./lib/agent-model";
import { KEYED_PROVIDERS, PROVIDERS, PROVIDER_INFO, RECOMMENDED_MODEL, SUGGESTED_MODELS, validModelId } from "../shared/models";
import { requireMailbox, type MailboxContext } from "./lib/mailbox";
import { csrf } from "./lib/csrf";
import { decodeCursor, InvalidFilterError } from "./lib/mail-index-sql";
import { parseMailParams } from "./lib/mail-filter-params";
import { MAX_SEARCH_LENGTH } from "../shared/search-query";
import { mailboxIds, mailStore, storageStatus, recordsSql } from "./store";
import { MOVE_FOLDERS } from "./lib/mail-bulk-sql";
import { automatedMailReason } from "./lib/message-meta";
import { resolveThreadId } from "./lib/threading";
import { configuredAddresses } from "./lib/addresses";
import { dryRunFolderImport, importDeps, runFolderImport } from "./lib/folder-import";
import { startAutoDraft } from "./agent/queue";
import { listRuns } from "./agent/runs";
import { readAgentLimits, writeAgentLimits } from "./lib/agent-limits";
import { agentOverview } from "./lib/agent-overview";
import { getSystemPrompt } from "./agent/prompt";
import { ACTIVITY_ACTORS, listActivity, logged, mcpUsage, TOOL_ACTIONS } from "./lib/activity";
import { verifyDraft } from "./lib/ai";
import { AgentBody, agentStats, createAgent, deleteAgent, listAgentDrafts, listAgents, matchAgents, orderAgents, updateAgent } from "./lib/agents";
import { redraft } from "./lib/redraft";
import { seedAgents } from "./lib/dev-seed-agents";
import { REDRAFT_INSTRUCTION_MAX } from "../shared/draft-notes";

type AppContext = Context<MailboxContext>;

// -- Request body schemas (kept for validation) ---------------------

const CreateMailboxBody = z.object({
	email: z.string().email(),
	name: z.string().min(1).max(200),
	settings: MailboxSettingsSchema.optional(),
});

const UpdateMailboxBody = z.object({
	settings: MailboxSettingsSchema,
});

const DraftBody = z.object({
	to: z.string().optional(),
	cc: z.string().optional(),
	bcc: z.string().optional(),
	subject: HeaderValueSchema.optional(),
	body: z.string(),
	in_reply_to: HeaderValueSchema.optional(),
	thread_id: HeaderValueSchema.optional(),
	draft_id: z.string().optional(),
});

const BulkBody = z.object({
	target: z.union([
		z.object({ threadKeys: z.array(z.string().min(1).max(600)).min(1).max(500), view: z.string().max(100) }),
		z.object({ filter: z.string().max(8000), asOf: z.string().datetime(), expectedCount: z.number().int().min(0) }),
	]),
	action: z.discriminatedUnion("type", [
		z.object({ type: z.enum(["archive", "trash", "restore", "read", "unread", "star", "unstar"]) }),
		z.object({ type: z.literal("move"), folder: z.enum(MOVE_FOLDERS) }),
		z.object({ type: z.enum(["label_add", "label_remove"]), labelId: z.string().min(1).max(100) }),
	]),
});

const LabelBody = z.object({ name: z.string().max(200).optional(), color: z.string().max(20).optional() });

// -- Helpers --------------------------------------------------------

// -- App & middleware -----------------------------------------------

const app = new Hono<MailboxContext>();
app.use("/api/*", cors({
	origin: (origin) => {
		// Same-origin requests have no Origin header — allow them.
		if (!origin) return origin;
		// In development, allow localhost for Vite dev server.
		if (import.meta.env?.DEV) {
			try {
				const url = new URL(origin);
				if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
			} catch { /* invalid origin */ }
		}
		// Block all other cross-origin requests. The app is served from the
		// same origin as the API, so legitimate browser requests never send
		// an Origin header. Returning undefined omits Access-Control-Allow-Origin.
		return undefined;
	},
}));
// Local QA and demo builds: the first API request fills an empty inbox with sample mail (workers/lib/dev-seed).
if (import.meta.env?.DEV || DEMO) {
	app.use("/api/v1/*", async (c, next) => {
		await ensureDevMail(c.env);
		await next();
	});
}
// A demo build refuses sends, AI and settings changes (workers/lib/demo).
if (DEMO) {
	app.use("/api/v1/*", async (c, next) => {
		const refused = demoRefusal(c.req.method, c.req.path);
		if (refused) return c.json({ error: refused }, 403);
		await next();
	});
}
app.use("/api/v1/*", csrf);
app.use("/api/v1/mailboxes/:mailboxId/*", requireMailbox);

// -- Config ---------------------------------------------------------

app.get("/api/v1/config", (c) => {
	const domainsRaw = c.env.DOMAINS || "";
	const domains = domainsRaw.split(",").map((d) => d.trim()).filter(Boolean);
	const emailAddresses = configuredAddresses(c.env);
	// Agents run on new mail on every deployment but a demo; which mail is up to each agent.
	const autoDraft = !DEMO;
	// The colophon: the running version and when it was deployed (null without the version_metadata binding).
	const deployedAt = c.env.CF_VERSION_METADATA?.timestamp ?? null;
	return c.json({ domains, emailAddresses, autoDraft, demo: DEMO, version: pkg.version, deployedAt });
});

// Local QA only (import.meta.env.DEV is false in production builds, so none of this exists there).
if (import.meta.env?.DEV) {
	// A lived-in sample inbox: wipe the sample mail and write it again. Mail you made yourself stays.
	// Body (all optional): { "profile": "default" or "alex", "tzOffset": minutes behind UTC, "extra": plain messages to add for long lists }.
	app.post("/api/v1/dev/seed", async (c) => {
		const { profile, tzOffset, extra } = (await c.req.json().catch(() => ({}))) as { profile?: unknown; tzOffset?: unknown; extra?: unknown };
		return c.json(await seedMail(c.env, {
			profile: seedProfile(c.env, profile),
			tzOffset: typeof tzOffset === "number" ? tzOffset : undefined,
			extra: Math.min(Math.max(Number(extra) || 0, 0), 5000),
		}));
	});
}

// Local QA and demo builds: links in the sample mail open this page instead of leaving the app.
if (import.meta.env?.DEV || DEMO) {
	app.get("/api/v1/sample-link", (c) => {
		const to = (c.req.query("to") ?? "").slice(0, 2000).replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
		c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
		return c.html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sample link</title><body style="font:15px/1.5 system-ui,sans-serif;margin:40px 16px;max-width:600px;color:#1f2933;background:#ffffff"><p>A link in the sample mail. It goes nowhere in the demo.</p><p style="word-break:break-all"><code>${to}</code></p></body></html>`);
	});

	// A crew of agents mid-work: runs in every state, drafts in Review, a Logs trail.
	app.post("/api/v1/dev/seed-agents", async (c) => c.json(await seedAgents(c.env)));
}

// -- Agent model ----------------------------------------------------

// -- Preferences (Settings > General) ------------------------------

app.get("/api/v1/prefs", async (c) => c.json(await readPrefs(c.env)));

app.put("/api/v1/prefs", async (c) => {
	const body = await c.req.json().catch(() => null);
	if (!body || typeof body !== "object") return c.json({ error: "Send the preferences as a JSON object" }, 400);
	return c.json({ prefs: await writePrefs(c.env, body), saved: true });
});

app.get("/api/v1/agent-model", async (c) => {
	return c.json(viewOf(await readAgentModelConfig(c.env)));
});

const ModelRefBody = z.object({ provider: z.enum(PROVIDERS), id: z.string().max(200) });

const AgentModelBody = z.object({
	selected: ModelRefBody.nullable().optional(),
	keys: z.record(z.string(), z.string().max(500)).optional(),
});

/**
 * A typed id must be in its provider's allowed catalog: on Cloudflare, priced
 * models that aren't partner models; on OpenRouter, paid models. So a typed
 * id can't reach a free or third-party model. When the catalog can't be read
 * the id is let through; on Cloudflare the agent then falls back to the
 * recommended model if it isn't listed, and on OpenRouter the request asks
 * for a zero retention endpoint and fails without one.
 */
async function notAllowed(env: Env, ref: { provider: string; id: string }, keys: Parameters<typeof catalogFor>[2]): Promise<string | null> {
	const catalog = await catalogFor(env, ref.provider === "workers-ai" ? "workers-ai" : "openrouter", keys);
	if (catalog.source === "none" || catalog.models.some((m) => m.id === ref.id)) return null;
	return ref.provider === "workers-ai"
		? "That Cloudflare model isn't allowed. Only priced models that aren't partner models can be used."
		: "That OpenRouter model isn't allowed. Only paid models can be used.";
}

app.put("/api/v1/agent-model", async (c) => {
	const body = AgentModelBody.parse(await c.req.json());
	const next = mergeAgentModelConfig(await readAgentModelConfig(c.env), body);
	if ("error" in next) return c.json({ error: next.error }, 400);
	if (body.selected && next.selected) {
		const refused = await notAllowed(c.env, next.selected, next.keys);
		if (refused) return c.json({ error: refused }, 400);
	}
	await writeAgentModelConfig(c.env, next);
	if (body.keys) clearCatalogCache();
	return c.json(viewOf(next));
});

const TestBody = z.object({ provider: z.enum(PROVIDERS), id: z.string().max(200), key: z.string().max(500).optional() });

/** Send one short prompt to a model, with the given key or the saved one. */
app.post("/api/v1/agent-model/test", async (c) => {
	const body = TestBody.parse(await c.req.json());
	const label = PROVIDER_INFO[body.provider].label;
	if (!validModelId(body.provider, body.id.trim())) return c.json({ ok: false, error: `That isn't a ${label} model id.` }, 400);
	const stored = await readAgentModelConfig(c.env);
	const key = body.provider === "workers-ai" ? undefined : body.key?.trim() || stored.keys[body.provider];
	if (body.provider !== "workers-ai" && !key) return c.json({ ok: false, error: `Add your ${label} key first.` }, 400);
	const refused = await notAllowed(c.env, { provider: body.provider, id: body.id.trim() }, stored.keys);
	if (refused) return c.json({ ok: false, error: refused }, 400);
	const started = Date.now();
	try {
		const result = await generateText({
			model: languageModel(c.env, { provider: body.provider, id: body.id.trim() }, key, body.provider === "openrouter" ? { zdr: await openRouterZdr(c.env, body.id.trim()) } : {}),
			prompt: "Reply with the single word OK.",
			maxOutputTokens: 400,
		});
		return c.json({ ok: true, reply: result.text.trim().slice(0, 80), ms: Date.now() - started });
	} catch (e) {
		return c.json({ ok: false, error: (e as Error).message.slice(0, 300) }, 502);
	}
});

/**
 * Every provider's models, with price per million tokens and context size
 * where the provider or OpenRouter publishes them. Nothing here limits what
 * can be saved: any id shaped right for its provider is accepted.
 */
app.get("/api/v1/agent-model/catalog", async (c) => {
	const { keys } = await readAgentModelConfig(c.env);
	const entries = await Promise.all(PROVIDERS.map(async (p) => [p, await catalogFor(c.env, p, keys)] as const));
	return c.json({
		recommended: RECOMMENDED_MODEL,
		suggested: SUGGESTED_MODELS.map(({ provider, id, role }) => ({ provider, id, role })),
		providers: Object.fromEntries(entries),
		keyed: KEYED_PROVIDERS.filter((p) => !!keys[p]),
	});
});

// -- Mailboxes ------------------------------------------------------

app.get("/api/v1/mailboxes", async (c) => {
	const allMailboxes = await mailStore(c.env).mailboxes.list();
	return c.json(allMailboxes.map((m) => ({ ...m, name: m.id })));
});

app.post("/api/v1/mailboxes", async (c) => {
	const parsed = CreateMailboxBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, 400);
	const { name, settings, email: rawEmail } = parsed.data;
	const email = rawEmail.toLowerCase();
	const allowedAddresses = configuredAddresses(c.env);
	if (allowedAddresses.length > 0 && !allowedAddresses.map((a) => a.toLowerCase()).includes(email)) {
		return c.json({ error: "Mailbox creation is restricted to configured EMAIL_ADDRESSES" }, 403);
	}
	if (await mailStore(c.env).mailboxes.exists(email)) return c.json({ error: "That address already exists" }, 409);
	const finalSettings = await createMailbox(c.env, email, name, settings);
	return c.json({ id: email, email, name, settings: finalSettings }, 201);
});

/** Create a mailbox with default settings. */
async function createMailbox(env: Env, email: string, name: string, settings?: z.infer<typeof MailboxSettingsSchema>) {
	const defaultSettings = { fromName: name, forwarding: { enabled: false, email: "" }, signature: { enabled: false, text: "" }, autoReply: { enabled: false, subject: "", message: "" } };
	const finalSettings = { ...defaultSettings, ...settings };
	await mailStore(env).mailboxes.put(email, finalSettings);
	return finalSettings;
}

app.get("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const settings = await mailStore(c.env).mailboxes.get(mailboxId);
	if (!settings) return c.json({ error: "Not found" }, 404);
	return c.json({ id: mailboxId, name: mailboxId, email: mailboxId, settings });
});

app.put("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const parsed = UpdateMailboxBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, 400);
	const { settings } = parsed.data;
	const mailboxes = mailStore(c.env).mailboxes;
	if (!(await mailboxes.exists(mailboxId))) return c.json({ error: "Not found" }, 404);
	await mailboxes.put(mailboxId, settings);
	return c.json({ id: mailboxId, name: mailboxId, email: mailboxId, settings });
});

// -- Unified mail --------------------------------------------------

function parseMailRequest(url: string) {
	const parsed = parseMailParams(new URL(url).searchParams);
	if (parsed.cursor) decodeCursor(parsed.cursor);
	return parsed;
}

app.get("/api/v1/mail", async (c) => {
	try {
		const { filter, cursor, limit } = parseMailRequest(c.req.url);
		return c.json(await mailStore(c.env).all().queryMail(filter, { cursor, limit }));
	} catch (error) {
		if (error instanceof InvalidFilterError) return c.json({ error: error.message }, 400);
		throw error;
	}
});

app.get("/api/v1/mail/facets", async (c) => {
	try {
		const { filter } = parseMailRequest(c.req.url);
		return c.json(await mailStore(c.env).all().queryFacets(filter));
	} catch (error) {
		if (error instanceof InvalidFilterError) return c.json({ error: error.message }, 400);
		throw error;
	}
});

/** Scheduled sends across every configured mailbox, soonest first. */
app.get("/api/v1/mail/scheduled", async (c) => {
	const ids = await mailboxIds(c.env);
	const lists = await Promise.all(ids.map(async (mailboxId) => {
		const rows = await mailStore(c.env).mailbox(mailboxId).listScheduled().catch((e) => {
			console.error(`scheduled list failed for ${mailboxId}:`, (e as Error).message);
			return [];
		});
		return rows.map((row) => ({ mailboxId, emailId: row.emailId, sendAt: row.sendAt, error: row.error }));
	}));
	return c.json(lists.flat().sort((a, b) => a.sendAt.localeCompare(b.sendAt)));
});

app.get("/api/v1/mail/folders", async (c) => c.json(await mailStore(c.env).all().folderViews()));

/** Message counts per address, for the Storage page. */
app.get("/api/v1/storage/status", async (c) => c.json(await storageStatus(c.env, await mailboxIds(c.env))));

// -- Console > Limits and Overview ----------------------------------

app.get("/api/v1/agent-limits", async (c) => c.json(await readAgentLimits(c.env)));

/** Agent limits. Only people set them here; no agent or MCP tool can. Out-of-range values keep what was saved. */
app.put("/api/v1/agent-limits", async (c) => {
	const body = await c.req.json().catch(() => null);
	if (!body || typeof body !== "object") return c.json({ error: "Send the limits as a JSON object" }, 400);
	return c.json(await writeAgentLimits(c.env, body));
});

app.get("/api/v1/agents/overview", async (c) =>
	c.json(await agentOverview(recordsSql(c.env), await mailboxIds(c.env), await readAgentLimits(c.env))));

// -- Agents (Console > Agents) ---------------------------------------

app.get("/api/v1/agents", async (c) => {
	const sql = recordsSql(c.env);
	const [agents, stats] = await Promise.all([listAgents(sql), agentStats(sql)]);
	return c.json({ agents, stats });
});

/** Agent drafts waiting in Drafts. */
app.get("/api/v1/agents/review", async (c) => c.json(await listAgentDrafts(recordsSql(c.env), await mailboxIds(c.env))));

app.post("/api/v1/agents", async (c) => {
	const parsed = AgentBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid agent" }, 400);
	const result = await createAgent(recordsSql(c.env), parsed.data);
	return "error" in result ? c.json({ error: result.error }, 400) : c.json(result.agent, 201);
});

/** The list order: ids first to last. */
app.put("/api/v1/agents/order", async (c) => {
	const parsed = z.object({ ids: z.array(z.string()).max(100) }).safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid order" }, 400);
	await orderAgents(recordsSql(c.env), parsed.data.ids);
	return c.json({ ok: true });
});

app.put("/api/v1/agents/:id", async (c) => {
	const parsed = AgentBody.partial().safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid agent" }, 400);
	const result = await updateAgent(recordsSql(c.env), c.req.param("id"), parsed.data);
	if ("error" in result) return c.json({ error: result.error }, 400);
	return result.agent ? c.json(result.agent) : c.json({ error: "Not found" }, 404);
});

app.delete("/api/v1/agents/:id", async (c) => {
	const deleted = await deleteAgent(recordsSql(c.env), c.req.param("id"));
	return deleted ? c.json({ deleted: true }) : c.json({ error: "Not found" }, 404);
});

/** One agent's latest runs. */
app.get("/api/v1/agents/:id/runs", async (c) =>
	c.json(await listRuns(recordsSql(c.env), { agentId: c.req.param("id"), limit: Number(c.req.query("limit")) || 50 })));

// -- Activity (Console > Activity) -----------------------------------

/** What agents and MCP clients did, newest first. Filter by mailbox, actor and action; page with before=<last id>. */
app.get("/api/v1/activity", async (c) => {
	const pick = (name: string, allowed: readonly string[]) => {
		const v = c.req.query(name);
		return v && allowed.includes(v) ? v : null;
	};
	const before = Number(c.req.query("before"));
	return c.json(await listActivity(recordsSql(c.env), {
		mailboxId: c.req.query("mailbox") || null,
		actor: pick("actor", ACTIVITY_ACTORS),
		action: pick("action", Object.values(TOOL_ACTIONS)),
		before: Number.isInteger(before) && before > 0 ? before : null,
		limit: Number(c.req.query("limit")) || undefined,
	}));
});

/** MCP clients that have called, and calls per tool, for Console > MCP. */
app.get("/api/v1/mcp/usage", async (c) => c.json(await mcpUsage(recordsSql(c.env))));

// Apps the signed-in person connected over OAuth (workers/mcp/authorize.ts), and revoking one.
app.get("/api/v1/mcp/apps", async (c) => {
	const oauth = c.env.OAUTH_PROVIDER;
	if (!oauth) return c.json({ apps: [] });
	const { items } = await oauth.listUserGrants(encodeURIComponent(c.get("viewer") ?? "local"));
	const apps = items.map((g) => ({
		id: g.id, clientId: g.clientId, name: String(g.metadata?.clientName ?? g.clientId), scopes: g.scope,
		connectedAt: new Date(g.createdAt * 1000).toISOString(),
	}));
	return c.json({ apps });
});
app.delete("/api/v1/mcp/apps/:id", async (c) => {
	const oauth = c.env.OAUTH_PROVIDER;
	if (!oauth) return c.json({ error: "Not found" }, 404);
	await oauth.revokeGrant(c.req.param("id"), encodeURIComponent(c.get("viewer") ?? "local"));
	return c.json({ ok: true });
});

/** The latest auto-draft runs, with their state and any skip reason or error. */
app.get("/api/v1/auto-draft/runs", async (c) =>
	c.json(await listRuns(recordsSql(c.env), { mailboxId: c.req.query("mailbox") || null, limit: Number(c.req.query("limit")) || undefined })));

// -- Bulk actions ---------------------------------------------------

app.post("/api/v1/mail/bulk", async (c) => {
	const parsed = BulkBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid bulk request" }, 400);
	const { target, action } = parsed.data;
	try {
		const resolved = "threadKeys" in target
			? { threadKeys: target.threadKeys, view: parseMailParams(new URLSearchParams({ view: target.view })).filter.view }
			: { filter: parseMailParams(new URLSearchParams(target.filter)).filter, asOf: target.asOf, expectedCount: target.expectedCount };
		const result = await mailStore(c.env).all().bulk(resolved, action);
		if ("conflict" in result) return c.json({ error: "The list changed. Check the selection and try again.", count: result.conflict }, 409);
		if ("job" in result) return c.json(result.job, 202);
		return c.json(result);
	} catch (error) {
		if (error instanceof InvalidFilterError) return c.json({ error: error.message }, 400);
		throw error;
	}
});

app.post("/api/v1/mail/bulk/undo", async (c) => {
	const { undoId } = (await c.req.json().catch(() => ({}))) as { undoId?: unknown };
	if (typeof undoId !== "string" || !undoId) return c.json({ error: "undoId is required" }, 400);
	const result = await mailStore(c.env).all().undo(undoId);
	return result ? c.json(result) : c.json({ error: "Nothing to undo. Undo lasts one hour." }, 404);
});

app.get("/api/v1/mail/bulk/jobs/:id", async (c) => {
	const job = await mailStore(c.env).all().bulkJob(c.req.param("id"));
	return job ? c.json(job) : c.json({ error: "Not found" }, 404);
});

app.get("/api/v1/mail/trash", async (c) => c.json(await mailStore(c.env).all().trashCount()));

/** Permanently delete everything in Trash. No undo; the count must match what the user confirmed. */
app.post("/api/v1/mail/empty-trash", async (c) => {
	const { expectedCount } = (await c.req.json().catch(() => ({}))) as { expectedCount?: unknown };
	if (typeof expectedCount !== "number" || !Number.isInteger(expectedCount) || expectedCount < 0) {
		return c.json({ error: "expectedCount is required" }, 400);
	}
	const result = await mailStore(c.env).all().emptyTrash(expectedCount);
	if ("conflict" in result) return c.json({ error: "Trash changed. Check the count and try again.", count: result.conflict }, 409);
	if ("job" in result) return c.json(result.job, 202);
	return c.json(result);
});

// -- Search window --------------------------------------------------

/** Suggestions for the search window. The view and chips come as for /mail; `q` is the box and `at` the cursor. */
app.get("/api/v1/search/suggest", async (c) => {
	const url = new URL(c.req.url);
	const text = (url.searchParams.get("q") ?? "").slice(0, MAX_SEARCH_LENGTH);
	url.searchParams.delete("q");
	const at = Number(url.searchParams.get("at") ?? -1);
	try {
		const { filter } = parseMailRequest(url.toString());
		return c.json(await mailStore(c.env).all().suggest(filter, text, Number.isInteger(at) ? at : -1));
	} catch (error) {
		if (error instanceof InvalidFilterError) return c.json({ error: error.message }, 400);
		throw error;
	}
});

/** Compose suggestions for a recipient field (WON-216): `q` is what is typed. Your own addresses are left out. */
app.get("/api/v1/contacts", async (c) => {
	const q = (new URL(c.req.url).searchParams.get("q") ?? "").slice(0, 100);
	const store = mailStore(c.env);
	const own = [...configuredAddresses(c.env), ...(await store.mailboxes.list()).map((m) => m.id)];
	return c.json({ contacts: await store.all().contacts(q, own) });
});

/**
 * "Ask in plain words": one model call turns the request into search text.
 * The text comes back for the box; nothing runs here. A failure returns the
 * request itself as the query, for a word search.
 */
/**
 * A demo counts its two AI actions against DEMO_AI_DAILY. Handlers call this once
 * the request is valid, so refused and malformed requests don't use the allowance.
 */
async function demoAiAllowed(env: Env): Promise<boolean> {
	return !DEMO || claimDemoAiCall(recordsSql(env), demoAiCap(env.DEMO_AI_DAILY));
}
const DEMO_AI_USED_UP = "The demo's AI calls for today are used up";

app.post("/api/v1/search/interpret", async (c) => {
	const body = z.object({ text: z.string().max(MAX_REQUEST_LENGTH * 2), tz: z.number().int().min(-900).max(900).optional() })
		.safeParse(await c.req.json().catch(() => null));
	if (!body.success) return c.json({ error: "Invalid request" }, 400);
	if (!(await demoAiAllowed(c.env))) return c.json({ error: DEMO_AI_USED_UP }, 429);
	const [labels, addresses] = await Promise.all([mailStore(c.env).all().listLabels(), mailboxIds(c.env)]);
	// The model is made inside the guarded call, so a missing binding falls back to a word search like any model failure.
	const result = await interpretSearch(
		body.data.text,
		{ now: new Date(), tzOffset: body.data.tz ?? 0, labels: labels.map((l) => l.name), addresses },
		async (prompt) => (await generateText({ model: await quickModel(c.env), prompt, maxOutputTokens: 1500, temperature: 0 })).text,
	);
	return c.json(result, "error" in result ? 502 : 200);
});

const SavedSearchBody = z.object({
	name: z.string().max(200).optional(),
	query: z.string().max(MAX_SEARCH_LENGTH * 2).optional(),
	position: z.number().int().min(0).max(10_000).optional(),
});

/** Saved searches in order. `counts=1` adds how many conversations each matches in All mail. */
app.get("/api/v1/saved-searches", async (c) => {
	const counts = c.req.query("counts") === "1" ? { tzOffset: Number(c.req.query("tz") ?? 0) || 0 } : undefined;
	return c.json(await mailStore(c.env).all().listSavedSearches(counts));
});

app.post("/api/v1/saved-searches", async (c) => {
	const parsed = SavedSearchBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success || parsed.data.query === undefined) return c.json({ error: "Invalid saved search" }, 400);
	const result = await mailStore(c.env).all().createSavedSearch({ name: parsed.data.name, query: parsed.data.query });
	return result.saved ? c.json(result.saved, 201) : c.json({ error: result.error }, 400);
});

app.put("/api/v1/saved-searches/:id", async (c) => {
	const parsed = SavedSearchBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid saved search" }, 400);
	const result = await mailStore(c.env).all().updateSavedSearch(c.req.param("id"), parsed.data);
	if (result.error) return c.json({ error: result.error }, 400);
	return result.saved ? c.json(result.saved) : c.json({ error: "Not found" }, 404);
});

app.delete("/api/v1/saved-searches/:id", async (c) => {
	const deleted = await mailStore(c.env).all().deleteSavedSearch(c.req.param("id"));
	return deleted ? c.json({ deleted: true }) : c.json({ error: "Not found" }, 404);
});

// -- Labels ---------------------------------------------------------

app.get("/api/v1/labels", async (c) => c.json(await mailStore(c.env).all().listLabels()));

app.post("/api/v1/labels", async (c) => {
	const parsed = LabelBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid label" }, 400);
	const result = await mailStore(c.env).all().createLabel({ name: parsed.data.name, color: parsed.data.color });
	return result.label ? c.json(result.label, 201) : c.json({ error: result.error }, 400);
});

app.put("/api/v1/labels/:id", async (c) => {
	const parsed = LabelBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid label" }, 400);
	const result = await mailStore(c.env).all().updateLabel(c.req.param("id"), parsed.data);
	if (result.error) return c.json({ error: result.error }, 400);
	return result.label ? c.json(result.label) : c.json({ error: "Not found" }, 404);
});

app.delete("/api/v1/labels/:id", async (c) => {
	const result = await mailStore(c.env).all().deleteLabel(c.req.param("id"));
	if (!result) return c.json({ error: "Not found" }, 404);
	if (!result.deleted) return c.json({ error: "Some addresses could not drop the label. Try again.", failed: result.failed }, 502);
	return c.json(result);
});

/** Folder to label conversion. `dryRun` reports counts; a real run needs `confirm: true`. */
app.post("/api/v1/labels/import-folders", async (c) => {
	const { dryRun = true, confirm = false } = (await c.req.json().catch(() => ({}))) as { dryRun?: boolean; confirm?: boolean };
	const deps = importDeps(c.env);
	if (dryRun !== false) return c.json(await dryRunFolderImport(deps));
	if (confirm !== true) return c.json({ error: "Send confirm: true to convert folders" }, 400);
	return c.json(await runFolderImport(deps));
});

// -- Emails ---------------------------------------------------------

app.post("/api/v1/mailboxes/:mailboxId/emails", handleSendEmail);

app.post("/api/v1/mailboxes/:mailboxId/drafts", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;
	const parsed = DraftBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, 400);
	const { to, cc, bcc, subject, body, in_reply_to, thread_id, draft_id } = parsed.data;
	const stub = c.var.mailbox;
	// An agent draft keeps its notes when it is edited and saved.
	const notes = draft_id ? await stub.getDraftNotes(draft_id) : null;
	if (draft_id) {
		const attachments = await stub.deleteEmail(draft_id);
		if (attachments) await deleteAttachmentFiles(c.env.BUCKET, draft_id, attachments);
	}
	const messageId = crypto.randomUUID();
	const now = new Date().toISOString();
	await stub.createEmail(Folders.DRAFT, {
		id: messageId, subject: subject || "", sender: mailboxId.toLowerCase(),
		recipient: (to || "").toLowerCase(), cc: cc?.toLowerCase() || null, bcc: bcc?.toLowerCase() || null,
		date: now, body, in_reply_to: in_reply_to || null, email_references: null,
		thread_id: thread_id || in_reply_to || messageId,
	}, []);
	if (notes) await stub.setDraftNotes(messageId, notes);
	return c.json({ id: messageId, status: "draft", subject: subject || "", recipient: to || "", date: now }, 201);
});

/** Revise an agent draft with a one-off instruction (lib/redraft.ts). The draft is replaced; the reply has its new id. */
app.post("/api/v1/mailboxes/:mailboxId/drafts/:id/redraft", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;
	const draftId = c.req.param("id")!;
	const parsed = z.object({ instruction: z.string().max(REDRAFT_INSTRUCTION_MAX * 2) }).safeParse(await c.req.json().catch(() => null));
	if (!parsed.success || !parsed.data.instruction.trim()) return c.json({ error: "Say how to change the draft" }, 400);
	if (DEMO) {
		// Spend a demo AI action only on a draft that exists.
		const draft = (await c.var.mailbox.getEmail(draftId)) as { folder_id?: string } | null;
		if (!draft || draft.folder_id !== Folders.DRAFT) return c.json({ error: "Draft not found" }, 404);
		if (!(await demoAiAllowed(c.env))) return c.json({ error: DEMO_AI_USED_UP }, 429);
	}
	const sql = recordsSql(c.env);
	const [system, model] = await Promise.all([getSystemPrompt(c.env, mailboxId), agentModel(c.env, { reasoning: false })]);
	const result = await logged(sql, { actor: "person", bound: mailboxId }, "redraft", { draftId, instruction: parsed.data.instruction }, () =>
		redraft(c.var.mailbox, mailboxId, draftId, parsed.data.instruction, {
			ai: c.env.AI,
			bucket: c.env.BUCKET,
			system,
			write: async (systemPrompt, prompt) => (await generateText({ model, system: systemPrompt, prompt, maxOutputTokens: 2000 })).text,
			verify: (text) => verifyDraft(c.env.AI, text),
		}), (r) => (r.ok ? { draftId: r.draft.id, subject: r.draft.subject } : { error: r.error }));
	if (!result.ok) return c.json({ error: result.error }, result.status);
	return c.json({ draft: result.draft, notes: result.notes });
});

// -- Scheduled send -------------------------------------------------

/** Save the message as a draft and send it at sendAt from the mailbox's alarm. */
app.post("/api/v1/mailboxes/:mailboxId/scheduled", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;
	const raw = await c.req.text();
	if (new TextEncoder().encode(raw).byteLength > SCHEDULE_MAX_PAYLOAD_BYTES) {
		return c.json({ error: "Message is too large to schedule" }, 413);
	}
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return c.json({ error: "Invalid JSON" }, 400);
	}
	const parsed = ScheduleBody.safeParse(json);
	if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid schedule request" }, 400);
	const { sendAt, draft_id, mode, original_id, email } = parsed.data;
	const sendAtError = checkSendAt(sendAt);
	if (sendAtError) return c.json({ error: sendAtError }, 400);
	try {
		validateSender(email.to, email.from, mailboxId);
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}
	const result = await c.var.mailbox.scheduleSend({
		mailboxId, sendAt, draftId: draft_id, mode, originalId: mode === "new" ? undefined : original_id, email,
	});
	if ("error" in result) return c.json({ error: result.error }, result.status);
	return c.json(result, 201);
});

app.delete("/api/v1/mailboxes/:mailboxId/scheduled/:emailId", async (c: AppContext) => {
	const cancelled = await c.var.mailbox.cancelScheduled(c.req.param("emailId")!);
	return cancelled ? c.json({ status: "cancelled" }) : c.json({ error: "Not found" }, 404);
});

app.get("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const email = await c.var.mailbox.getEmail(c.req.param("id")!);
	if (!email) return c.json({ error: "Email not found" }, 404);
	return new Response(JSON.stringify(email), {
		headers: { "Content-Type": "application/json" },
	});
});

// Delete moves mail to Trash. Only mail already in Trash, and drafts, are deleted permanently.
app.delete("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const id = c.req.param("id")!;
	const result = await c.var.mailbox.trashOrDelete(id);
	if (result === null) return c.json({ error: "Not found" }, 404);
	await deleteAttachmentFiles(c.env.BUCKET, id, result.attachments);
	return c.json({ status: result.action });
});

// -- Threads --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/threads/:threadId", async (c: AppContext) => {
	return c.json(await (c.var.mailbox as any).getThreadEmails(c.req.param("threadId")!));
});

app.post("/api/v1/mailboxes/:mailboxId/threads/:threadId/read", async (c: AppContext) => {
	await c.var.mailbox.markThreadRead(c.req.param("threadId")!);
	return c.json({ status: "marked_read" });
});

// -- Reply / Forward ------------------------------------------------

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/reply", handleReplyEmail);
app.post("/api/v1/mailboxes/:mailboxId/emails/:id/forward", handleForwardEmail);

// -- Attachments ----------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId", async (c: AppContext) => {
	const emailId = c.req.param("emailId")!;
	const attachmentId = c.req.param("attachmentId")!;
	const attachment = await c.var.mailbox.getAttachment(attachmentId);
	if (!attachment) return c.json({ error: "Attachment not found" }, 404);
	const obj = await c.env.BUCKET.get(`attachments/${emailId}/${attachmentId}/${attachment.filename}`);
	if (!obj) return c.json({ error: "Attachment file not found" }, 404);
	const headers = new Headers();
	headers.set("Content-Type", attachment.mimetype);
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("Content-Security-Policy", "sandbox");
	const sanitized = attachment.filename.replace(/[\x00-\x1f"\\]/g, "_");
	headers.set("Content-Disposition", `attachment; filename="${sanitized}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);
	return new Response(obj.body, { headers });
});

// -- Receive inbound email ------------------------------------------

const MAX_EMAIL_SIZE = 25 * 1024 * 1024;

async function streamToArrayBuffer(stream: ReadableStream, streamSize: number) {
	if (streamSize > MAX_EMAIL_SIZE) throw new Error(`Email too large: ${streamSize} bytes exceeds ${MAX_EMAIL_SIZE} byte limit`);
	if (streamSize <= 0) throw new Error(`Invalid stream size: ${streamSize}`);
	const result = new Uint8Array(streamSize);
	let bytesRead = 0;
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (bytesRead + value.length > streamSize) { reader.cancel(); throw new Error(`Stream exceeds declared size`); }
		result.set(value, bytesRead);
		bytesRead += value.length;
	}
	return result;
}

async function receiveEmail(event: { to: string; raw: ReadableStream; rawSize: number; setReject(reason: string): void }, env: Env, ctx: ExecutionContext) {
	if (DEMO) {
		event.setReject("This address does not take mail");
		return;
	}
	const allowedAddresses = configuredAddresses(env).map((a) => a.toLowerCase());
	const mailboxId = event.to?.toLowerCase();
	if (!mailboxId) throw new Error("received email with no envelope recipient");
	if (allowedAddresses.length > 0 && !allowedAddresses.includes(mailboxId)) {
		event.setReject("Unknown recipient");
		return;
	}
	if (allowedAddresses.length === 0 && !(await mailStore(env).mailboxes.exists(mailboxId))) {
		event.setReject("Unknown recipient");
		return;
	}

	const rawEmail = await streamToArrayBuffer(event.raw, event.rawSize);
	const parsedEmail = await parseMail(rawEmail);
	const extractMsgId = (s: string) => { const m = s.match(/<([^>]+)>/); return m ? m[1] : s.trim().split(/\s+/)[0]; };
	const originalMessageId = parsedEmail.messageId ? extractMsgId(parsedEmail.messageId) : null;
	const allRecipients = (parsedEmail.to || []).map((t) => t.address?.toLowerCase()).filter(Boolean) as string[];
	const ccRecipients = (parsedEmail.cc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];
	const bccRecipients = (parsedEmail.bcc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];

	const messageId = crypto.randomUUID();
	if (!(await mailStore(env).mailboxes.exists(mailboxId))) {
		// A configured address gets its mailbox on first delivery, so mail sent before anyone opens the app is kept.
		if (allowedAddresses.length === 0) { console.log(`Ignoring email for ${mailboxId}: mailbox does not exist`); return; }
		await createMailbox(env, mailboxId, mailboxId.split("@")[0] || mailboxId);
	}

	const stub = mailStore(env).mailbox(mailboxId);
	if (originalMessageId && await stub.hasInboundMessageId(originalMessageId)) {
		console.log("duplicate delivery ignored");
		return;
	}

	const attachmentData: StoredAttachment[] = [];
	const attachmentKeys: string[] = [];
	const withAttachmentCleanup = async <T>(operation: () => Promise<T>): Promise<T> => {
		try {
			return await operation();
		} catch (e) {
			if (attachmentKeys.length > 0) await env.BUCKET.delete(attachmentKeys).catch(() => {});
			throw e;
		}
	};
	if (parsedEmail.attachments) {
		for (const att of parsedEmail.attachments) {
			const attId = crypto.randomUUID();
			const filename = (att.filename || "untitled").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");
			const key = `attachments/${messageId}/${attId}/${filename}`;
			attachmentKeys.push(key);
			await withAttachmentCleanup(() => env.BUCKET.put(key, att.content));
			attachmentData.push({ id: attId, email_id: messageId, filename, mimetype: att.mimeType,
				size: typeof att.content === "string" ? att.content.length : att.content.byteLength,
				content_id: att.contentId || null, disposition: att.disposition || "attachment" });
		}
	}

	// A bounce notice joins the conversation of the Sent message it is about (lib/bounce.ts).
	const bounced = await bounceLink(recordsSql(env), mailboxId, parsedEmail).catch((e) => {
		console.error("Bounce lookup failed:", (e as Error).message);
		return null;
	});
	const inReplyTo = bounced?.link?.messageId ?? (parsedEmail.inReplyTo ? extractMsgId(parsedEmail.inReplyTo) : null);
	const emailReferences = parsedEmail.references ? parsedEmail.references.split(/\s+/).filter(Boolean).map(extractMsgId) : [];
	// Join a thread only through mail this mailbox already holds (lib/threading.ts).
	const threadId = bounced?.link?.threadId ?? await withAttachmentCleanup(() => resolveThreadId(stub, {
		messageId, inReplyTo, references: emailReferences,
		subject: parsedEmail.subject || "", sender: (parsedEmail.from?.address || "").toLowerCase(),
	}));

	const inbound = {
		id: messageId, subject: parsedEmail.subject || "",
		sender: (parsedEmail.from?.address || "").toLowerCase(), recipient: allRecipients.join(", ") || mailboxId,
		cc: ccRecipients.join(", ") || null, bcc: bccRecipients.join(", ") || null,
		date: new Date().toISOString(), // uses receive time, not the email's Date header
		body: parsedEmail.html || parsedEmail.text || "",
		in_reply_to: inReplyTo, email_references: emailReferences.length > 0 ? JSON.stringify(emailReferences) : null,
		thread_id: threadId, message_id: originalMessageId, raw_headers: JSON.stringify(parsedEmail.headers),
	};
	await withAttachmentCleanup(() => stub.createEmail(Folders.INBOX, inbound, attachmentData));

	// Nothing drafts every email. New mail goes to the agent only when an enabled agent's
	// addresses and rules take it, or the owner chose that the PluraMail Agent drafts what
	// no agent takes. Rules only: no model call for mail nobody wants.
	const automated = bounced ? "bounce notice" : automatedMailReason(JSON.stringify(parsedEmail.headers), parsedEmail.from?.address);
	const wanted = automated ? false : await agentsWant(env, {
		mailboxId, from: (parsedEmail.from?.address || "").toLowerCase(), subject: parsedEmail.subject || "",
		body: parsedEmail.text || (parsedEmail.html ? stripHtmlToText(parsedEmail.html) : ""),
	}).catch((e) => {
		console.error("Agent match failed:", (e as Error).message);
		return false;
	});
	if (automated) {
		console.log(`Auto-draft skipped for ${messageId}: ${automated}`);
	} else if (wanted) {
		await startAutoDraft(env, ctx, {
			mailboxId,
			emailId: messageId,
			sender: (parsedEmail.from?.address || "").toLowerCase(),
			threadId,
		}).catch((e) => console.error("Auto-draft trigger failed:", (e as Error).message));
	}
}

/** Whether an enabled agent takes this mail, or the PluraMail Agent drafts for mail no agent takes. */
async function agentsWant(env: Env, mail: { mailboxId: string; from: string; subject: string; body: string }): Promise<boolean> {
	const [agents, { prefs }] = await Promise.all([listAgents(recordsSql(env)), readPrefs(env)]);
	return matchAgents(agents, mail).length > 0 || prefs.unmatched === "draft";
}

export { app, receiveEmail };
