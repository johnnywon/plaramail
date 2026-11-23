import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

const m = await loadTs("workers/lib/agent-model.ts");
const s = await loadTs("shared/models.ts");

function bucket() {
	const store = new Map();
	return {
		store,
		get: async (k) => (store.has(k) ? { json: async () => JSON.parse(store.get(k)) } : null),
		put: async (k, v) => { store.set(k, v); },
	};
}

test("with nothing saved the agent runs the recommended Workers AI model", async () => {
	const config = await m.readAgentModelConfig({ BUCKET: bucket() });
	assert.deepEqual(config, { keys: {} });
	const view = m.viewOf(config);
	assert.equal(view.selected, null);
	assert.deepEqual(view.active, s.RECOMMENDED_MODEL);
	assert.equal(view.active.provider, "workers-ai");
	assert.equal(m.WORKERS_AI_MODEL, s.RECOMMENDED_MODEL.id);
	assert.equal(s.SUGGESTED_MODELS.filter((x) => x.recommended).length, 1);
	// One model per need: every suggestion has its own role.
	const roles = s.SUGGESTED_MODELS.map((x) => x.role);
	assert.ok(roles.every(Boolean));
	assert.equal(new Set(roles).size, roles.length);
});

test("the older one-provider file is not read", () => {
	assert.deepEqual(m.parseAgentModelConfig({ provider: "openrouter", model: "a/b", apiKey: "sk-or-1234567890" }), { keys: {} });
});

test("the view never carries a key, only its last four characters", () => {
	const view = m.viewOf({ keys: { openrouter: "sk-or-v1-0123456789abcd" } });
	assert.deepEqual(view.keys.openrouter, { set: true, hint: "abcd" });
	assert.ok(!JSON.stringify(view).includes("sk-or"));
});

test("any id shaped right for its provider is accepted; OpenRouter needs its key", () => {
	const none = { keys: {} };
	assert.deepEqual(m.mergeAgentModelConfig(none, { selected: { provider: "openrouter", id: "anthropic/claude-opus-5.5" } }), { error: "Add your OpenRouter key." });
	const ok = m.mergeAgentModelConfig(none, { selected: { provider: "openrouter", id: "anthropic/claude-anything-new" }, keys: { openrouter: " sk-or-x " } });
	assert.deepEqual(ok, { selected: { provider: "openrouter", id: "anthropic/claude-anything-new" }, keys: { openrouter: "sk-or-x" } });
	assert.equal(m.mergeAgentModelConfig(none, { selected: { provider: "workers-ai", id: "@cf/someone/brand-new" } }).selected.id, "@cf/someone/brand-new");
	assert.match(m.mergeAgentModelConfig(none, { selected: { provider: "workers-ai", id: "gpt-6" } }).error, /Cloudflare model id/);
	assert.match(m.mergeAgentModelConfig(none, { selected: { provider: "openrouter", id: "no slash" } }).error, /OpenRouter model id/);
});

test("direct provider connections are refused, and old ones are dropped on read", () => {
	assert.deepEqual(s.PROVIDERS, ["workers-ai", "openrouter"]);
	assert.deepEqual(m.mergeAgentModelConfig({ keys: {} }, { selected: { provider: "anthropic", id: "claude-fable-5-1" }, keys: { anthropic: "sk-ant-x" } }), { error: "Choose a provider." });
	assert.deepEqual(m.mergeAgentModelConfig({ keys: {} }, { keys: { openai: "sk-x" } }), { keys: {} });
	const old = m.parseAgentModelConfig({ selected: { provider: "openai", id: "gpt-6-astra" }, keys: { openai: "sk-1", openrouter: "sk-or-1" } });
	assert.deepEqual(old, { keys: { openrouter: "sk-or-1" } });
	assert.deepEqual(m.activeModel(old), s.RECOMMENDED_MODEL);
});

test("keys are kept, replaced or removed, and null goes back to the recommended model", () => {
	const current = { selected: { provider: "openrouter", id: "anthropic/claude-sonnet-5.5" }, keys: { openrouter: "sk-or-old" } };
	assert.deepEqual(m.mergeAgentModelConfig(current, { keys: { openrouter: "sk-or-new" } }).keys, { openrouter: "sk-or-new" });
	assert.deepEqual(m.mergeAgentModelConfig(current, { selected: null }), { keys: current.keys });
	assert.deepEqual(m.mergeAgentModelConfig(current, { keys: { openrouter: "" } }), { error: "Add your OpenRouter key." });
});

test("a picked model without its key runs the recommended one", () => {
	const pick = { provider: "openrouter", id: "x-ai/grok-4.7" };
	assert.deepEqual(m.activeModel({ selected: pick, keys: {} }), s.RECOMMENDED_MODEL);
	assert.deepEqual(m.activeModel({ selected: pick, keys: { openrouter: "k" } }), pick);
});

