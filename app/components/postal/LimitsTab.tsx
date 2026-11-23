// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AGENT_LIMIT_RANGES, type AgentLimits, DEFAULT_AGENT_LIMITS, parseAgentLimit, SEND_LIMITS } from "shared/send-limits";
import api from "~/services/api";
import { Badge, Field, Note, NumberInput } from "./ConsoleUI";

type Key = keyof AgentLimits;

const FIELDS: { key: Key; title: string; sub: string; unit: string }[] = [
	{ key: "agentDay", title: "Agent sends a day", sub: "Per address, by the agent and MCP clients together. 0 stops agent sending.", unit: "messages" },
	{ key: "agentRecipients", title: "Recipients per agent message", sub: "To, Cc and Bcc together.", unit: "recipients" },
	{ key: "autoDraftPerSender", title: "Auto-drafts per sender a day", sub: "Per address. Later mail from that sender is stored but not drafted. 0 stops auto-drafting.", unit: "drafts" },
];

/** The saved limits and an edit in progress, saved by the console's autosave. */
export function useAgentLimitsDraft() {
	const queryClient = useQueryClient();
	const saved = useQuery({ queryKey: ["agent-limits"], queryFn: () => api.getAgentLimits() });
	const [edits, setEdits] = useState<Partial<Record<Key, string>>>({});
	const base = saved.data ?? DEFAULT_AGENT_LIMITS;
	const text = (key: Key) => edits[key] ?? String(base[key]);
	const problem = (key: Key) => {
		const { min, max } = AGENT_LIMIT_RANGES[key];
		return parseAgentLimit(key, text(key)) === null ? `Use a whole number from ${min} to ${max}` : null;
	};
	const changed = FIELDS.filter(({ key }) => edits[key] !== undefined && text(key) !== String(base[key]));
	const dirty = changed.length > 0;
	/** Why save would fail, checked before anything else in the console is written. */
	const check = () => {
		if (!saved.data) return "Limits: the saved limits haven't loaded. Reload and try again.";
		const bad = FIELDS.find(({ key }) => problem(key));
		return bad ? `${bad.title}: ${problem(bad.key)}` : null;
	};
	const save = async () => {
		const error = check();
		if (error) throw new Error(error);
		// Only what changed, so a stale form can't overwrite the other limits.
		const next: Partial<AgentLimits> = Object.fromEntries(changed.map(({ key }) => [key, parseAgentLimit(key, text(key))]));
		await api.putAgentLimits(next);
		await queryClient.invalidateQueries({ queryKey: ["agent-limits"] });
		queryClient.invalidateQueries({ queryKey: ["agents-overview"] });
		setEdits({});
	};
	const valid = !FIELDS.some(({ key }) => problem(key));
	return { saved: saved.data, loadError: saved.isError, edits, text, problem, dirty, valid, check, save, set: (key: Key, value: string) => setEdits((cur) => ({ ...cur, [key]: value })) };
}

export function LimitsTab({ draft }: { draft: ReturnType<typeof useAgentLimitsDraft> }) {
	return (
		<>
			{draft.loadError && <Note tone="error">Couldn't load the saved limits. Reload to edit them.</Note>}
			{FIELDS.map(({ key, title, sub, unit }) => {
				const error = draft.problem(key);
				const { min, max } = AGENT_LIMIT_RANGES[key];
				return (
					<Field key={key} inline label={title} hint={`${sub} Default ${DEFAULT_AGENT_LIMITS[key]}.`} error={error}>
						<NumberInput label={title} min={min} max={max} value={draft.saved ? draft.text(key) : ""} disabled={!draft.saved} onChange={(v) => draft.set(key, v)} unit={unit} invalid={!!error} />
					</Field>
				);
			})}
			<Field inline label="Fixed for everyone" hint={`Each address sends at most ${SEND_LIMITS.hour} messages an hour and ${SEND_LIMITS.day} a day, people and agents together, with up to ${SEND_LIMITS.recipients} recipients per message. Agent limits sit inside these. Agents can't change any limit.`}>
				<Badge>fixed</Badge>
			</Field>
		</>
	);
}
