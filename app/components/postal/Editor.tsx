// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	CaretUpIcon, CheckIcon, LinkIcon, ListBulletsIcon, ListNumbersIcon, QuotesIcon, TextBIcon, TextItalicIcon, TextStrikethroughIcon, TextTSlashIcon,
	TextUnderlineIcon, XIcon,
} from "@phosphor-icons/react";
import LinkExtension from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import { type Editor as TipTap, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { useShortcuts } from "./shortcuts";

export interface EditorProps {
	/** HTML. A change from outside replaces the content; typing reports through onChange. */
	value: string;
	onChange: (html: string) => void;
	placeholder: string;
	size?: "inline" | "window";
	autoFocus?: boolean;
	label?: string;
	onReady?: (editor: TipTap) => void;
	/** Block typing, e.g. while an agent rewrites the body. */
	readOnly?: boolean;
}

export function Editor({ value, onChange, placeholder, size = "inline", autoFocus, label = "Message body", onReady, readOnly = false }: EditorProps) {
	const last = useRef(value);
	const locked = useRef(readOnly);
	locked.current = readOnly;
	const editor = useEditor({
		immediatelyRender: false,
		extensions: [StarterKit.configure({ link: false, underline: false }), Underline, LinkExtension.configure({ openOnClick: false, autolink: true })],
		content: value,
		// Read-only, it stays focusable so keys land in the composer, not on the mail list's shortcuts.
		editorProps: { attributes: () => ({ "aria-label": label, role: "textbox", "aria-multiline": "true", ...(locked.current ? { tabindex: "0", "aria-readonly": "true" } : {}) }) },
		onUpdate: ({ editor: e }) => {
			const html = e.isEmpty ? "" : e.getHTML();
			last.current = html;
			onChange(html);
		},
	});

	useEffect(() => {
		if (editor && onReady) onReady(editor);
	}, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		if (!editor || editor.isDestroyed || value === last.current) return;
		last.current = value;
		editor.commands.setContent(value || "", { emitUpdate: false });
	}, [value, editor]);

	useEffect(() => {
		if (!editor || editor.isDestroyed) return;
		editor.setEditable(!readOnly, false);
		// The button that started the lock is disabled now, which drops focus to the page.
		const active = document.activeElement as HTMLButtonElement | null;
		if (readOnly && (!active || active === document.body || active.disabled || active === editor.view.dom)) editor.view.dom.focus({ preventScroll: true });
	}, [editor, readOnly]);

	useEffect(() => {
		if (!editor || !autoFocus) return;
		const id = requestAnimationFrame(() => !editor.isDestroyed && editor.commands.focus("start"));
		return () => cancelAnimationFrame(id);
	}, [editor, autoFocus]);

	const state = useEditorState({ editor, selector: ({ editor: e }) => ({ empty: !e || blank(e) }) });
	// The editor is created after the first render, already holding its content, and no transaction tells
	// useEditorState; asking the editor too keeps the placeholder off text it already has.
	const empty = !!state?.empty && (!editor || blank(editor));

	return (
		<div
			className="pg-editor"
			data-size={size}
			style={{ position: "relative" }}
			onKeyDown={(e) => {
				if (editor && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
					e.preventDefault();
					e.stopPropagation();
					promptLink(editor);
				}
			}}
		>
			{empty && (
				<span aria-hidden style={{ position: "absolute", left: 14, top: 12, color: "var(--pg-text-8)", font: "14px/1.6 var(--pg-font)", pointerEvents: "none" }}>
					{placeholder}
				</span>
			)}
			<EditorContent editor={editor} />
		</div>
	);
}

/** Empty and still a plain paragraph. TipTap calls an empty list empty too, and the placeholder would sit on its marker. */
function blank(editor: TipTap) {
	return editor.isEmpty && editor.state.doc.firstChild?.type.name === "paragraph";
}

