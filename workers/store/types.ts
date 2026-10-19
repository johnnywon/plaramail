// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The storage contract every caller goes through. Method types come from
 * the D1 classes (workers/store/d1/); the names listed here are the contract,
 * so a test double only has to supply these.
 */
import type { D1AllMail } from "./d1/all-mail";
import type { D1Mailbox } from "./d1/mailbox";
import type { MailFilter } from "../lib/mail-index-sql";

/** What a bulk action applies to: picked conversations, or everything a filter matched when the list was shown. */
export type BulkTarget =
	| { threadKeys: string[]; view: string }
	| { filter: MailFilter; asOf: string; expectedCount: number };

export interface BulkFailure {
	mailboxId: string;
	error: string;
}

/** Operations on one address's mail. */
export type MailboxStore = Pick<
	D1Mailbox,
	// Messages and threads
	| "getEmails"
	| "getEmail"
	| "getThreadEmails"
	| "hasInboundMessageId"
	| "createEmail"
	| "updateEmail"
	| "markThreadRead"
	| "deleteEmail"
	| "trashOrDelete"
	| "moveEmail"
	| "getAttachment"
	| "findThreadBySubject"
	| "findThreadByMessageIds"
	// Blocked senders
	| "isBlockedSender"
	| "blockSender"
	| "unblockSender"
	| "listBlockedSenders"
	// Folder import (folders to labels)
	| "folderImportCounts"
	| "folderEmailIds"
	| "importFolder"
	| "markFoldersImported"
	// Sending
	| "getDraftNotes"
	| "setDraftNotes"
	| "takeSendBudget"
	| "refundSendBudget"
	| "claimSendKey"
	| "sentSendKey"
	| "startSendKey"
	| "recordSendProvider"
	| "finishSendKey"
	| "failSendKey"
	| "scheduleSend"
	| "listScheduled"
	| "cancelScheduled"
>;

/** Operations across every address: the combined list, labels, bulk actions and undo. */
export type AllMailStore = Pick<
	D1AllMail,
	| "queryMail"
	| "queryFacets"
	| "folderViews"
	| "threadKeysMatching"
	| "threadKeyOf"
	| "bulk"
	| "bulkJob"
	| "undo"
	| "trashCount"
	| "emptyTrash"
	| "purgeRetention"
	| "listLabels"
	| "createLabel"
	| "updateLabel"
	| "markLabelsAuto"
	| "deleteLabel"
	| "suggest"
	| "contacts"
	| "listSavedSearches"
	| "createSavedSearch"
	| "updateSavedSearch"
	| "deleteSavedSearch"
>;

export interface MailStore {
	/** One address's mail. The id is the address, any case. */
	mailbox(mailboxId: string): MailboxStore;
	/** Mail across every address. */
	all(): AllMailStore;
	/** The mailboxes themselves. */
	mailboxes: MailboxRegistry;
}

/** The configured addresses and their settings (display name, signature, agent prompt). */
export interface MailboxRegistry {
	/** Every mailbox, sorted by address. */
	list(): Promise<{ id: string; email: string }[]>;
	get(mailboxId: string): Promise<Record<string, unknown> | null>;
	exists(mailboxId: string): Promise<boolean>;
	/** Create the mailbox or replace its settings. */
	put(mailboxId: string, settings: Record<string, unknown>): Promise<void>;
}
