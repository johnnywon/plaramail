// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	ArchiveIcon, ArrowBendDoubleUpLeftIcon, ArrowBendUpLeftIcon, ArrowBendUpRightIcon, CalendarBlankIcon, CaretLeftIcon, CheckIcon, CodeIcon, DownloadSimpleIcon, EnvelopeOpenIcon, EnvelopeSimpleIcon, FileAudioIcon, FileCodeIcon, FileDocIcon, FileIcon, FileImageIcon, FilePdfIcon, FilePptIcon, FileTextIcon, FileVideoIcon, FileXlsIcon, FileZipIcon, ImageIcon, PaperclipIcon, PencilSimpleLineIcon, PlusIcon, StarIcon, TagIcon, TrashIcon, TrayArrowUpIcon, WarningIcon, WarningOctagonIcon, XIcon,
} from "@phosphor-icons/react";
import { AgentIcon } from "./AgentIcon";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Folders } from "shared/folders";
import EmailIframe, { type EmailPalette, hasRemoteImages, isPlainHtml, MailText } from "~/components/EmailIframe";
import { isHtmlBody } from "~/components/plain-text";
import { getAttachmentUrl, getNonInlineAttachments, messageBodyHtml } from "~/lib/utils";
import { useEmail, useMarkThreadRead, useThreadReplies } from "~/queries/emails";
import type { Conversation, Label } from "~/services/api";
import type { Email } from "~/types";
import type { DraftResult } from "./Agent";
import type { AddressInfo, ComposeMode, ComposeState, useMailSender } from "./compose";
import { Composer } from "./ComposeWindow";
import { AddressText, type Identities, LabelTag, Swatch } from "./identity";
import { formatSize, fullDate, type MailAction, nameFromHeaders } from "./model";
import type { Prefs } from "./prefs";
import { useShortcuts } from "./shortcuts";

type Sender = ReturnType<typeof useMailSender>;

export interface ReaderProps {
	row?: Conversation;
	open: { mailboxId: string; emailId: string } | null;
	/** Opened by the layout, not the user: shown without marking it read. */
	autoOpened: boolean;
	identities: Identities;
	info: ReadonlyMap<string, AddressInfo>;
	addresses: string[];
	prefs: Prefs;
	labels: Label[];
	labelsById: ReadonlyMap<string, Label>;
	canTrash: boolean;
	canSpam: boolean;
	canRestore: boolean;
	onBack: () => void;
	onAction: (action: MailAction) => void;
	onLabel: (label: Label, add: boolean) => void;
	onCreateLabel: (name: string) => void;
	/** The open reply composer, keyed so a mode switch starts it afresh. */
	inline: { key: number; initial: ComposeState } | null;
	onInlineClosed: (message: string | null) => void;
	startReply: (mode: Exclude<ComposeMode, "new">, original: Email, keep?: ComposeState, askAgent?: boolean) => void;
	sender: Sender;
	onPopOut: (state: ComposeState) => void;
	onEditDraft: (draft: Email) => void;
	onEditSignatures: () => void;
	draftWithAgent: (state: ComposeState) => Promise<DraftResult>;
	replyRequest: { mode: Exclude<ComposeMode, "new">; id: number } | null;
	/** Changes when the label shortcut asks for the label picker. */
	labelRequest: number;
}