test("a Workers AI model Cloudflare stopped listing falls back to the recommended one", () => {
	const catalog = [{ provider: "workers-ai", id: "@cf/zai-org/glm-5.3" }];
	assert.deepEqual(m.resolveWorkersAiModel("@cf/zai-org/glm-5.3", catalog), { provider: "workers-ai", id: "@cf/zai-org/glm-5.3" });
	assert.deepEqual(m.resolveWorkersAiModel("@cf/old/retired", catalog), s.RECOMMENDED_MODEL);
	assert.deepEqual(m.resolveWorkersAiModel("@cf/old/retired", null), { provider: "workers-ai", id: "@cf/old/retired" });
});

test("config round-trips through R2", async () => {
	const env = { BUCKET: bucket() };
	const config = { selected: { provider: "openrouter", id: "openai/gpt-6-astra" }, keys: { openrouter: "sk-or-1" } };
	await m.writeAgentModelConfig(env, config);
	assert.deepEqual(await m.readAgentModelConfig(env), config);
});

test("Cloudflare's catalog keeps priced text models it serves itself, and marks which call tools", () => {
	const entry = (name, props, task = "Text Generation") => ({ name, task: { name: task }, properties: Object.entries(props).map(([property_id, value]) => ({ property_id, value })) });
	const price = [{ unit: "per M input tokens", price: 0.1 }, { unit: "per M output tokens", price: 0.2 }];
	const models = s.modelsFromWorkersAi([
		entry("@cf/zz/other", { function_calling: "true", context_window: "32000", price }),
		entry("@cf/aa/no-tools", { context_window: "8000", price }),
		entry("@cf/aa/embedder", { function_calling: "true", price }, "Text Embeddings"),
		entry("@cf/aa/unpriced", { function_calling: "true" }),
		entry("@cf/aa/empty-price", { function_calling: "true", price: [] }),
		entry("@cf/aa/zero", { function_calling: "true", price: [{ unit: "per M input tokens", price: 0 }, { unit: "per M output tokens", price: 0 }] }),
		entry("@cf/partner/model", { function_calling: "true", price, partner: "true" }),
	]);
	assert.deepEqual(models, [
		{ provider: "workers-ai", id: "@cf/zz/other", name: "Other", context: 32000, price: { input: 0.1, output: 0.2 }, tools: true },
		{ provider: "workers-ai", id: "@cf/aa/no-tools", name: "No Tools", context: 8000, price: { input: 0.1, output: 0.2 }, tools: false },
	]);
});