function promptLink(editor: TipTap) {
	const previous = editor.getAttributes("link").href as string | undefined;
	const url = window.prompt("Link URL", previous ?? "https://");
	if (url === null) return;
	if (url === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
	else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
}

/** B I U S · lists, quote · link, clear. */
export function FormatBar({ editor }: { editor: TipTap | null }) {
	const { tip } = useShortcuts();
	const state = useEditorState({
		editor,
		selector: ({ editor: e }) => ({
			bold: !!e?.isActive("bold"),
			italic: !!e?.isActive("italic"),
			underline: !!e?.isActive("underline"),
			strike: !!e?.isActive("strike"),
			bullet: !!e?.isActive("bulletList"),
			ordered: !!e?.isActive("orderedList"),
			quote: !!e?.isActive("blockquote"),
			link: !!e?.isActive("link"),
		}),
	});
	const run = (fn: (e: TipTap) => void) => (event: React.MouseEvent) => {
		event.preventDefault();
		if (editor) fn(editor);
	};
	return (
		<div className="pg-format" role="toolbar" aria-label="Formatting">
			<button type="button" title={tip("bold", "Bold")} aria-label="Bold" aria-pressed={state?.bold} onMouseDown={run((e) => e.chain().focus().toggleBold().run())}><TextBIcon size={16} weight="bold" /></button>
			<button type="button" title={tip("italic", "Italic")} aria-label="Italic" aria-pressed={state?.italic} onMouseDown={run((e) => e.chain().focus().toggleItalic().run())}><TextItalicIcon size={16} /></button>
			<button type="button" title={tip("underline", "Underline")} aria-label="Underline" aria-pressed={state?.underline} onMouseDown={run((e) => e.chain().focus().toggleUnderline().run())}><TextUnderlineIcon size={16} /></button>
			<button type="button" title="Strikethrough" aria-label="Strikethrough" aria-pressed={state?.strike} onMouseDown={run((e) => e.chain().focus().toggleStrike().run())}><TextStrikethroughIcon size={16} /></button>
			<span className="pg-sep" />
			<button type="button" title="Bulleted list" aria-label="Bulleted list" aria-pressed={state?.bullet} onMouseDown={run((e) => e.chain().focus().toggleBulletList().run())}><ListBulletsIcon size={16} /></button>
			<button type="button" title="Numbered list" aria-label="Numbered list" aria-pressed={state?.ordered} onMouseDown={run((e) => e.chain().focus().toggleOrderedList().run())}><ListNumbersIcon size={16} /></button>
			<button type="button" title="Quote" aria-label="Quote" aria-pressed={state?.quote} onMouseDown={run((e) => e.chain().focus().toggleBlockquote().run())}><QuotesIcon size={16} /></button>
			<span className="pg-sep" />
			<button type="button" title={tip("link", "Insert link")} aria-label="Insert link" aria-pressed={state?.link} onMouseDown={run(promptLink)}><LinkIcon size={16} /></button>
			<button type="button" title="Clear formatting" aria-label="Clear formatting" onMouseDown={run((e) => e.chain().focus().unsetAllMarks().clearNodes().run())}><TextTSlashIcon size={16} /></button>
		</div>
	);
}

/** Paragraph styles on the phone's format card, each shown in its own type. */
const STYLES = [
	{ id: "body", label: "Body", set: (e: TipTap) => e.chain().focus().clearNodes().run() },
	{ id: "heading", label: "Heading", set: (e: TipTap) => e.chain().focus().clearNodes().setHeading({ level: 3 }).run() },
	{ id: "quote", label: "Quote", set: (e: TipTap) => e.chain().focus().clearNodes().setBlockquote().run() },
	{ id: "code", label: "Code", set: (e: TipTap) => e.chain().focus().clearNodes().setCodeBlock().run() },
] as const;

/** Keep the editor's focus and selection (and the phone's keyboard) when a key is pressed. */
const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();

/**
 * The phone's format card, over the dock: the paragraph style, then Text
 * (bold, italic, underline, strikethrough), then Lists and link. Link turns
 * the card into an address field: selected text becomes the link; with
 * nothing selected the address goes in as the link. Keys never take focus
 * from the editor, so the caret stays where it was.
 */
export function FormatCard({ editor, cardRef }: { editor: TipTap | null; cardRef?: React.Ref<HTMLDivElement & HTMLFormElement> }) {
	const [styles, setStyles] = useState(false);
	const [linking, setLinking] = useState(false);
	const [href, setHref] = useState("");
	const state = useEditorState({
		editor,
		selector: ({ editor: e }) => ({
			style: e?.isActive("heading") ? "heading" : e?.isActive("codeBlock") ? "code" : e?.isActive("blockquote") ? "quote" : "body",
			bold: !!e?.isActive("bold"),
			italic: !!e?.isActive("italic"),
			underline: !!e?.isActive("underline"),
			strike: !!e?.isActive("strike"),
			bullet: !!e?.isActive("bulletList"),
			ordered: !!e?.isActive("orderedList"),
			link: !!e?.isActive("link"),
		}),
	});
	const run = (fn: (e: TipTap) => void) => () => editor && fn(editor);
	const current = STYLES.find((x) => x.id === state?.style) ?? STYLES[0];

	const addLink = () => {
		const url = href.trim();
		if (!editor || !url) return;
		const { empty } = editor.state.selection;
		if (empty) editor.chain().focus().insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }).run();
		else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
		setLinking(false);
		setHref("");
	};

	if (linking) {
		return (
			<form ref={cardRef} className="pg-cw-card pg-fmt is-link" role="group" aria-label="Insert link" onSubmit={(e) => { e.preventDefault(); addLink(); }}>
				<LinkIcon size={20} color="var(--pg-text-5)" />
				<input className="pg-card-input" type="url" inputMode="url" autoFocus value={href} placeholder="Paste or type a link" aria-label="Link address" onChange={(e) => setHref(e.target.value)} />
				<button type="submit" className="pg-card-add" disabled={!href.trim()}>Add</button>
				<button type="button" className="pg-key" aria-label="Cancel link" onClick={() => { setLinking(false); editor?.commands.focus(); }}><XIcon size={20} /></button>
			</form>
		);
	}

	const key = (label: string, on: boolean | undefined, fn: (e: TipTap) => void, icon: React.ReactNode) => (
		<button type="button" className="pg-key" aria-label={label} title={label} aria-pressed={!!on} onPointerDown={keep} onMouseDown={keep} onClick={run(fn)}>{icon}</button>
	);

	return (
		<>
			{styles && (
				<div className="pg-styles" role="menu" aria-label="Text style">
					{STYLES.map((x) => (
						<button key={x.id} type="button" role="menuitemradio" aria-checked={x.id === current.id} data-style={x.id} onPointerDown={keep} onMouseDown={keep} onClick={() => { if (editor) x.set(editor); setStyles(false); }}>
							<span>{x.label}</span>
							{x.id === current.id && <CheckIcon size={14} weight="bold" />}
						</button>
					))}
				</div>
			)}
			<div ref={cardRef} className="pg-cw-card pg-fmt" role="toolbar" aria-label="Formatting">
				<button type="button" className="pg-style" aria-haspopup="menu" aria-expanded={styles} aria-label={`Text style, ${current.label}`} onPointerDown={keep} onMouseDown={keep} onClick={() => setStyles((v) => !v)}>
					{current.label}<CaretUpIcon size={12} />
				</button>
				<span className="pg-well" role="group" aria-label="Text">
					{key("Bold", state?.bold, (e) => e.chain().focus().toggleBold().run(), <TextBIcon size={20} weight="bold" />)}
					{key("Italic", state?.italic, (e) => e.chain().focus().toggleItalic().run(), <TextItalicIcon size={20} />)}
					{key("Underline", state?.underline, (e) => e.chain().focus().toggleUnderline().run(), <TextUnderlineIcon size={20} />)}
					{key("Strikethrough", state?.strike, (e) => e.chain().focus().toggleStrike().run(), <TextStrikethroughIcon size={20} />)}
				</span>
				<span className="pg-well" role="group" aria-label="Lists and link">
					{key("Bulleted list", state?.bullet, (e) => e.chain().focus().toggleBulletList().run(), <ListBulletsIcon size={20} />)}
					{key("Numbered list", state?.ordered, (e) => e.chain().focus().toggleOrderedList().run(), <ListNumbersIcon size={20} />)}
					<button type="button" className="pg-key" aria-label="Insert link" title="Insert link" aria-pressed={!!state?.link} onPointerDown={keep} onMouseDown={keep} onClick={() => { setStyles(false); setHref((editor?.getAttributes("link").href as string | undefined) ?? ""); setLinking(true); }}>
						<LinkIcon size={20} />
					</button>
				</span>
			</div>
		</>
	);
}
