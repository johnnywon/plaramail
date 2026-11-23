// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Folders } from "shared/folders";
import { useEmail, useThreadReplies } from "~/queries/emails";
import api from "~/services/api";
import type { Email } from "~/types";
import { AddressText, type Identities } from "./identity";
import type { MessageRef } from "./console-message";
import { Badge, Note } from "./ConsoleUI";
import { Head, Modal } from "./Modals";
import { fullDate } from "./model";
import { MessageBody } from "./Reader";

/** One message and its thread, read inside the console. A draft can be edited in Mail or discarded. */
export function ConsoleMessage({ open, identities, onClose, onEditDraft }: {
	open: MessageRef;
	identities: Identities;
	onClose: () => void;
	onEditDraft: (mailboxId: string, draftId: string) => void;
}) {
	const queryClient = useQueryClient();
	const email = useEmail(open.mailboxId, open.emailId);
	const thread = useThreadReplies(open.mailboxId, email.data?.thread_id);
	const [images, setImages] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const list: Email[] = thread.data?.length
		? [...thread.data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
		: email.data ? [email.data] : [];
	// The draft to act on: the message itself, or the draft waiting in its thread.
	const draftId = email.data?.folder_id === Folders.DRAFT ? open.emailId : list.find((m) => m.folder_id === Folders.DRAFT)?.id;
	const discard = useMutation({
		mutationFn: () => api.deleteEmail(open.mailboxId, draftId!),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["agent-drafts"] });
			queryClient.invalidateQueries({ queryKey: ["emails"] });
			onClose();
		},
	});

	return (
		<Modal className="is-message" label={email.data?.subject || "Message"} onClose={onClose}>
			<Head icon={<EnvelopeSimpleIcon size={16} />} title={email.data?.subject || (email.isPending ? "" : "(no subject)")} onClose={onClose} />
			<div className="pg-cmsg-body">
				{email.isPending && <Note>Loading</Note>}
				{email.error && <Note tone="error">{email.error.message}</Note>}
				{list.map((m) => {
					const draft = m.folder_id === Folders.DRAFT;
					return (
						<article key={m.id} className="pg-cmsg" data-current={m.id === open.emailId || undefined}>
							<header className="pg-cmsg-head">
								<b>{draft ? <AddressText address={m.sender} identity={identities.of(m.sender)} bold={false} short /> : m.sender}</b>
								<span className="pg-cmsg-to">to {m.recipient}</span>
								{draft && <Badge tone="draft">{m.draft_notes?.agent ?? "Draft"}</Badge>}
								<time className="pg-mono">{fullDate(m.date)}</time>
							</header>
							<MessageBody email={m} mailboxId={open.mailboxId} images={images} onShowImages={() => setImages(true)} />
						</article>
					);
				})}
			</div>
			{draftId && (
				<div className="pg-modal-foot">
					{confirming
						? <><button type="button" className="pg-btn" onClick={() => setConfirming(false)}>Keep</button><button type="button" className="pg-btn pg-btn-danger" onClick={() => discard.mutate()} disabled={discard.isPending}>Discard draft</button></>
						: <button type="button" className="pg-btn" onClick={() => setConfirming(true)}>Discard</button>}
					{discard.error && <Note tone="error">{discard.error.message}</Note>}
					<div className="pg-flex" />
					<button type="button" className="pg-btn pg-btn-primary" onClick={() => onEditDraft(open.mailboxId, draftId)} data-autofocus>Edit in Mail</button>
				</div>
			)}
		</Modal>
	);
}
