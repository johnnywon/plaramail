// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The agent's model providers and catalogs, shared by the Worker and Settings.
 *
 * Two providers only, both chosen because the agent reads private mail:
 * Cloudflare Workers AI, built in and run in the deployment's own account, and
 * OpenRouter held to zero data retention endpoints. Direct connections to
 * model makers aren't offered, since their APIs keep traffic by default; their
 * models are reached through OpenRouter's zero retention endpoints instead.
 * Free models are refused everywhere.
 * SUGGESTED_MODELS is the short list shown first, one model per need, each
 * with the role it fills. `recommended` marks the default that deployments
 * follow until they pick something else.
 */

export const PROVIDERS = ["workers-ai", "openrouter"] as const;
export type ProviderId = (typeof PROVIDERS)[number];
export type KeyedProvider = Exclude<ProviderId, "workers-ai">;
export const KEYED_PROVIDERS: KeyedProvider[] = ["openrouter"];

export interface ProviderInfo {
	id: ProviderId;
	label: string;
	/** Hue for the provider's tag. */
	hue: number;
	/** Placeholder for the key field; null when no key is needed. */
	keyHint: string | null;
	/** Where to get a key. */
	keyUrl: string | null;
	/** The provider's own model catalog. */
	modelsUrl: string | null;
	/** What a model id looks like, for typed-in ids. */
	idExample: string;
	/** What happens to prompts sent there, in one line, as the policy below states it. */
	data: string;
	/** The provider's own page that `data` is taken from. */
	policyUrl: string;
	/** True when every request is sent with zero data retention. On OpenRouter it depends on the model (`CatalogModel.zdr`). */
	zdr: boolean;
	/** True when the provider's policy lets it train on prompts. */
	trains: boolean;
}

export const PROVIDER_INFO: Record<ProviderId, ProviderInfo> = {
	"workers-ai": {
		id: "workers-ai", label: "Cloudflare", hue: 55, keyHint: null, keyUrl: null, modelsUrl: "https://developers.cloudflare.com/ai/models/", idExample: "@cf/author/model", zdr: false, trains: false,
		data: "Doesn't train on your prompts or outputs. No zero retention promise.",
		policyUrl: "https://developers.cloudflare.com/workers-ai/platform/data-usage/",
	},
	openrouter: {
		id: "openrouter", label: "OpenRouter", hue: 265, keyHint: "sk-or-…", keyUrl: "https://openrouter.ai/settings/keys", modelsUrl: "https://openrouter.ai/models", idExample: "maker/model", zdr: false, trains: false,
		data: "Doesn't log prompts. Zero retention on models that offer it.",
		policyUrl: "https://openrouter.ai/docs/guides/features/zdr",
	},
};

