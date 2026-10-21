// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { CSSProperties, ReactNode } from "react";

/**
 * Navigation icons, drawn like the robot in AgentIcon: a 24 grid with a 20px
 * live area, 2px round strokes, 3px corners on bodies and 1.5 on small parts.
 * Mail icons carry one solid accent in mail orange (the robot's eye block where
 * it fits); folder icons stay plain. Shells take the current color.
 * Each takes Phosphor's props so it can stand in for a Phosphor icon; weight is ignored.
 */
interface NavIconProps {
	size?: number;
	weight?: string;
	color?: string;
	className?: string;
	style?: CSSProperties;
}

const MAIL = "var(--pg-mail)";
const STROKE = { stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Svg({ size = 16, color, className, style, width = 24, children }: NavIconProps & { width?: number; children: ReactNode }) {
	return (
		<svg
			width={(size * width) / 24}
			height={size}
			viewBox={`0 0 ${width} 24`}
			fill="none"
			className={className}
			style={{ color, flex: "none", ...style }}
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}

/** All addresses: a wall of PO boxes, the one with mail filled. */
/** The PlaraMail mark, the Fold: three flaps, the last in Signal. Only in the top-left corner (sidebar header and rail). */
export function FoldMark({ size = 16, className, style }: { size?: number; className?: string; style?: CSSProperties }) {
	return (
		<svg width={size} height={size} viewBox="0 0 48 48" fill="none" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" className={className} style={{ flex: "none", ...style }} aria-hidden="true">
			{/* Flaps keep full ink or paper contrast, not the muted header text. */}
			<polyline points="7,9 24,20 41,9" stroke="var(--pg-text-1)" />
			<polyline points="7,20 24,31 41,20" stroke="var(--pg-text-1)" />
			<polyline points="7,31 24,42 41,31" stroke="#E46F2C" />
		</svg>
	);
}

export function AllAddressesIcon(props: NavIconProps) {
	return (
		<Svg {...props}>
			<g {...STROKE}>
				<rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
				<rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
				<rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
			</g>
			<rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" fill={MAIL} stroke={MAIL} strokeWidth="2" strokeLinejoin="round" />
		</Svg>
	);
}

/** Inbox: an open tray with an arrow dropping in; the block is the arrow's shaft. */
export function InboxIcon(props: NavIconProps) {
	return (
		<Svg {...props}>
			<g {...STROKE}>
				<path d="M3 13v5a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-5" />
				<path d="M3 13h4l1.5 2.5h7L17 13h4" />
				<path d="M8.5 7.5l3.5 3.5 3.5-3.5" />
			</g>
			<rect x="10.8" y="2.5" width="2.4" height="4.5" fill={MAIL} />
		</Svg>
	);
}

/** Unread: a letter going into the box. */
export function UnreadIcon(props: NavIconProps) {
	return (
		<Svg {...props}>
			<rect x="7" y="3" width="10" height="7" rx="1.5" fill={MAIL} />
			<path d="M8.5 4.5l3.5 2.6 3.5-2.6" stroke="rgba(0,0,0,0.38)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
			<g {...STROKE}>
				<rect x="3" y="11" width="18" height="10" rx="3" />
				<path d="M8 16h8" />
			</g>
		</Svg>
	);
}

/** By address: the full @, squared to the keyline, with the cursor block after it. 28 wide. */
export function ByAddressIcon(props: NavIconProps) {
	return (
		<Svg {...props} width={28}>
			<g {...STROKE}>
				<path d="M15.5 11a2 2 0 0 0-2-2H11a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2.5a2 2 0 0 0 2-2" />
				<path d="M15.5 9v4.5a2.25 2.25 0 0 0 4.5 0V7a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v10a4 4 0 0 0 4 4h7.5" />
			</g>
			<rect x="23.3" y="9.75" width="2.4" height="4.5" fill={MAIL} />
		</Svg>
	);
}

/** Labels: an outline tag. The labels under it carry the color. */
export function LabelsIcon(props: NavIconProps) {
	return (
		<Svg {...props}>
			<path {...STROKE} d="M3 5a2 2 0 0 1 2-2h5.6a2 2 0 0 1 1.4.6l8.2 8.2a2 2 0 0 1 0 2.8l-5.6 5.6a2 2 0 0 1-2.8 0L3.6 12a2 2 0 0 1-.6-1.4z" />
			<rect x="6.3" y="6.3" width="2.4" height="2.4" fill="currentColor" />
		</Svg>
	);
}

/** Drafts: a page with the cursor still in it. */
export function DraftsIcon(props: NavIconProps) {
	return (
		<Svg {...props}>
			<g {...STROKE}>
				<rect x="5" y="3" width="14" height="18" rx="3" />
				<path d="M8.5 8h7M8.5 12.5h2.5" />
			</g>
			<rect x="12.6" y="10.25" width="2.4" height="4.5" fill={MAIL} />
		</Svg>
	);
}

export function StarredIcon(props: NavIconProps) {
	return (
		<Svg {...props}>
			<path {...STROKE} d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.85 6.75 19.6l1-5.8L3.5 9.7l5.9-.9z" />
		</Svg>
	);
}

export function SentIcon(props: NavIconProps) {
	return (
		<Svg {...props}>
			<g {...STROKE}>
				<path d="M21 3l-6.5 18-4-7.5L3 9.5z" />
				<path d="M21 3L10.5 13.5" />
			</g>
		</Svg>
	);
}

export function ArchiveIcon(props: NavIconProps) {
	return (
		<Svg {...props}>
			<g {...STROKE}>
				<rect x="3" y="4" width="18" height="5" rx="1.5" />
				<path d="M5 9v9a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V9" />
				<path d="M10 13h4" />
			</g>
		</Svg>
	);
}

export function SpamIcon(props: NavIconProps) {
	return (
		<Svg {...props}>
			<g {...STROKE}>
				<path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z" />
				<path d="M12 7.5V13" />
				<path d="M12 16.5v.01" />
			</g>
		</Svg>
	);
}

export function TrashIcon(props: NavIconProps) {
	return (
		<Svg {...props}>
			<g {...STROKE}>
				<path d="M4 6.5h16" />
				<path d="M9 6.5v-2A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5v2" />
				<path d="M6 6.5l.85 12.65A2 2 0 0 0 8.85 21h6.3a2 2 0 0 0 2-1.85L18 6.5" />
				<path d="M10 11v5M14 11v5" />
			</g>
		</Svg>
	);
}

/** Each folder's icon, one meaning everywhere: the sidebar, the rail and the list header. */
export const VIEW_ICONS: Record<string, (props: NavIconProps) => ReactNode> = {
	inbox: InboxIcon, unread: UnreadIcon, starred: StarredIcon, drafts: DraftsIcon, sent: SentIcon,
	archive: ArchiveIcon, spam: SpamIcon, trash: TrashIcon, all: AllAddressesIcon,
};

/** The folders under All addresses' Inbox and Unread in the sidebar. */
export const SECONDARY_VIEWS = [
	{ view: "starred", label: "Starred", Icon: StarredIcon },
	{ view: "drafts", label: "Drafts", Icon: DraftsIcon },
	{ view: "sent", label: "Sent", Icon: SentIcon },
	{ view: "archive", label: "Archive", Icon: ArchiveIcon },
	{ view: "spam", label: "Spam", Icon: SpamIcon },
	{ view: "trash", label: "Trash", Icon: TrashIcon },
] as const;

/** One address's (or domain's) folders: what the sidebar lists under it. */
export const ADDRESS_FOLDERS = [{ view: "inbox", label: "Inbox", Icon: InboxIcon }, ...SECONDARY_VIEWS] as const;

/** All addresses' folders: the sidebar's top group. Labels follow them. */
export const ALL_FOLDERS = [{ view: "inbox", label: "Inbox", Icon: InboxIcon }, { view: "unread", label: "Unread", Icon: UnreadIcon }, ...SECONDARY_VIEWS] as const;