test("OpenRouter prices per token become per million", () => {
	const or = s.modelsFromZdr([
		{ model_id: "anthropic/claude-sonnet-5.5", model_name: "Anthropic: Claude Sonnet 5.5", context_length: 1000000, pricing: { prompt: "0.000002", completion: "0.00001" }, supported_parameters: ["tools"] },
		{ model_id: "openai/gpt-6-luna", model_name: "OpenAI: GPT-6 Luna", context_length: 1050000, pricing: { prompt: "0.0000001", completion: "0.0000005" }, supported_parameters: [] },
	]);
	assert.deepEqual(or[0], { provider: "openrouter", id: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5", context: 1000000, price: { input: 2, output: 10 }, tools: true, zdr: true });
	assert.equal(or[1].tools, false);
});

test("typed ids go to the provider they look like, and names read well", () => {
	assert.equal(s.guessProvider("@cf/meta/llama"), "workers-ai");
	assert.equal(s.guessProvider("anthropic/claude-fable-5.1"), "openrouter");
	assert.equal(s.guessProvider("claude-fable-5-1"), "openrouter");
	assert.equal(s.prettyName("@cf/deepseek-ai/deepseek-v4-pro-0813"), "DeepSeek V4 Pro 0813");
	assert.equal(s.prettyName("@cf/openai/gpt-oss-20b"), "GPT OSS 20B");
	assert.equal(s.makerOf({ provider: "openrouter", id: "x-ai/grok-4.7" }).label, "xAI");
	assert.equal(s.makerOf({ provider: "workers-ai", id: "@cf/zai-org/glm-5.2" }).label, "Z.ai");
});

test("free models are never offered or accepted", () => {
	assert.equal(s.isFree({ id: "maker/model:free", price: { input: 1, output: 1 } }), true);
	assert.equal(s.isFree({ id: "maker/model", price: { input: 0, output: 0 } }), true);
	assert.equal(s.isFree({ id: "maker/model", price: null }), false);
	assert.equal(s.validModelId("openrouter", "maker/model:free"), false);
	assert.ok("error" in m.mergeAgentModelConfig({ keys: { openrouter: "sk-or-x" } }, { selected: { provider: "openrouter", id: "maker/model:free" } }));
});

test("OpenRouter's list comes from its zero retention endpoints, priced at the cheapest", () => {
	const zdr = s.modelsFromZdr([
		{ model_id: "a/private", context_length: 32000, pricing: { prompt: "0.000003", completion: "0.000009" }, supported_parameters: [] },
		{ model_id: "a/private", context_length: 128000, pricing: { prompt: "0.000002", completion: "0.000004" }, supported_parameters: ["tools"] },
		{ model_id: "a/gratis", pricing: { prompt: "0", completion: "0" } },
		{ model_id: "a/gratis:free", pricing: { prompt: "0.000001", completion: "0.000001" } },
		{ pricing: { prompt: "0.000001", completion: "0.000001" } },
	]);
	assert.deepEqual(zdr.map((x) => x.id), ["a/private"]);
	assert.deepEqual(zdr[0].price, { input: 2, output: 4 });
	assert.equal(zdr[0].context, 128000);
	assert.equal(zdr[0].tools, true);
});

test("OpenRouter lists every paid model and marks the zero retention ones", () => {
	const zdr = s.modelsFromZdr([{ model_id: "a/private", pricing: { prompt: "0.000002", completion: "0.000004" }, supported_parameters: ["tools"] }]);
	const all = s.modelsFromOpenRouter([
		{ id: "a/private", name: "A: Private", pricing: { prompt: "0.000009", completion: "0.000009" } },
		{ id: "a/keeps", name: "A: Keeps", context_length: 64000, pricing: { prompt: "0.000001", completion: "0.000003" }, supported_parameters: ["tools"] },
		{ id: "a/gratis", pricing: { prompt: "0", completion: "0" } },
		{ id: "a/gratis:free", pricing: { prompt: "0.000001", completion: "0.000001" } },
		{ id: "a/unpriced" },
		{ id: "~a/keeps-latest", pricing: { prompt: "0.000001", completion: "0.000003" } },
		{ id: "a/keeps:batch", pricing: { prompt: "0.000001", completion: "0.000003" } },
	], zdr);
	assert.deepEqual(all.map((x) => [x.id, x.zdr]), [["a/private", true], ["a/keeps", false]]);
	assert.deepEqual(all[0].price, { input: 2, output: 4 });
	assert.deepEqual(all[1], { provider: "openrouter", id: "a/keeps", name: "Keeps", context: 64000, price: { input: 1, output: 3 }, tools: true, zdr: false });
});

test("every OpenRouter request refuses data collection; zero retention only when the model has it", async () => {
	const real = globalThis.fetch;
	const sent = [];
	globalThis.fetch = async (_url, init) => { sent.push(JSON.parse(init.body)); return new Response("{}"); };
	try {
		for (const zdr of [true, false]) {
			await m.privacyFetch(zdr)("https://openrouter.ai/api/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "a/b", provider: { order: ["x"] } }) });
		}
	} finally {
		globalThis.fetch = real;
	}
	assert.deepEqual(sent[0].provider, { order: ["x"], zdr: true, data_collection: "deny" });
	assert.deepEqual(sent[1].provider, { order: ["x"], data_collection: "deny" });
});

test("stored keys for providers that can't be connected are deleted on read", async () => {
	const env = { BUCKET: bucket() };
	env.BUCKET.store.set("config/agent-model.json", JSON.stringify({ selected: { provider: "anthropic", id: "claude-x" }, keys: { anthropic: "sk-ant-1", openrouter: "sk-or-1" } }));
	assert.deepEqual(await m.readAgentModelConfig(env), { keys: { openrouter: "sk-or-1" } });
	assert.ok(!env.BUCKET.store.get("config/agent-model.json").includes("sk-ant"));
});

test("free models are refused in any case, and an old free pick is dropped", () => {
	assert.equal(s.validModelId("openrouter", "meta-llama/llama-3.3-70b-instruct:FREE"), false);
	assert.equal(s.isFree({ id: "a/b:Free", price: { input: 1, output: 1 } }), true);
	const merged = m.mergeAgentModelConfig({ keys: { openrouter: "sk-or-1234567890" } }, { selected: { provider: "openrouter", id: "a/b:FREE" } });
	assert.ok("error" in merged && /Free models/.test(merged.error));
	const saved = m.parseAgentModelConfig({ selected: { provider: "openrouter", id: "a/b:free" }, keys: { openrouter: "sk-or-1234567890" } });
	assert.deepEqual(m.activeModel(saved), s.RECOMMENDED_MODEL);
});

test("a catalog that failed is retried after a minute, not on every run", async () => {
	m.clearCatalogCache();
	let calls = 0;
	const env = { AI: { models: async () => { calls++; throw new Error("down"); } } };
	const first = await m.catalogFor(env, "workers-ai", {});
	assert.equal(first.source, "none");
	await m.catalogFor(env, "workers-ai", {});
	assert.equal(calls, 1);
	m.clearCatalogCache();
});

test("when only the zero retention list fails, requests still ask for zero retention", async () => {
	m.clearCatalogCache();
	const realFetch = globalThis.fetch;
	globalThis.fetch = async (url) => String(url).endsWith("/endpoints/zdr")
		? new Response("down", { status: 503 })
		: Response.json({ data: [{ id: "maker/model", name: "Model", context_length: 1000, pricing: { prompt: "0.000001", completion: "0.000002" } }] });
	try {
		const catalog = await m.catalogFor({}, "openrouter", {});
		assert.equal(catalog.source, "live");
		assert.equal(catalog.zdrUnknown, true);
		assert.equal(await m.openRouterZdr({}, "maker/model"), true);
	} finally {
		globalThis.fetch = realFetch;
		m.clearCatalogCache();
	}
});