export function isProvider(value: unknown): value is ProviderId {
	return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

export interface ModelPrice {
	/** USD per million input tokens. */
	input: number;
	/** USD per million output tokens. */
	output: number;
}

export interface CatalogModel {
	provider: ProviderId;
	id: string;
	name: string;
	/** Tokens the model reads at once. */
	context: number | null;
	price: ModelPrice | null;
	/** Whether the catalog says the model can call tools; null when it doesn't say. */
	tools: boolean | null;
	/** True when requests go only to endpoints that keep no prompts. A guide shown on the model, not a filter. */
	zdr?: boolean;
}

export interface ModelRef {
	provider: ProviderId;
	id: string;
}

export interface SuggestedModel extends ModelRef {
	/** The need it fills, shown above its name. */
	role: string;
	recommended?: boolean;
}

export const SUGGESTED_MODELS: SuggestedModel[] = [
	// Built in, no key, reliable tool calls at a mid price.
	{ provider: "workers-ai", id: "@cf/moonshotai/kimi-k2.6", role: "Recommended", recommended: true },
	// Built in, the lowest output price of the tool-calling models, 1M context.
	{ provider: "workers-ai", id: "@cf/zai-org/glm-5.3-flash", role: "Cheapest" },
	// Claude through OpenRouter's zero retention endpoints (Bedrock, Google), so
	// one key covers both and no provider keeps the mail. Claude Fable has no
	// zero retention endpoint, so Opus is the quality pick.
	{ provider: "openrouter", id: "anthropic/claude-sonnet-5.5", role: "Balanced" },
	{ provider: "openrouter", id: "anthropic/claude-opus-5.5", role: "Best quality" },
];

const recommended = SUGGESTED_MODELS.find((m) => m.recommended)!;
export const RECOMMENDED_MODEL: ModelRef = { provider: recommended.provider, id: recommended.id };

export function sameModel(a: ModelRef, b: ModelRef): boolean {
	return a.provider === b.provider && a.id === b.id;
}

/** What a typed id looks like it belongs to. */
export function guessProvider(id: string): ProviderId {
	const s = id.trim().toLowerCase();
	if (/^@(cf|hf)\//.test(s)) return "workers-ai";
	return "openrouter";
}

/** The shape check a model id must pass for its provider. Anything shaped right is allowed. */
/** OpenRouter's free variants end in ":free", in any case. */
const FREE_SUFFIX = /:free$/i;

export function validModelId(provider: ProviderId, id: string): boolean {
	if (!id || id.length > 200 || /\s/.test(id) || FREE_SUFFIX.test(id)) return false;
	if (provider === "workers-ai") return /^@(cf|hf)\/[\w.-]+\/[\w.:-]+$/.test(id);
	return /^[\w.-]+\/[\w.:~-]+$/.test(id);
}

const UPPER = new Set(["glm", "gpt", "oss", "fp8", "awq", "it", "ai"]);
const SPELLED: Record<string, string> = { deepseek: "DeepSeek", eurollm: "EuroLLM" };

/** A readable name from a model id: "@cf/zai-org/glm-5.3-flash" becomes "GLM 5.3 Flash". */
export function prettyName(id: string): string {
	return (id.split("/").pop() ?? id).split(/[-:]/).filter(Boolean).map((w) =>
		SPELLED[w] ?? (UPPER.has(w) || /^\d+(\.\d+)?[bm]$/.test(w) || /^a\d+b$/.test(w) || /^[kv]\d/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)),
	).join(" ");
}

/** Who makes a model, with a hue for its tag. */
const MAKERS: Record<string, { label: string; hue: number }> = {
	moonshotai: { label: "Moonshot", hue: 25 },
	"zai-org": { label: "Z.ai", hue: 175 },
	"z-ai": { label: "Z.ai", hue: 175 },
	"deepseek-ai": { label: "DeepSeek", hue: 255 },
	deepseek: { label: "DeepSeek", hue: 255 },
	openai: { label: "OpenAI", hue: 150 },
	anthropic: { label: "Anthropic", hue: 35 },
	"x-ai": { label: "xAI", hue: 235 },
	xai: { label: "xAI", hue: 235 },
	meta: { label: "Meta", hue: 230 },
	"meta-llama": { label: "Meta", hue: 230 },
	qwen: { label: "Qwen", hue: 295 },
	google: { label: "Google", hue: 75 },
	mistralai: { label: "Mistral", hue: 45 },
	nvidia: { label: "NVIDIA", hue: 125 },
	"ibm-granite": { label: "IBM", hue: 215 },
	"swiss-ai": { label: "Swiss AI", hue: 5 },
	"utter-project": { label: "EuroLLM", hue: 270 },
};

export function makerOf(model: ModelRef): { label: string; hue: number } {
	const parts = model.id.split("/");
	const author = model.provider === "workers-ai" ? parts[1] ?? "" : parts[0] ?? "";
	if (MAKERS[author]) return MAKERS[author];
	let hue = 0;
	for (const c of author) hue = (hue * 31 + c.charCodeAt(0)) % 360;
	return { label: author || "Unknown", hue };
}

// -- Catalog parsing --------------------------------------------------

/** One entry of Cloudflare's model catalog, as env.AI.models() returns it. */
export interface WorkersAiEntry {
	name: string;
	task?: { name?: string };
	properties?: { property_id: string; value: unknown }[];
}

function workersAiPrice(value: unknown): ModelPrice | null {
	if (!Array.isArray(value)) return null;
	const find = (unit: string) => value.find((p) => p && typeof p === "object" && p.unit === unit && typeof p.price === "number")?.price as number | undefined;
	const input = find("per M input tokens");
	const output = find("per M output tokens");
	return input === undefined || output === undefined ? null : { input, output };
}

/** Cloudflare's text-generation models. `tools` says whether each can call tools. */
/**
 * Cloudflare's text models the agent may use. Partner models, which
 * Cloudflare's catalog marks as served under a third party's terms, are left
 * out, and so is any model without a listed price above zero: unpriced
 * models are free or preview, and free is never used for private mail.
 */
export function modelsFromWorkersAi(entries: WorkersAiEntry[]): CatalogModel[] {
	const out: CatalogModel[] = [];
	for (const entry of entries) {
		if (entry.task?.name !== "Text Generation") continue;
		const props = new Map((entry.properties ?? []).map((p) => [p.property_id, p.value]));
		const partner = props.get("partner");
		if (partner === true || partner === "true") continue;
		const price = workersAiPrice(props.get("price"));
		if (!price || price.output <= 0) continue;
		const fc = props.get("function_calling");
		const context = Number(props.get("context_window"));
		out.push({
			provider: "workers-ai",
			id: entry.name,
			name: prettyName(entry.name),
			context: Number.isFinite(context) && context > 0 ? context : null,
			price,
			tools: fc === true || fc === "true",
		});
	}
	return out;
}

function perMillion(value: string | undefined): number | undefined {
	const n = Number(value);
	return value === undefined || !Number.isFinite(n) || n < 0 ? undefined : Math.round(n * 1e6 * 1000) / 1000;
}

/**
 * Free models are left out everywhere: free endpoints pay for themselves with
 * your prompts, and the agent reads private mail.
 */
export function isFree(m: Pick<CatalogModel, "id" | "price">): boolean {
	return FREE_SUFFIX.test(m.id) || (!!m.price && m.price.input === 0 && m.price.output === 0);
}

/** One endpoint from OpenRouter's /endpoints/zdr list. Public, no key needed. */
export interface ZdrEndpoint {
	model_id?: string;
	model_name?: string;
	context_length?: number | null;
	pricing?: { prompt?: string; completion?: string };
	supported_parameters?: string[] | null;
}

/** One model from OpenRouter's /models list. Public, no key needed. */
export interface OpenRouterModel {
	id?: string;
	name?: string;
	context_length?: number | null;
	pricing?: { prompt?: string; completion?: string };
	supported_parameters?: string[] | null;
}

/**
 * Every paid OpenRouter model. A model with a zero retention endpoint keeps
 * that entry (`zdr: true`, priced at the cheapest such endpoint, since its
 * requests only go there); the rest carry OpenRouter's listed price and
 * `zdr: false`. Free, unpriced, alias and batch ones are left out.
 */
export function modelsFromOpenRouter(models: OpenRouterModel[], zdr: CatalogModel[]): CatalogModel[] {
	const byId = new Map(zdr.map((m) => [m.id, m]));
	for (const e of models) {
		// Aliases (`~maker/…-latest`) and `:batch` variants can't be saved or chatted with.
		if (typeof e.id !== "string" || !e.id || byId.has(e.id) || /:batch$/i.test(e.id) || !validModelId("openrouter", e.id)) continue;
		const input = perMillion(e.pricing?.prompt);
		const output = perMillion(e.pricing?.completion);
		if (input === undefined || output === undefined || output <= 0) continue;
		byId.set(e.id, {
			provider: "openrouter",
			id: e.id,
			name: (e.name ?? prettyName(e.id)).replace(/^[^:]+:\s*/, ""),
			context: e.context_length && e.context_length > 0 ? e.context_length : null,
			price: { input, output },
			tools: Array.isArray(e.supported_parameters) ? e.supported_parameters.includes("tools") : null,
			zdr: false,
		});
	}
	return [...byId.values()].filter((m) => !isFree(m));
}

/**
 * OpenRouter's models that have at least one zero retention endpoint, built
 * from that list alone. Each is priced at its cheapest such endpoint, since
 * requests only go there, and free ones are left out. Prices there are per
 * token; here they are per million.
 */
export function modelsFromZdr(endpoints: ZdrEndpoint[]): CatalogModel[] {
	const byId = new Map<string, CatalogModel>();
	for (const e of endpoints) {
		if (typeof e.model_id !== "string" || !e.model_id) continue;
		const input = perMillion(e.pricing?.prompt);
		const output = perMillion(e.pricing?.completion);
		const price = input === undefined || output === undefined ? null : { input, output };
		const context = e.context_length && e.context_length > 0 ? e.context_length : null;
		const tools = Array.isArray(e.supported_parameters) ? e.supported_parameters.includes("tools") : null;
		const seen = byId.get(e.model_id);
		if (!seen) {
			byId.set(e.model_id, {
				provider: "openrouter",
				id: e.model_id,
				name: (e.model_name ?? prettyName(e.model_id)).replace(/^[^:]+:\s*/, ""),
				context, price, tools, zdr: true,
			});
			continue;
		}
		if (price && (!seen.price || price.output < seen.price.output)) seen.price = price;
		if (context && (!seen.context || context > seen.context)) seen.context = context;
		if (tools) seen.tools = true;
		else if (seen.tools === null && tools === false) seen.tools = false;
	}
	return [...byId.values()].filter((m) => !isFree(m));
}
