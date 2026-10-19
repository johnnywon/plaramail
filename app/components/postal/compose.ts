// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useQueries, useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { useCallback, useMemo } from "react";
import { extractReplyQuote, getReplyAddresses } from "~/lib/reply";
import { escapeHtml, getSignatureBlock, htmlToPlainText, splitEmailList } from "~/lib/utils";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";
import type { DraftNotes } from "shared/draft-notes";
import type { Email, Mailbox } from "~/types";
import { handleOf } from "./identity";
import { ADDRESS_RE, fullDate } from "./model";

export type ComposeMode = "new" | "reply" | "reply-all" | "forward";

export interface Recipient {
	addr: string;
	name?: string;
}

export interface ComposeFile {
	name: string;
	size: number;
	type: string;
	/** base64; empty for a file of the forwarded original */
	content: string;
	/** A file of the forwarded original, which the Worker copies when it sends. */
	attachmentId?: string;
}

/** Files as the send request carries them: new files by content, the forwarded original's by id. */
export function sendFiles(files: ComposeFile[]) {
	const added = files.filter((f) => !f.attachmentId);
	const kept = files.flatMap((f) => (f.attachmentId ? [f.attachmentId] : []));
	return {
		attachments: added.length
			? added.map((f) => ({ content: f.content, filename: f.name, type: f.type || "application/octet-stream", disposition: "attachment" as const }))
			: undefined,
		forward_attachments: kept.length ? kept : undefined,
	};
}

export interface ComposeState {
	mode: ComposeMode;
	from: string;
	to: Recipient[];
	cc: Recipient[];
	bcc: Recipient[];
	showCc: boolean;
	showBcc: boolean;
	subject: string;
	/** What the user writes. */
	html: string;
	files: ComposeFile[];
	/** Server draft this compose replaces when saved or sent. */
	draftId?: string;
	/** The message being replied to or forwarded. */
	originalId?: string;
	/** The address that received the original, where the agent finds it. */
	originalMailbox?: string;
	/** Quoted original, appended when sending. */
	quoteHtml?: string;
	/** Header line and sanitized HTML of the original, for the preview under the editor. */
	quoteHead?: string;
	quoteBody?: string;
	/** Include the From address's signature. Undefined follows that address's default. */
	signature?: boolean;
	/** Ask the agent for a draft as soon as the composer opens. */
	askAgent?: boolean;
	/** Idempotency key for this compose, so a retried Send never sends twice. */
	sendKey?: string;
	/** Set when an agent wrote the saved draft: how, and the redraft instructions so far. */
	notes?: DraftNotes;
}

export function emptyCompose(from: string): ComposeState {
	return { mode: "new", from, to: [], cc: [], bcc: [], showCc: false, showBcc: false, subject: "", html: "", files: [], sendKey: crypto.randomUUID() };
}

export function isValidAddress(addr: string): boolean {
	return ADDRESS_RE.test(addr.trim());
}

/** "Dana <dana@example.com>" or a bare address. */
export function parseRecipient(raw: string): Recipient | null {
	const v = raw.trim().replace(/[,;]$/, "").trim();
	if (!v) return null;
	const m = v.match(/^(.*)<(.+)>$/);
	if (m) return { addr: m[2].trim(), name: m[1].trim().replace(/^"|"$/g, "") || undefined };
	return { addr: v };
}

export function recipientsFromText(text: string): Recipient[] {
	return splitEmailList(text.replace(/;/g, ",")).map(parseRecipient).filter((r): r is Recipient => !!r);
}

export function recipientsToText(list: Recipient[]): string {
	return list.map((r) => r.addr).join(", ");
}

function prefixed(subject: string, prefix: "Re" | "Fwd") {
	const base = subject.replace(/^((re|fwd?|fw):\s*)+/i, "");
	return `${prefix}: ${base}`;
}

/**
 * The original message as HTML that is safe to quote: no styles, scripts or
 * document chrome. Plain-text mail becomes paragraphs.
 */
export function quotableHtml(body: string): string {
	if (!/<[a-z][\s\S]*>/i.test(body)) return `<p>${escapeHtml(body).replace(/\r?\n/g, "<br>")}</p>`;
	return String(
		DOMPurify.sanitize(body, {
			USE_PROFILES: { html: true },
			FORBID_TAGS: ["style", "script", "title", "head", "meta", "link", "form", "input", "button"],
			FORBID_ATTR: ["class", "id"],
		}),
	);
}

