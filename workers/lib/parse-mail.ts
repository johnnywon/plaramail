// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Inbound MIME parsing: postal-mime with the line break before a multipart
 * boundary kept out of the part's content.
 *
 * postal-mime 2.x decodes a 7bit, 8bit, binary or quoted-printable part line
 * by line and writes a line break after every line, the last one included.
 * The CRLF in front of a boundary belongs to the boundary (RFC 2046 5.1.1),
 * so each part ended by a boundary gained one 0x0a: a 21-byte text file
 * arrived as 22 bytes, and as 23 after a forward (#59). Base64 parts were not
 * affected because the decoder ignores line breaks.
 *
 * postal-mime fixed this upstream after its TypeScript rewrite (a major
 * version). Until the dependency moves to that version, this parser drops
 * that one byte again when a part ends at a boundary. The check in
 * tests/attachment-roundtrip.test.mjs fails if the parser changes under it.
 */
import PostalMime, { type Email } from "postal-mime";

interface ContentDecoder {
	update(line: Uint8Array): void;
	finalize(): ArrayBuffer | Promise<ArrayBuffer>;
}

interface MimeNode {
	contentDecoder?: ContentDecoder | false;
	parentNode?: MimeNode;
	contentTransferEncoding?: { encoding?: string };
}

const EQUALS = 0x3d;
const LF = 0x0a;
const wrapped = new WeakSet<ContentDecoder>();

/** Make `node`'s decoder leave out the line break that belongs to the boundary after the part. */
function keepBoundaryBreakOut(node: MimeNode) {
	const decoder = node.contentDecoder;
	if (!decoder || wrapped.has(decoder)) return;
	wrapped.add(decoder);
	const encoding = node.contentTransferEncoding?.encoding || "";
	if (/base64/i.test(encoding)) return;
	const qp = /quoted-printable/i.test(encoding);

	let lines = 0;
	let softBreak = false;
	const update = decoder.update.bind(decoder);
	const finalize = decoder.finalize.bind(decoder);
	decoder.update = (line) => {
		lines++;
		// A quoted-printable line ending in "=" has no line break to give back.
		softBreak = qp && line.length > 0 && line[line.length - 1] === EQUALS;
		update(line);
	};
	decoder.finalize = async () => {
		const content = await finalize();
		// Only a part inside a multipart ends at a boundary; a single-part body ends at the end of the message.
		if (!node.parentNode || lines === 0 || softBreak) return content;
		const bytes = new Uint8Array(content);
		return bytes.length && bytes[bytes.length - 1] === LF ? content.slice(0, bytes.length - 1) : content;
	};
}

class BoundaryAwareParser extends PostalMime {
	// processLine is postal-mime's per-line step; a part's decoder exists once its header block has ended.
	async processLine(line: Uint8Array, isFinal: boolean): Promise<void> {
		const self = this as unknown as { currentNode: MimeNode };
		await (PostalMime.prototype as unknown as { processLine(l: Uint8Array, f: boolean): Promise<void> })
			.processLine.call(this, line, isFinal);
		keepBoundaryBreakOut(self.currentNode);
	}
}

/** Parse a raw message. Attachments come out byte for byte, whatever their transfer encoding. */
export function parseMail(raw: ArrayBuffer | Uint8Array | string): Promise<Email> {
	return new BoundaryAwareParser().parse(raw);
}