function sortAsc(list: Email[]) {
	return [...list].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export function Reader(props: ReaderProps) {
	const { row, open, identities } = props;
	const { data: email } = useEmail(open?.mailboxId, open?.emailId);
	const { data: thread } = useThreadReplies(open?.mailboxId, email?.thread_id);
	const markThreadRead = useMarkThreadRead();
	const [shownImages, setShownImages] = useState<Set<string>>(new Set());
	const [pickerOpen, setPickerOpen] = useState(false);
	const [pickerLeft, setPickerLeft] = useState(8);
	const labelBtn = useRef<HTMLButtonElement>(null);
	const sectionRef = useRef<HTMLElement>(null);
	const openPicker = (force = false) => {
		const b = labelBtn.current?.getBoundingClientRect();
		const r = sectionRef.current?.getBoundingClientRect();
		if (b && r) setPickerLeft(Math.max(8, Math.min(b.left - r.left, r.width - 268)));
		setPickerOpen((v) => force || !v);
	};
	const { tip } = useShortcuts();
	const [source, setSource] = useState<Email | null>(null);
	const marked = useRef<string | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);

	const messages = useMemo(() => {
		if (!email) return [];
		const others = (thread ?? []).filter((m) => m.id !== email.id);
		return sortAsc([email, ...others]);
	}, [email, thread]);
	const latest = messages[messages.length - 1];
	const self = open?.mailboxId ?? "";
	// Reply to the open message, unless it is your own or a draft; then to the latest mail you received.
	const original = useMemo(() => {
		if (email && email.folder_id !== Folders.DRAFT && email.sender.toLowerCase() !== self) return email;
		const received = messages.filter((m) => m.folder_id !== Folders.DRAFT && m.sender.toLowerCase() !== self);
		return received[received.length - 1] ?? messages.filter((m) => m.folder_id !== Folders.DRAFT).pop() ?? latest;
	}, [email, messages, self, latest]);
	const draft = messages.find((m) => m.folder_id === Folders.DRAFT);

	// Opening marks the conversation read, once, unless the setting is off or the layout opened it.
	useEffect(() => {
		if (!open || props.autoOpened || !props.prefs.markRead || !email || email.id !== open.emailId || marked.current === email.id) return;
		marked.current = email.id;
		if (row && !row.unread) return;
		if (email.thread_id) markThreadRead.mutate({ mailboxId: open.mailboxId, threadId: email.thread_id });
		else if (!email.read) props.onAction("read");
	}, [open, props.autoOpened, props.prefs.markRead, email, row]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		setPickerOpen(false);
		scrollRef.current?.scrollTo({ top: 0 });
	}, [open?.mailboxId, open?.emailId]);

	// r / a / f from the keyboard.
	useEffect(() => {
		if (props.replyRequest && original) props.startReply(props.replyRequest.mode, original);
	}, [props.replyRequest]); // eslint-disable-line react-hooks/exhaustive-deps

	// l from the keyboard.
	useEffect(() => {
		if (props.labelRequest && row) openPicker(true);
	}, [props.labelRequest]); // eslint-disable-line react-hooks/exhaustive-deps

	if (!open) {
		return (
			<section className="pg-reader" aria-label="Message">
				<div className="pg-idle">
					<p>Pick a conversation.</p>
				</div>
			</section>
		);
	}

	const sent = row?.state === "sent";
	const mailbox = open.mailboxId;
	const identity = identities.of(mailbox);
	const head = email;
	const senderName = head ? (sent ? head.recipient : nameFromHeaders(head.raw_headers, row?.sender_name || head.sender)) : row?.sender_name ?? "";
	const senderAddr = head ? (sent ? "" : head.sender) : row?.sender_addr ?? "";
	const rowLabels = (row?.labels ?? []).map((id) => props.labelsById.get(id)).filter((l): l is Label => !!l);
	const starred = row?.starred ?? !!email?.starred;
	const attachmentCount = email ? getNonInlineAttachments(email.attachments).length : 0;
	const unread = row?.unread ?? false;
	const reply = (mode: Exclude<ComposeMode, "new">) => original && props.startReply(mode, original);

	// The message's letterhead: who and where on the left, when on the right, inside the page.
	const when = (head ? fullDate(head.date) : row ? fullDate(row.date) : "").split(" · ");
	const letterhead = (
		<>
			{rowLabels.length > 0 && (
				<div className="pg-mrail" aria-label="Labels">
					{rowLabels.map((l) => (
						<span key={l.id} className="pg-mrail-label"><LabelTag id={l.id} size={10} />{l.name}</span>
					))}
				</div>
			)}
		<header className="pg-mhead">
			<div className="pg-mhead-who">
				<div className="pg-mhead-from">
					{sent ? <span className="pg-mhead-word">To</span> : <span className="pg-sr">From</span>}
					<span className="pg-mhead-name" title={senderName}>{senderName}</span>
					{senderAddr && senderAddr.toLowerCase() !== senderName.toLowerCase() && <span className="pg-mhead-addr" title={senderAddr}>{senderAddr}</span>}
				</div>
				<div className="pg-mhead-to">
					<span className="pg-mhead-where" title={sent ? `Sent from ${mailbox}` : `Delivered to ${mailbox} · Replies send from here`}>
						<span className="pg-mhead-word">{sent ? "from" : "to"}</span>
						<Swatch identity={identity} />
						<AddressText address={mailbox} identity={identity} bold={false} />
					</span>
					{attachmentCount > 0 && (
						<button
							type="button"
							className="pg-attach-count"
							title={attachmentCount === 1 ? "1 attachment" : `${attachmentCount} attachments`}
							onClick={() => scrollRef.current?.querySelector(".pg-attachments")?.scrollIntoView({ behavior: "smooth", block: "nearest" })}
						>
							<PaperclipIcon size={14} />{attachmentCount}
						</button>
					)}
				</div>
			</div>
			{when[0] && (
				<>
					<span className="pg-sr">{sent ? "Sent" : "Received"}</span>
					<time className="pg-mhead-when" dateTime={head?.date ?? row?.date}>
						<span>{when[0]}</span>
						<span>{when[1]}</span>
					</time>
				</>
			)}
		</header>
		</>
	);
	return (
		<section className="pg-reader" aria-label="Message" ref={sectionRef}>
			{pickerOpen && row && (
				<LabelPicker
					left={pickerLeft}
					labels={props.labels}
					active={new Set(row.labels)}
					onToggle={(l, add) => props.onLabel(l, add)}
					onCreate={props.onCreateLabel}
					onClose={() => setPickerOpen(false)}
				/>
			)}
			<div className="pg-reader-bar" role="toolbar" aria-label="Message actions">
				<div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
					<button type="button" className="pg-icon-btn pg-back" onClick={props.onBack} aria-label="Back to list"><CaretLeftIcon size={16} weight="bold" /></button>
					<div className="pg-group">
						<button type="button" className="pg-icon-btn" title={tip("reply", "Reply")} aria-label="Reply" onClick={() => reply("reply")} disabled={!original}><ArrowBendUpLeftIcon size={16} /></button>
						<button type="button" className="pg-icon-btn" title={tip("replyAll", "Reply all")} aria-label="Reply all" onClick={() => reply("reply-all")} disabled={!original}><ArrowBendDoubleUpLeftIcon size={16} /></button>
						<button type="button" className="pg-icon-btn" title={tip("forward", "Forward")} aria-label="Forward" onClick={() => reply("forward")} disabled={!original}><ArrowBendUpRightIcon size={16} /></button>
					</div>
					<div className="pg-group">
						{props.canRestore && <button type="button" className="pg-icon-btn" title="Move to Inbox" aria-label="Move to Inbox" onClick={() => props.onAction("restore")} disabled={!row}><TrayArrowUpIcon size={16} /></button>}
						<button type="button" className="pg-icon-btn" title={tip("archive", "Archive")} aria-label="Archive" onClick={() => props.onAction("archive")} disabled={!row}><ArchiveIcon size={16} /></button>
						<button type="button" className="pg-icon-btn" title={tip("trash", "Move to Trash")} aria-label="Move to Trash" onClick={() => props.onAction("trash")} disabled={!row || !props.canTrash}><TrashIcon size={16} /></button>
						{props.canSpam && <button type="button" className="pg-icon-btn" title={tip("spam", "Report spam")} aria-label="Report spam" onClick={() => props.onAction("spam")} disabled={!row}><WarningOctagonIcon size={16} /></button>}
					</div>
					<div className="pg-group" style={{ position: "relative" }}>
						<button type="button" className="pg-icon-btn" title={unread ? tip("markRead", "Mark read") : tip("markUnread", "Mark unread")} aria-label={unread ? "Mark read" : "Mark unread"} onClick={() => props.onAction("read")} disabled={!row}>
							{unread ? <EnvelopeOpenIcon size={16} /> : <EnvelopeSimpleIcon size={16} />}
						</button>
						<button type="button" className="pg-icon-btn" title={tip("star", starred ? "Unstar" : "Star")} aria-label={starred ? "Unstar" : "Star"} aria-pressed={starred} onClick={() => props.onAction("star")} disabled={!row}>
							<StarIcon size={16} weight={starred ? "fill" : "regular"} color={starred ? "var(--pg-yellow)" : undefined} />
						</button>
						<button ref={labelBtn} type="button" className="pg-icon-btn" title={tip("label", "Label")} aria-label="Label" aria-expanded={pickerOpen} onClick={() => openPicker()} disabled={!row}><TagIcon size={16} /></button>
					</div>
					<div style={{ flex: 1 }} />
					<button type="button" className="pg-icon-btn" title="View source" aria-label="View source" onClick={() => head && setSource(head)} disabled={!head}><CodeIcon size={16} /></button>
				</div>
			</div>
			<div className="pg-reader-scroll" ref={scrollRef}>
				<div className="pg-reader-main">
					<h1 className="pg-subject">{row?.subject || email?.subject || "(no subject)"}</h1>
					{/* TODO(roadmap): per-email agent card (what the agent did, its steps and one-click actions) returns with rules. */}
					<div className="pg-reader-content">
						{!email && <div className="pg-skel" style={{ border: 0, padding: 0 }}><span className="pg-pulse" style={{ width: "80%" }} /></div>}
						{email && (
							<MessageBody
								key={email.id}
								head={letterhead}
								email={email}
								mailboxId={mailbox}
								images={props.prefs.images === "always" || shownImages.has(email.id)}
								onShowImages={() => setShownImages((s) => new Set(s).add(email.id))}
							/>
						)}
					</div>
					{draft && !props.inline ? (
						<button type="button" className="pg-reply-bar" onClick={() => props.onEditDraft(draft)}>
							<PencilSimpleLineIcon size={16} style={{ flex: "none" }} />
							<span className="pg-flex pg-ellipsis">Edit draft</span>
						</button>
					) : props.inline ? (
						<Composer
							key={props.inline.key}
							variant="inline"
							initial={props.inline.initial}
							addresses={props.addresses}
							identities={identities}
							info={props.info}
							sender={props.sender}
							lockFrom={props.prefs.replyFrom}
							onClosed={props.onInlineClosed}
							onPopOut={props.onPopOut}
							onMode={(mode, keep) => original && props.startReply(mode, original, keep)}
							draftWithAgent={props.draftWithAgent}
							onEditSignatures={props.onEditSignatures}
						/>
					) : (
						original && (
							// Two buttons side by side: Reply fills the bar, Draft reply sits at its end.
							<div className="pg-reply-bar">
								<button type="button" className="pg-reply-main" onClick={() => reply("reply")}>
									<ArrowBendUpLeftIcon size={16} style={{ flex: "none" }} />
									<span className="pg-flex pg-ellipsis">Reply to {nameFromHeaders(original.raw_headers, original.sender)}</span>
								</button>
								<button
									type="button"
									className="pg-btn pg-btn-agent"
									title="Draft reply · The agent writes a first draft. Nothing is sent."
									onClick={() => props.startReply("reply", original, undefined, true)}
								>
									<AgentIcon size={14} weight="fill" />Draft reply
								</button>
							</div>
						)
					)}
				</div>
			</div>
			{source && <SourceModal email={source} onClose={() => setSource(null)} />}
		</section>
	);
}

