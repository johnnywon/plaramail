// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { ArrowSquareOutIcon, PlayIcon, StopIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { TEST_DEFAULT, TEST_MAX, testCounts, type TestOutcome } from "shared/agent-test";
import { differs, WORK_LABELS } from "shared/agent-work";
import api, { type Agent, type AgentTest } from "~/services/api";
import { when } from "./ActivityTab";
import { useOpenMessage } from "./console-message";
import { Badge, Button, Item, List, Note, NumberInput, Section, Segmented } from "./ConsoleUI";
import { AddressText, type Identities } from "./identity";

const OUTCOMES: Record<TestOutcome, { label: string; tone: "neutral" | "watch" | "ok" | "warn" | "danger" }> = {
	pending: { label: "Waiting", tone: "neutral" },
	running: { label: "Testing", tone: "watch" },
	took: { label: "Took", tone: "ok" },
	left: { label: "Left", tone: "neutral" },
	skipped: { label: "Skipped", tone: "warn" },
	failed: { label: "Failed", tone: "danger" },
};

export const agentTestKey = (agentId: string) => ["agent-test", agentId] as const;

/** The agent's latest test run, shared by Test and the Trust gate. */
export function useAgentTest(agentId: string) {
	return useQuery({ queryKey: agentTestKey(agentId), queryFn: () => api.getAgentTest(agentId) });
}

const dollars = (cost: number) => `$${cost < 0.01 && cost > 0 ? cost.toFixed(4) : cost.toFixed(2)}`;

/** One line under the form: how far a run is, or what it found and what it cost. */
function testLine(test: AgentTest): string {
	const c = testCounts(test.results);
	const tested = c.total - c.waiting;
	if (test.state === "running") return `Testing ${Math.min(tested + 1, c.total)} of ${c.total}`;
	const parts = [`${c.took} took`, `${c.left} left`];
	if (c.skipped) parts.push(`${c.skipped} skipped`);
	if (c.failed) parts.push(`${c.failed} failed`);
	const tokens = `${(test.inputTokens + test.outputTokens).toLocaleString()} tokens`;
	const cost = test.cost == null ? "no listed price" : dollars(test.cost);
	const head = test.state === "stopped" ? `Stopped at ${tested}` : `${tested} tested`;
	return `${head}, ${parts.join(", ")}. ${tokens}, ${cost}.`;
}

/**
 * Test on past mail: the agent runs on received mail it already has, and nothing is sent or saved.
 * The browser asks for one message at a time, so a run picks up again when the page comes back.
 */
