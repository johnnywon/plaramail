// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown for agent replies. The model's text can carry content from mail it
 * read, so nothing in it loads on its own: an image becomes a link that opens
 * only when clicked.
 */
export const AGENT_MARKDOWN_COMPONENTS: Components = {
	a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
	img: ({ src, alt }) => {
		const url = typeof src === "string" ? src : "";
		const label = `Image: ${alt || url || "no address"}`;
		return url ? <a href={url} title={url} target="_blank" rel="noopener noreferrer">{label}</a> : <span>{label}</span>;
	},
};

export function AgentMarkdown({ text }: { text: string }) {
	return <Markdown remarkPlugins={[remarkGfm]} components={AGENT_MARKDOWN_COMPONENTS}>{text}</Markdown>;
}
