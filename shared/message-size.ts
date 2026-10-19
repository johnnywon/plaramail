/**
 * The 5 MiB message limit (WON-215). Email Sending refuses a message over
 * 5 MiB (README, Limits). Attachments travel base64 encoded in 76-character
 * lines, so a file takes about 4/3 of its size plus line breaks. The composer
 * checks before it sends and the Worker checks again in sendMail.
 */

export const MESSAGE_BYTES_MAX = 5 * 1024 * 1024;

/** A file's size once base64 encoded in 76-character lines. */
export function encodedBytes(bytes: number): number {
	const b64 = Math.ceil(bytes / 3) * 4;
	return b64 + Math.ceil(b64 / 76) * 2;
}

/** Bytes of UTF-8 text. */
function textBytes(s: string | undefined | null): number {
	return s ? new TextEncoder().encode(s).length : 0;
}

/** The message's size: its HTML and text bodies and each file encoded. */
export function messageBytes(parts: { html?: string | null; text?: string | null; fileBytes: number[] }): number {
	return textBytes(parts.html) + textBytes(parts.text) + parts.fileBytes.reduce((sum, b) => sum + encodedBytes(b), 0);
}

/** A file's size from its base64 content. */
export function base64Bytes(content: string): number {
	const c = content.replace(/\s+/g, "");
	return Math.floor((c.length * 3) / 4) - (c.endsWith("==") ? 2 : c.endsWith("=") ? 1 : 0);
}

/** Megabytes as the limit is stated (5 MiB is "5 MB"), to one decimal. */
function mb(bytes: number): string {
	return `${String(Math.ceil((bytes / 1024 / 1024) * 10) / 10).replace(/\.0$/, "")} MB`;
}

/** Why a message is too large to send, or null when it fits. */
export function messageSizeError(bytes: number): string | null {
	if (bytes <= MESSAGE_BYTES_MAX) return null;
	return `This message is ${mb(bytes)} with its attachments encoded. Mail can be up to ${mb(MESSAGE_BYTES_MAX)}.`;
}