/** Reply, reply all or forward of a message, From set to the address it was delivered to. */
export function composeFor(mode: Exclude<ComposeMode, "new">, original: Email, mailboxId: string, from: string): ComposeState {
	const self = mailboxId.toLowerCase();
	const replyTo = getReplyAddresses(original).filter((a) => a.toLowerCase() !== self);
	let to: Recipient[] = [];
	let cc: Recipient[] = [];
	if (mode === "reply") to = (replyTo.length ? replyTo : [original.sender]).map((addr) => ({ addr }));
	if (mode === "reply-all") {
		const seen = new Set<string>([self]);
		const take = (list: string[]) =>
			list.filter((a) => {
				const k = a.toLowerCase();
				if (seen.has(k)) return false;
				seen.add(k);
				return true;
			}).map((addr) => ({ addr }));
		to = take([...replyTo, ...splitEmailList(original.recipient)]);
		cc = take(splitEmailList(original.cc));
	}
	const forward = mode === "forward";
	const when = original.date ? fullDate(original.date).replace(" · ", ", ") : "";
	const sender = escapeHtml(original.sender);
	// A notification can mark the part a reply should quote (data-reply-quote); quote only that.
	const marked = forward ? null : extractReplyQuote(original.body);
	const body = marked !== null ? `<p>${escapeHtml(marked).replace(/\r?\n/g, "<br>")}</p>` : quotableHtml(original.body || "");
	const quoteHead = forward ? `Forwarded message · ${when} · ${original.sender}` : `On ${when}, ${original.sender} wrote:`;
	const quoteHtml = forward
		? `<p><br></p><div>---------- Forwarded message ----------<br>From: ${sender}<br>Date: ${escapeHtml(when)}<br>Subject: ${escapeHtml(original.subject || "")}<br>To: ${escapeHtml(original.recipient || "")}</div><br>${body}`
		: `<p><br></p><div>On ${escapeHtml(when)}, ${sender} wrote:</div><blockquote style="margin: 8px 0 0; padding: 8px 12px; border: 1px solid #dddddd; background-color: #fafafa;">${body}</blockquote>`;
	return {
		mode,
		from,
		to,
		cc,
		bcc: [],
		showCc: cc.length > 0 || mode === "reply-all",
		showBcc: false,
		subject: prefixed(original.subject || "", forward ? "Fwd" : "Re"),
		html: "",
		files: forward
			? (original.attachments ?? [])
				.filter((a) => a.disposition !== "inline")
				.map((a) => ({ name: a.filename, size: a.size, type: a.mimetype, content: "", attachmentId: a.id }))
			: [],
		originalId: original.id,
		originalMailbox: self,
		quoteHtml,
		quoteHead,
		quoteBody: body,
		sendKey: crypto.randomUUID(),
	};
}

/**
 * Open a saved draft for editing. Its body already holds any quote. No
 * sendKey: sending falls back to `draft:<id>`, the key every sender of a
 * saved draft uses, so the draft goes out once.
 */
export function composeFromDraft(draft: Email, mailboxId: string): ComposeState {
	const to = recipientsFromText(draft.recipient || "");
	const cc = recipientsFromText(draft.cc || "");
	const bcc = recipientsFromText(draft.bcc || "");
	return {
		mode: draft.in_reply_to ? "reply" : "new",
		from: mailboxId,
		to,
		cc,
		bcc,
		showCc: cc.length > 0,
		showBcc: bcc.length > 0,
		subject: draft.subject || "",
		html: draft.body || "",
		files: [],
		draftId: draft.id,
		originalId: draft.in_reply_to || undefined,
		originalMailbox: mailboxId,
		notes: draft.draft_notes,
	};
}

// ── Address details ──────────────────────────────────────────────────

export interface AddressInfo {
	address: string;
	name: string;
	mailbox?: Mailbox;
	/** The address's signature, empty when none is set. */
	signatureText: string;
	signatureHtml: string;
	/** Add the signature to new mail and replies unless the writer removes it. */
	signatureDefault: boolean;
}

