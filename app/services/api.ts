// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { BulkAction } from "~/lib/bulk-optimistic";
import type { Email, Mailbox } from "~/types";
import type { Prefs } from "shared/prefs";
import type { DraftNotes } from "shared/draft-notes";
import type { AgentLimits } from "shared/send-limits";
import type { CatalogModel, KeyedProvider, ModelRef, ProviderId } from "shared/models";

const REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
	status: number;
	body: Record<string, unknown>;

	constructor(status: number, body: Record<string, unknown>) {
		super((body.error as string) || `Request failed: ${status}`);
		this.name = "ApiError";
		this.status = status;
		this.body = body;
	}
}

async function request<T>(
	url: string,
	options: RequestInit = {},
): Promise<T> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	// Combine caller signal (e.g. TanStack Query abort) with our timeout signal
	const signal = options.signal
		? AbortSignal.any([options.signal, controller.signal])
		: controller.signal;

	try {
		const res = await fetch(url, {
			...options,
			signal,
			headers: {
				"Content-Type": "application/json",
				...(options.headers as Record<string, string>),
			},
		});

		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new ApiError(res.status, body as Record<string, unknown>);
		}

		if (res.status === 204) return undefined as T;

		const contentType = res.headers.get("content-type") ?? "";
		if (contentType.includes("application/json")) {
			return res.json() as Promise<T>;
		}
		return res.blob() as unknown as T;
	} finally {
		clearTimeout(timeout);
	}
}

function get<T>(url: string, opts?: { params?: Record<string, string>; responseType?: string; signal?: AbortSignal }) {
	const query = opts?.params ? `?${new URLSearchParams(opts.params)}` : "";
	return request<T>(`${url}${query}`, {
		method: "GET",
		signal: opts?.signal,
		...(opts?.responseType === "blob" ? { headers: { Accept: "*/*" } } : {}),
	});
}