const PALETTE_VARS = { text: "--pg-text-2", muted: "--pg-text-6", link: "--pg-link", quote: "--pg-well", line: "--pg-line-2" } as const;

/** The reader's colors, for plain mail rendered on the reader surface. Follows theme changes. */
function useReaderPalette(ref: React.RefObject<HTMLElement | null>): EmailPalette | undefined {
	const [palette, setPalette] = useState<EmailPalette>();
	useLayoutEffect(() => {
		const root = ref.current?.closest<HTMLElement>(".postal");
		if (!root) return;
		const read = () => {
			const css = getComputedStyle(root);
			const get = (v: string) => css.getPropertyValue(v).trim();
			const next = {
				scheme: get("color-scheme") === "light" ? "light" : "dark",
				...Object.fromEntries(Object.entries(PALETTE_VARS).map(([k, v]) => [k, get(v)])),
			} as EmailPalette;
			setPalette((p) => (JSON.stringify(p) === JSON.stringify(next) ? p : next));
		};
		read();
		const observer = new MutationObserver(read);
		observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		media.addEventListener("change", read);
		return () => {
			observer.disconnect();
			media.removeEventListener("change", read);
		};
	}, [ref]);
	return palette;
}

export function MessageBody({ head, email, mailboxId, images, onShowImages }: {
	head?: React.ReactNode;
	email: Email;
	mailboxId: string;
	images: boolean;
	onShowImages: () => void;
}) {
	const raw = email.body || "";
	// Text-only mail becomes HTML the app writes from escaped text, so it can sit on the page where every agent reads it.
	const text = !isHtmlBody(raw);
	const body = messageBodyHtml(raw, mailboxId, email.id, email.attachments);
	const remote = hasRemoteImages(body);
	const frameRef = useRef<HTMLDivElement>(null);
	const palette = useReaderPalette(frameRef);
	const plain = text || isPlainHtml(body);
	const attachments = getNonInlineAttachments(email.attachments);
	return (
		<>
			{/* Every message is a page: plain mail in the reader's colors and a serif, designed HTML mail on its own white. The images note and attachments sit inside it. */}
			<div className="pg-mail-frame" data-kind={plain ? "plain" : "html"} ref={frameRef}>
				{head}
				<div className="pg-mail-body">
				{remote && !images && (
					<div className="pg-images-note">
						<ImageIcon size={14} />
						<span className="pg-flex" title="Remote images can tell the sender you opened this">Images hidden</span>
						<button type="button" className="pg-images-show" onClick={onShowImages}>Show images</button>
					</div>
				)}
				{text ? (
					<MailText body={body} />
				) : (!plain || palette) && (
					<EmailIframe autoSize body={body} remoteImages={images} padding={plain ? 0 : 24} palette={plain ? palette : undefined} />
				)}
				{attachments.length > 0 && (
					<div className="pg-attachments">
						{attachments.map((a) => <AttachmentRow key={a.id} attachment={a} href={getAttachmentUrl(mailboxId, email.id, a.id)} />)}
					</div>
				)}
				</div>
			</div>
		</>
	);
}