/** Display names and signatures for every address, from each mailbox's settings. */
export function useAddressInfo(addresses: string[]) {
	const results = useQueries({
		queries: addresses.map((address) => ({
			queryKey: queryKeys.mailboxes.detail(address),
			queryFn: () => api.getMailbox(address),
			staleTime: 60_000,
			retry: false,
		})),
	});
	const data = results.map((r) => r.data);
	return useMemo(() => {
		const map = new Map<string, AddressInfo>();
		addresses.forEach((address, i) => {
			const mailbox = data[i];
			const name = mailbox?.settings?.fromName?.trim() || handleOf(address);
			const sig = mailbox?.settings?.signature;
			const hasSignature = !!(sig?.html?.replace(/<[^>]+>/g, "").trim() || sig?.text?.trim());
			map.set(address, {
				address,
				name,
				mailbox,
				signatureText: hasSignature ? sig?.text || "" : "",
				signatureHtml: hasSignature ? getSignatureBlock({ signature: { ...sig!, enabled: true } }) : "",
				signatureDefault: hasSignature && !!sig?.enabled,
			});
		});
		return map;
	}, [addresses, ...data]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ── Send, save, schedule ─────────────────────────────────────────────

function listValue(list: Recipient[]): string | string[] | undefined {
	const addrs = list.map((r) => r.addr.trim()).filter(Boolean);
	if (!addrs.length) return undefined;
	return addrs.length === 1 ? addrs[0] : addrs;
}

export class ComposeError extends Error {}

/** Whether this message carries its From address's signature. */
export function usesSignature(state: ComposeState, info: ReadonlyMap<string, AddressInfo>): boolean {
	const sig = info.get(state.from);
	if (!sig?.signatureHtml) return false;
	return state.signature ?? sig.signatureDefault;
}

export function useMailSender(info: ReadonlyMap<string, AddressInfo>) {
	const queryClient = useQueryClient();

	const refresh = useCallback(
		(mailboxId: string) => {
			for (const queryKey of [["mail"], ["mail-facets"], ["emails", mailboxId], ["scheduled"], ["agent-drafts"]]) queryClient.invalidateQueries({ queryKey });
		},
		[queryClient],
	);

	const payload = useCallback(
		(state: ComposeState) => {
			const invalid = [...state.to, ...state.cc, ...state.bcc].find((r) => !isValidAddress(r.addr));
			if (invalid) throw new ComposeError(`Check the address ${invalid.addr}.`);
			const to = listValue(state.to);
			if (!to) throw new ComposeError("Add at least one recipient.");
			const sender = info.get(state.from);
			const name = sender?.name;
			const html = `${state.html || "<p></p>"}${usesSignature(state, info) ? sender?.signatureHtml ?? "" : ""}${state.quoteHtml ?? ""}`;
			return {
				to,
				cc: listValue(state.cc),
				bcc: listValue(state.bcc),
				from: name && name !== state.from ? { email: state.from, name } : state.from,
				subject: state.subject,
				html,
				text: htmlToPlainText(html),
				...sendFiles(state.files),
			};
		},
		[info],
	);

	const send = useCallback(
		async (state: ComposeState) => {
			const email = payload(state);
			const replying = (state.mode === "reply" || state.mode === "reply-all") && state.originalId;
			const key = state.sendKey ?? (state.draftId ? `draft:${state.draftId}` : undefined);
			if (replying) await api.replyToEmail(state.from, state.originalId!, email, key);
			else if (state.mode === "forward" && state.originalId) await api.forwardEmail(state.from, state.originalId, email, key);
			else await api.sendEmail(state.from, email, key);
			if (state.draftId) await api.deleteEmail(state.from, state.draftId).catch(() => {});
			refresh(state.from);
		},
		[payload, refresh],
	);

	const save = useCallback(
		async (state: ComposeState): Promise<string> => {
			const result = await api.saveDraft(state.from, {
				to: recipientsToText(state.to),
				cc: recipientsToText(state.cc) || undefined,
				bcc: recipientsToText(state.bcc) || undefined,
				subject: state.subject,
				body: `${state.html}${state.quoteHtml ?? ""}`,
				in_reply_to: state.originalId,
				draft_id: state.draftId,
			});
			refresh(state.from);
			return (result as { id?: string; draft_id?: string }).id ?? (result as { draft_id?: string }).draft_id ?? "";
		},
		[refresh],
	);

	const discard = useCallback(
		async (state: ComposeState) => {
			if (!state.draftId) return;
			await api.deleteEmail(state.from, state.draftId).catch(() => {});
			refresh(state.from);
		},
		[refresh],
	);

	const schedule = useCallback(
		async (state: ComposeState, at: Date) => {
			const email = payload(state);
			await api.scheduleSend(state.from, {
				sendAt: at.toISOString(),
				draft_id: state.draftId,
				mode: state.mode,
				original_id: state.mode === "new" ? undefined : state.originalId,
				email,
			});
			refresh(state.from);
		},
		[payload, refresh],
	);

	return { send, save, discard, schedule };
}

export async function readFiles(list: FileList | File[]): Promise<ComposeFile[]> {
	const files = Array.from(list);
	return Promise.all(
		files.map(
			(file) =>
				new Promise<ComposeFile>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => {
						const url = String(reader.result);
						resolve({ name: file.name, size: file.size, type: file.type, content: url.slice(url.indexOf(",") + 1) });
					};
					reader.onerror = () => reject(reader.error);
					reader.readAsDataURL(file);
				}),
		),
	);
}

/** Plain text from the agent as editor paragraphs. */
export function textToParagraphs(text: string): string {
	return text
		.trim()
		.split(/\n{2,}/)
		.map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
		.join("");
}

// ── Pop-out handoff ──────────────────────────────────────────────────

export const HANDOFF_KEY = "pm-compose-handoff";

export function handOff(state: ComposeState): boolean {
	try {
		window.localStorage.setItem(HANDOFF_KEY, JSON.stringify(state));
	} catch {
		return false;
	}
	const win = window.open(`${window.location.pathname}${window.location.search}#compose`, `pm-compose-${Date.now()}`, "width=760,height=780");
	return !!win;
}

export function takeHandoff(): ComposeState | null {
	try {
		const raw = window.localStorage.getItem(HANDOFF_KEY);
		if (!raw) return null;
		window.localStorage.removeItem(HANDOFF_KEY);
		return JSON.parse(raw) as ComposeState;
	} catch {
		return null;
	}
}