function post<T>(url: string, body?: unknown, opts?: { signal?: AbortSignal; headers?: Record<string, string> }) {
	return request<T>(url, {
		method: "POST",
		signal: opts?.signal,
		headers: opts?.headers,
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

/** The same key on a retried send makes the server return the first send instead of sending again. */
const sendKey = (key?: string) => (key ? { headers: { "Idempotency-Key": key } } : undefined);

function put<T>(url: string, body?: unknown) {
	return request<T>(url, {
		method: "PUT",
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function del<T>(url: string) {
	return request<T>(url, { method: "DELETE" });
}

// ---------- Typed response shapes ----------

export type ActivityActor = "chat" | "auto-draft" | "mcp" | "person";

export interface ActivityEntry {
	id: number;
	at: string;
	mailboxId: string | null;
	actor: ActivityActor;
	client: string | null;
	action: "read" | "draft" | "send" | "delete" | "label" | "move" | "settings";
	tool: string;
	target: string | null;
	summary: string | null;
	ok: boolean;
	/** The action agent's action Undo reverses, while it can. */
	undo: string | null;
}

export interface McpUsage {
	clients: { client: string | null; last: string; calls: number; today: number; errors: number }[];
	tools: Record<string, { calls: number; last: string }>;
	lastCall: string | null;
}

/** An app connected to the MCP server over OAuth. `scopes` has "mail.send" when it may send. */
export interface McpApp {
	id: string;
	clientId: string;
	name: string;
	scopes: string[];
	connectedAt: string;
}

export interface ActivityPage {
	entries: ActivityEntry[];
	next: number | null;
}

export interface AgentOverview {
	limits: AgentLimits;
	addresses: { mailboxId: string; hour: number; day: number; agentDay: number }[];
	runs: Partial<Record<AutoDraftRun["state"], number>>;
	failed: number;
	failures: ActivityEntry[];
	actions: number;
}

export interface AutoDraftRun {
	emailId: string;
	mailboxId: string;
	sender: string;
	state: "queued" | "running" | "drafted" | "watched" | "sent" | "skipped" | "superseded" | "failed";
	attempts: number;
	reason: string | null;
	draftId: string | null;
	agentId: string | null;
	createdAt: string;
	updatedAt: string;
}

/** Watch, Draft and Send are for reply agents; Watch and On for action agents. */
export type AgentMode = "watch" | "draft" | "send" | "on";

/** What an agent does with mail it takes. */
export type AgentDoes = "reply" | "star" | "label" | "archive" | "mark_read";

/** One action an action agent took or would have taken. */
export interface AgentActionRow {
	id: string;
	agentId: string;
	agentName: string;
	mailboxId: string;
	emailId: string;
	does: Exclude<AgentDoes, "reply">;
	labelId: string | null;
	state: "watched" | "done" | "undone" | "limited" | "failed";
	reason: string | null;
	createdAt: string;
	undoneAt: string | null;
}

export interface AgentRule {
	field: "from" | "subject" | "body";
	op: "contains" | "not_contains" | "is" | "domain";
	value: string;
}

export interface Agent {
	id: string;
	name: string;
	job: string;
	/** Addresses it watches. Empty means every address. */
	addresses: string[];
	rules: AgentRule[];
	instructions: string;
	exampleReply: string;
	mode: AgentMode;
	does: AgentDoes;
	/** The label a Label agent adds. */
	labelId: string | null;
	enabled: boolean;
	position: number;
	dailyLimit: number;
	perSenderLimit: number;
	createdAt: string;
	updatedAt: string;
}

export type AgentInput = Pick<Agent, "name" | "job"> & Partial<Omit<Agent, "id" | "name" | "job" | "position" | "createdAt" | "updatedAt">>;

export interface AgentStats {
	agentId: string;
	/** An action agent's are its actions: watched, done, skipped and failed. */
	runs: Partial<Record<AutoDraftRun["state"] | "done", number>>;
	today: number;
	/** Queued or running runs that moved in the last 10 minutes. */
	live: number;
}

export interface AgentDraft {
	emailId: string;
	mailboxId: string;
	threadId: string | null;
	subject: string;
	recipient: string;
	date: string;
	snippet: string;
	/** The reply as written, without the quoted original. */
	text: string;
	agent: string | null;
}


export interface Conversation {
	thread_key: string;
	mailbox_id: string;
	email_id: string;
	message_id: string | null;
	state: string;
	date: string;
	sender_addr: string;
	sender_name: string;
	/** The To line, for showing who sent mail went to. */
	recipient: string;
	subject: string;
	snippet: string;
	unread: boolean;
	starred: boolean;
	has_attachment: boolean;
	can_unsubscribe: boolean;
	labels: string[];
	thread_count: number;
	thread_unread_count: number;
	participants: string[];
	has_draft: boolean;
	also_in: string[];
	/** With search words: how many of the conversation's messages matched. */
	match_count?: number;
	/** On D1: escaped text around the matched words, with <mark>. Render through snippetMarkup. */
	snippet_html?: string;
}

export interface MailPage {
	conversations: Conversation[];
	nextCursor: string | null;
	total?: number;
	unread?: number;
	order?: "relevance" | "date" | "from" | "subject";
	/** Too many matches to rank; the list is newest first. `sort:relevance` ranks it anyway. */
	rankSkipped?: boolean;
}

export interface FacetValue {
	value: string;
	count: number;
	name?: string;
}

export interface MailFacets {
	address: FacetValue[];
	from: { domains: FacetValue[]; addresses: FacetValue[]; more: boolean };
	label: FacetValue[];
	date: Record<"today" | "yesterday" | "7d" | "30d" | "older", number>;
	status: Record<"unread" | "read" | "starred" | "attachment" | "unsubscribe", number>;
}

export interface SuggestPerson {
	value: string;
	name?: string;
	count: number;
}

/** GET /api/v1/search/suggest: what the search window shows beyond the list (workers/lib/search-suggest-sql.ts). */
export interface Suggestions {
	completions: SuggestPerson[] | null;
	people: SuggestPerson[];
	count: number | null;
	narrow: { token: string; label: string; count: number }[];
	nothing: { everywhere: number | null; removals: { text: string; start: number; end: number; count: number }[] } | null;
	didYouMean: { text: string; words: { from: string; to: string }[] } | null;
	interpretable: boolean;
	errors: string[];
}

export interface SavedSearch {
	id: string;
	name: string;
	query: string;
	position: number;
	count?: number | null;
}

export interface Label {
	id: string;
	name: string;
	color: string;
	position: number;
	count: number;
	/** The agent has applied this label (through the chat agent or MCP). */
	auto?: boolean;
}

/** What Unsubscribe did: posted one-click from the Worker, or what the app opens. */
export type UnsubscribeResult =
	| { method: "one-click"; ok: true; status: number; host: string }
	| { method: "link"; ok: true; url: string }
	| { method: "mailto"; ok: true; mailto: { to: string; subject: string; body: string } };

export interface BlockedSender {
	mailboxId: string;
	address: string;
	createdAt: string;
}

export interface ScheduledSend {
	mailboxId: string;
	emailId: string;
	sendAt: string;
	error: string | null;
}

export interface ScheduleRequest {
	sendAt: string;
	draft_id?: string;
	mode: "new" | "reply" | "reply-all" | "forward";
	original_id?: string;
	email: unknown;
}

export type BulkTarget =
	| { threadKeys: string[]; view: string }
	| { filter: string; asOf: string; expectedCount: number };

export interface BulkResult {
	affected: number;
	undoId: string;
	failed: { mailboxId: string; error: string }[];
}

export interface BulkJobStarted {
	jobId: string;
	total: number;
	undoId: string;
}




export interface FolderImportPlan {
	labels: { id: string; name: string; exists: boolean; folders: number; messages: number }[];
	mailboxes: { mailboxId: string; imported: boolean; folders: { folderId: string; name: string; count: number; labelId: string }[] }[];
	totals: { mailboxes: number; folders: number; messages: number };
}

export interface FolderImportResult {
	backup: string;
	plan: FolderImportPlan;
	results: { mailboxId: string; folderId: string; labelId: string; labeled: number; archived: number; error?: string }[];
}

/** Message counts per address (workers/store/d1/status.ts). Unread counts the Inbox only. */
export interface StorageStatusResponse {
	messages: number;
	/** Every message's size, body plus attachments. */
	bytes: number;
	mailboxes: {
		mailboxId: string;
		states: Record<string, number>;
		unread: number;
		starred: number;
		total: number;
		inboxConversations: number;
	}[];
}

export interface AgentModelView {
	selected: ModelRef | null;
	recommended: ModelRef;
	/** The model the agent runs right now. */
	active: ModelRef;
	keys: Record<KeyedProvider, { set: boolean; hint: string }>;
}

export interface ProviderCatalog {
	source: "live" | "openrouter" | "none";
	models: CatalogModel[];
	error?: string;
}

export interface ModelCatalog {
	recommended: ModelRef;
	suggested: (ModelRef & { role: string })[];
	providers: Record<ProviderId, ProviderCatalog>;
	keyed: KeyedProvider[];
}

// ---------- API client ----------

const api = {
	// Config
	getConfig: () =>
		get<{ domains: string[]; emailAddresses: string[]; autoDraft?: boolean; demo?: boolean; version?: string; deployedAt?: string | null }>("/api/v1/config"),

	// Agent model
	getPrefs: () => get<{ prefs: Prefs; saved: boolean }>("/api/v1/prefs"),
	savePrefs: (prefs: Partial<Prefs>) => put<{ prefs: Prefs; saved: true }>("/api/v1/prefs", prefs),
	getAgentModel: () => get<AgentModelView>("/api/v1/agent-model"),
	updateAgentModel: (body: { selected?: ModelRef | null; keys?: Partial<Record<KeyedProvider, string>> }) =>
		put<AgentModelView>("/api/v1/agent-model", body),
	testAgentModel: (body: { provider: ProviderId; id: string; key?: string }) =>
		post<{ ok: boolean; reply?: string; ms?: number; error?: string }>("/api/v1/agent-model/test", body),
	getModelCatalog: () => get<ModelCatalog>("/api/v1/agent-model/catalog"),

	// Mailboxes
	listMailboxes: () => get<Mailbox[]>("/api/v1/mailboxes"),
	createMailbox: (email: string, name: string, settings?: unknown) =>
		post<Mailbox>("/api/v1/mailboxes", { email, name, settings }),
	getMailbox: (mailboxId: string) =>
		get<Mailbox>(`/api/v1/mailboxes/${mailboxId}`),
	updateMailbox: (mailboxId: string, settings: unknown) =>
		put<Mailbox>(`/api/v1/mailboxes/${mailboxId}`, { settings }),

	// Emails
	sendEmail: (mailboxId: string, email: unknown, key?: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails`, email, sendKey(key)),
	getEmail: (mailboxId: string, id: string, opts?: { signal?: AbortSignal }) =>
		get<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, { signal: opts?.signal }),
	deleteEmail: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`),
	getThread: (mailboxId: string, threadId: string, opts?: { signal?: AbortSignal }) =>
		get<Email[]>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}`, { signal: opts?.signal }),
	markThreadRead: (mailboxId: string, threadId: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}/read`),
	saveDraft: (
		mailboxId: string,
		draft: {
			to?: string;
			cc?: string;
			bcc?: string;
			subject?: string;
			body: string;
			in_reply_to?: string;
			thread_id?: string;
			draft_id?: string;
		},
	) => post<{ draft_id: string }>(`/api/v1/mailboxes/${mailboxId}/drafts`, draft),
	replyToEmail: (mailboxId: string, emailId: string, email: unknown, key?: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/reply`, email, sendKey(key)),
	forwardEmail: (mailboxId: string, emailId: string, email: unknown, key?: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/forward`, email, sendKey(key)),

	// Unsubscribe and blocked senders (WON-217)
	unsubscribe: (mailboxId: string, emailId: string) =>
		post<UnsubscribeResult>(`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/emails/${encodeURIComponent(emailId)}/unsubscribe`),
	blockSender: (mailboxId: string, emailId: string) =>
		post<BlockedSender>(`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/emails/${encodeURIComponent(emailId)}/block`),
	unblockSender: (mailboxId: string, address: string) =>
		del<{ removed: true }>(`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/blocked-senders/${encodeURIComponent(address)}`),
	getBlockedSenders: () => get<BlockedSender[]>("/api/v1/blocked-senders"),

	// Scheduled send
	scheduleSend: (mailboxId: string, request: ScheduleRequest) =>
		post<{ id: string; sendAt: string }>(`/api/v1/mailboxes/${mailboxId}/scheduled`, request),
	getScheduled: () => get<ScheduledSend[]>("/api/v1/mail/scheduled"),
	cancelScheduled: (mailboxId: string, emailId: string) =>
		del<{ status: string }>(`/api/v1/mailboxes/${mailboxId}/scheduled/${encodeURIComponent(emailId)}`),

	// Mail across every address
	getMail: (params: URLSearchParams, opts?: { signal?: AbortSignal }) =>
		request<MailPage>(`/api/v1/mail?${params}`, { method: "GET", signal: opts?.signal }),
	getMailFacets: (params: URLSearchParams, opts?: { signal?: AbortSignal }) =>
		request<MailFacets>(`/api/v1/mail/facets?${params}`, { method: "GET", signal: opts?.signal }),

	// Bulk actions
	bulk: (target: BulkTarget, action: BulkAction) => post<BulkResult | BulkJobStarted>("/api/v1/mail/bulk", { target, action }),
	undoBulk: (undoId: string) => post<{ affected: number }>("/api/v1/mail/bulk/undo", { undoId }),
	trashCount: () => get<{ messages: number; conversations: number }>("/api/v1/mail/trash"),
	emptyTrash: (expectedCount: number) => post<unknown>("/api/v1/mail/empty-trash", { expectedCount }),

	// Search window
	contacts: (q: string, opts?: { signal?: AbortSignal }) =>
		request<{ contacts: SuggestPerson[] }>(`/api/v1/contacts?${new URLSearchParams({ q })}`, { method: "GET", signal: opts?.signal }),
	suggest: (params: URLSearchParams, opts?: { signal?: AbortSignal }) =>
		request<Suggestions>(`/api/v1/search/suggest?${params}`, { method: "GET", signal: opts?.signal }),
	getSavedSearches: (tzOffset = new Date().getTimezoneOffset()) =>
		get<SavedSearch[]>("/api/v1/saved-searches", { params: { counts: "1", tz: String(tzOffset) } }),
	createSavedSearch: (input: { name?: string; query: string }) => post<SavedSearch>("/api/v1/saved-searches", input),
	updateSavedSearch: (id: string, input: { name?: string; query?: string; position?: number }) =>
		put<SavedSearch>(`/api/v1/saved-searches/${encodeURIComponent(id)}`, input),
	deleteSavedSearch: (id: string) => del<{ deleted: boolean }>(`/api/v1/saved-searches/${encodeURIComponent(id)}`),
	/** Plain words to search text. A failure still answers, with the words themselves as the query. */
	interpretSearch: async (text: string, tz = new Date().getTimezoneOffset()): Promise<{ query: string; explanation?: string; error?: string }> => {
		try {
			return await post<{ query: string; explanation: string }>("/api/v1/search/interpret", { text, tz });
		} catch (e) {
			const body = e instanceof ApiError ? e.body : {};
			return { query: typeof body.query === "string" ? body.query : text, error: typeof body.error === "string" ? body.error : "The model didn't answer. Searching for the words instead." };
		}
	},

	// Labels
	getLabels: () => get<Label[]>("/api/v1/labels"),
	createLabel: (input: { name: string; color?: string }) => post<Label>("/api/v1/labels", input),
	updateLabel: (id: string, input: { name?: string; color?: string }) => put<Label>(`/api/v1/labels/${encodeURIComponent(id)}`, input),
	deleteLabel: (id: string) => del<{ deleted: boolean; affected: number }>(`/api/v1/labels/${encodeURIComponent(id)}`),
	importFoldersDryRun: () => post<FolderImportPlan>("/api/v1/labels/import-folders", { dryRun: true }),
	importFolders: () => post<FolderImportResult>("/api/v1/labels/import-folders", { dryRun: false, confirm: true }),

	// Storage
	getStorageStatus: () => get<StorageStatusResponse>("/api/v1/storage/status"),

	// Console > Limits and Overview
	getAgentLimits: () => get<AgentLimits>("/api/v1/agent-limits"),
	putAgentLimits: (limits: Partial<AgentLimits>) => put<AgentLimits>("/api/v1/agent-limits", limits),
	getAgentOverview: () => get<AgentOverview>("/api/v1/agents/overview"),

	// Activity and auto-draft runs (Console > Activity)
	getActivity: (filter: { mailbox?: string; actor?: string; before?: number }) =>
		get<ActivityPage>("/api/v1/activity", {
			params: Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])),
		}),
	getMcpUsage: () => get<McpUsage>("/api/v1/mcp/usage"),
	getMcpApps: () => get<{ apps: McpApp[] }>("/api/v1/mcp/apps"),
	revokeMcpApp: (id: string) => del<{ ok: true }>(`/api/v1/mcp/apps/${encodeURIComponent(id)}`),
	getAutoDraftRuns: (mailbox?: string) => get<AutoDraftRun[]>("/api/v1/auto-draft/runs", mailbox ? { params: { mailbox } } : undefined),

	// Agents (Console > Agents)
	getAgents: () => get<{ agents: Agent[]; stats: AgentStats[] }>("/api/v1/agents"),
	createAgent: (input: AgentInput) => post<Agent>("/api/v1/agents", input),
	updateAgent: (id: string, input: Partial<AgentInput>) => put<Agent>(`/api/v1/agents/${encodeURIComponent(id)}`, input),
	deleteAgent: (id: string) => del<{ deleted: boolean }>(`/api/v1/agents/${encodeURIComponent(id)}`),
	orderAgents: (ids: string[]) => put<{ ok: boolean }>("/api/v1/agents/order", { ids }),
	getAgentRuns: (id: string, limit = 50) => get<AutoDraftRun[]>(`/api/v1/agents/${encodeURIComponent(id)}/runs?limit=${limit}`),
	getAgentActions: (id: string, limit = 50) => get<AgentActionRow[]>(`/api/v1/agents/${encodeURIComponent(id)}/actions?limit=${limit}`),
	undoAgentAction: (id: string) => post<AgentActionRow>(`/api/v1/agent-actions/${encodeURIComponent(id)}/undo`, {}),
	getAgentDrafts: () => get<AgentDraft[]>("/api/v1/agents/review"),

	// Redraft an agent draft with an instruction. The draft is replaced; the reply carries its new id.
	redraft: (mailboxId: string, draftId: string, instruction: string) =>
		post<{ draft: { id: string; subject: string; recipient: string; body: string }; notes: DraftNotes }>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/drafts/${encodeURIComponent(draftId)}/redraft`,
			{ instruction },
		),

};

export default api;