const FILE_KINDS: [RegExp, typeof FileIcon][] = [
	[/^pdf$/, FilePdfIcon],
	[/^(zip|gz|tgz|tar|rar|7z|bz2|xz)$/, FileZipIcon],
	[/^(png|jpe?g|gif|webp|avif|heic|heif|bmp|tiff?)$/, FileImageIcon],
	[/^(xlsx?|ods|numbers|csv|tsv)$/, FileXlsIcon],
	[/^(docx?|odt|pages|rtf)$/, FileDocIcon],
	[/^(pptx?|odp|key)$/, FilePptIcon],
	[/^(ics|vcs)$/, CalendarBlankIcon],
	[/^(txt|md|log|eml)$/, FileTextIcon],
	[/^(mp3|m4a|wav|ogg|flac|aac)$/, FileAudioIcon],
	[/^(mp4|mov|webm|mkv|avi)$/, FileVideoIcon],
	[/^(json|xml|yml|yaml)$/, FileCodeIcon],
];

const MIME_KINDS: [RegExp, typeof FileIcon][] = [
	[/^application\/pdf$/, FilePdfIcon],
	[/zip|compressed|x-tar|gzip/, FileZipIcon],
	[/^image\//, FileImageIcon],
	[/spreadsheet|excel|csv/, FileXlsIcon],
	[/wordprocessing|msword/, FileDocIcon],
	[/presentation|powerpoint/, FilePptIcon],
	[/^text\/calendar$/, CalendarBlankIcon],
	[/^audio\//, FileAudioIcon],
	[/^video\//, FileVideoIcon],
	[/^text\//, FileTextIcon],
];

/** Types that run code or open as a page. Phishing hides here, so they get a warning instead of a size. */
const RISKY: [RegExp, string][] = [
	[/^(html?|xhtml|svg|shtml|mht|mhtml)$/, "opens in browser"],
	[/^(exe|msi|bat|cmd|com|scr|pif|vbs|vbe|js|jse|wsf|ps1|jar|app|dmg|pkg|lnk|hta|cpl|iso|img)$/, "runs code"],
	[/^(docm|xlsm|pptm|dotm|xltm|xlam|ppam)$/, "has macros"],
];

function splitName(filename: string): [string, string] {
	const dot = filename.lastIndexOf(".");
	return dot > 0 && dot < filename.length - 1 ? [filename.slice(0, dot), filename.slice(dot)] : [filename, ""];
}

function AttachmentRow({ attachment: a, href }: { attachment: { filename: string; mimetype: string; size: number }; href: string }) {
	const [base, ext] = splitName(a.filename);
	const type = ext.slice(1).toLowerCase();
	const risk = RISKY.find(([re]) => re.test(type))?.[1];
	const Icon = FILE_KINDS.find(([re]) => re.test(type))?.[1] ?? MIME_KINDS.find(([re]) => re.test(a.mimetype.toLowerCase()))?.[1] ?? FileIcon;
	return (
		<a className="pg-attach" data-risk={risk ? "" : undefined} href={href} download={a.filename} title={risk ? `${a.filename} · ${risk[0].toUpperCase()}${risk.slice(1)}` : a.filename}>
			{risk ? <WarningIcon size={16} className="pg-attach-icon" /> : <Icon size={16} className="pg-attach-icon" />}
			<span className="pg-attach-name">{base}<span className="pg-attach-ext">{ext}</span></span>
			<span className="pg-attach-meta">{risk ?? formatSize(a.size)}</span>
			<DownloadSimpleIcon size={16} className="pg-attach-get" />
		</a>
	);
}

export function LabelPicker({ left, labels, active, onToggle, onCreate, onClose }: {
	left: number;
	labels: Label[];
	active: ReadonlySet<string>;
	onToggle: (label: Label, add: boolean) => void;
	onCreate: (name: string) => void;
	onClose: () => void;
}) {
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	const shown = labels.filter((l) => l.name.toLowerCase().includes(q));
	const exact = labels.some((l) => l.name.toLowerCase() === q);
	return (
		<>
			<div className="pg-scrim-click" onClick={onClose} />
			<div className="pg-popover pg-label-picker" style={{ top: 42, left }} role="dialog" aria-label="Labels" data-mail-popover>
				<input
					autoFocus
					value={query}
					placeholder="Label or new label"
					aria-label="Find or create a label"
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							e.stopPropagation();
							onClose();
						} else if (e.key === "Enter" && q) {
							e.preventDefault();
							if (shown[0] && !active.has(shown[0].id)) onToggle(shown[0], true);
							else if (!exact) onCreate(query.trim());
							setQuery("");
						}
					}}
				/>
				<div className="pg-list-scroll">
					{shown.map((l) => {
						const on = active.has(l.id);
						return (
							<button key={l.id} type="button" role="menuitemcheckbox" aria-checked={on} className="pg-menu-item" onClick={() => onToggle(l, !on)}>
								<span className="pg-check pg-check-neutral" data-on={on}>{on && <CheckIcon size={10} weight="bold" />}</span>
								<LabelTag id={l.id} />
								<span className="pg-flex pg-ellipsis">{l.name}</span>
							</button>
						);
					})}
					{q && !exact && (
						<button type="button" className="pg-menu-item" onClick={() => { onCreate(query.trim()); setQuery(""); }}>
							<PlusIcon size={14} />
							<span className="pg-flex pg-ellipsis">Create “{query.trim()}”</span>
						</button>
					)}
				</div>
			</div>
		</>
	);
}

function SourceModal({ email, onClose }: { email: Email; onClose: () => void }) {
	let headers = "";
	try {
		const parsed = JSON.parse(email.raw_headers || "[]") as unknown;
		const list = Array.isArray(parsed)
			? (parsed as { key?: string; value?: unknown }[]).map((h) => [h.key, h.value] as const)
			: Object.entries(parsed as Record<string, unknown>);
		headers = list.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n");
	} catch {
		headers = email.raw_headers || "";
	}
	return (
		<div className="pg-modal-scrim" onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
			<div className="pg-modal is-source" role="dialog" aria-modal="true" aria-label="Message source" onClick={(e) => e.stopPropagation()}>
				<div className="pg-modal-head">
					<span className="pg-modal-icon"><CodeIcon size={16} /></span>
					<div className="pg-modal-title"><h2>Source</h2><span>{email.message_id || email.id}</span></div>
					<button type="button" className="pg-modal-x" title="Close (Esc)" aria-label="Close" onClick={onClose} autoFocus><XIcon size={16} /></button>
				</div>
				<pre className="pg-source">{`${headers}\n\n${email.body || ""}`}</pre>
			</div>
		</div>
	);
}