export function AgentTestSection({ agent, identities }: { agent: Agent; identities: Identities }) {
	const queryClient = useQueryClient();
	const openMessage = useOpenMessage();
	const query = useAgentTest(agent.id);
	const test = query.data ?? null;
	const [search, setSearch] = useState(() => test?.search ?? "");
	const [count, setCount] = useState(String(TEST_DEFAULT));
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [retry, setRetry] = useState(0);
	const [open, setOpen] = useState<number | null>(null);
	const [filter, setFilter] = useState<TestOutcome | "all" | "differs">("all");
	const running = test?.state === "running";
	const set = (t: AgentTest | null) => queryClient.setQueryData(agentTestKey(agent.id), t);

	// While a run is going, ask for the next message until none is left.
	useEffect(() => {
		if (!running || !test) return;
		let cancelled = false;
		(async () => {
			while (!cancelled) {
				let next: AgentTest | null;
				try {
					next = await api.nextAgentTest(agent.id);
				} catch (e) {
					if (!cancelled) setError((e as Error).message || "The test stopped");
					return;
				}
				if (cancelled) return;
				set(next);
				if (next?.state !== "running") {
					queryClient.invalidateQueries({ queryKey: ["agents"] });
					return;
				}
			}
		})();
		return () => { cancelled = true; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [agent.id, test?.id, running, retry]);

	const n = Number(count);
	const countOk = Number.isInteger(n) && n >= 1 && n <= TEST_MAX;
	const start = async () => {
		setError(null);
		setBusy(true);
		try {
			set(await api.startAgentTest(agent.id, { search: search.trim() || undefined, limit: n }));
			setOpen(null);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	};
	const stop = async () => {
		setBusy(true);
		try {
			set(await api.stopAgentTest(agent.id));
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	};
	const done = (test?.results ?? []).filter((r) => r.outcome !== "pending");
	const pick = (f: typeof filter) => (f === "all" ? done : f === "differs" ? done.filter(differs) : done.filter((r) => r.outcome === f));
	const shown = pick(filter);
	const filters = (["all", "took", "left", "skipped", "failed", "differs"] as const)
		.map((f) => ({ value: f, n: pick(f).length }))
		.filter((f) => f.value === "all" || f.value === filter || f.n > 0)
		.map((f) => ({ value: f.value, label: `${f.value === "all" ? "All" : f.value === "differs" ? "Differs" : OUTCOMES[f.value].label} ${f.n}` }));

	return (
		<Section id="agent-test" title="Test on past mail">
			<form className="pg-ui-toolbar pg-ui-test-form" onSubmit={(e) => { e.preventDefault(); if (!running && countOk) void start(); }}>
				<input
					className="pg-input" type="search" value={search} disabled={running} aria-label="Search past mail"
					placeholder="Search past mail" onChange={(e) => setSearch(e.target.value)}
				/>
				<span className="pg-ui-test-count"><span aria-hidden>Last</span><NumberInput label="Last messages" value={count} min={1} max={TEST_MAX} invalid={!countOk} disabled={running} onChange={setCount} /></span>
				{running
					? <Button icon={<StopIcon size={12} />} disabled={busy} onClick={() => void stop()}>Stop</Button>
					: <Button type="submit" icon={<PlayIcon size={12} />} disabled={busy || !countOk}>Run test</Button>}
			</form>
			{error && (
				<Note tone="error">
					{error}
					{running && <> <Button size="sm" variant="quiet" onClick={() => { setError(null); setRetry((r) => r + 1); }}>Continue</Button></>}
				</Note>
			)}
			{query.isPending && <Note>Loading</Note>}
			{test && <Note tone={test.state === "running" ? "muted" : testCounts(test.results).failed ? "warn" : "muted"}>{testLine(test)}{test.search ? ` Search ${test.search}` : ""}</Note>}
			{test && running && (() => {
				const c = testCounts(test.results);
				const pct = c.total ? Math.round(((c.total - c.waiting) / c.total) * 100) : 0;
				return <svg className="pg-ui-test-bar" viewBox="0 0 100 4" preserveAspectRatio="none" role="progressbar" aria-label="Test progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><rect width="100" height="4" /><rect data-fill width={pct} height="4" /></svg>;
			})()}
			{done.length > 0 && <Segmented label="Show" value={filter} options={filters} onChange={(f) => { setFilter(f); setOpen(null); }} />}
			{test && shown.length > 0 && (
				<List label="Test results">
					{shown.map((r) => {
						const o = OUTCOMES[r.outcome];
						return (
							<Item
								key={r.position}
								badge={<Badge tone={o.tone} dot live={r.outcome === "running"}>{o.label}</Badge>}
								title={r.subject || "(no subject)"}
								time={when(r.date)}
								meta={<>
									{r.sender}<AddressText address={r.mailboxId} identity={identities.of(r.mailboxId)} bold={false} short />
									{r.then && <span className="pg-ui-then">Then <b>{WORK_LABELS[r.then]}</b></span>}
									{differs(r) && <Badge tone="warn">Differs</Badge>}
								</>}
								quote={open === r.position || r.reply ? undefined : r.reason ?? undefined}
								bad={r.outcome === "failed"}
								open={open === r.position}
								onClick={r.outcome === "running" ? undefined : () => setOpen(open === r.position ? null : r.position)}
							>
								{r.reply && <p className="pg-ui-test-reply">{r.reply}</p>}
								{r.reason && <Note tone={r.outcome === "failed" ? "error" : "muted"}>{r.reason}</Note>}
								<div className="pg-ui-toolbar">
									<Button size="sm" icon={<ArrowSquareOutIcon size={12} />} onClick={() => openMessage?.({ mailboxId: r.mailboxId, emailId: r.emailId })}>Open message</Button>
								</div>
							</Item>
						);
					})}
				</List>
			)}
		</Section>
	);
}
