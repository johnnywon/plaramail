// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Mail across every address on D1: the combined list, facets, labels, bulk
 * actions and undo. The queries are generators (mail-index-sql.ts,
 * mail-bulk-sql.ts) driven with runAsync.
 *
 * Bulk actions apply inline at any size: an op is one statement, so there
 * is no job to poll and `bulkJob` only finds jobs that older code created.
 */
import {
	BulkConflictError,
	type BulkAction,
	LabelError,
	createLabelQuery,
	deleteLabelRowsQuery,
	getBulkJobQuery,
	labelThreadKeysQuery,
	listLabelsQuery,
	markLabelsAutoQuery,
	matchingThreadKeysQuery,
	planBulkQuery,
	planEmptyTrashQuery,
	planUndo,
	resolveFilterTargetQuery,
	saveUndoQuery,
	takeUndoQuery,
	threadKeyOfQuery,
	trashCountQuery,
	updateLabelQuery,
	allLabelsQuery,
	opSize,
} from "../../lib/mail-bulk-sql";
import { type MailFilter, type Query, folderViewsQuery, runAsync } from "../../lib/mail-index-sql";
import { d1FacetsQuery, d1MailQuery, withSubstrings } from "../../lib/search-engine-sql";
import {
	contactsQuery,
	createSavedSearchQuery,
	deleteSavedSearchQuery,
	listSavedSearchesQuery,
	savedResult,
	suggestQuery,
	updateSavedSearchQuery,
} from "../../lib/search-suggest-sql";
import type { Sql } from "../sql";
import type { BulkTarget } from "../types";
import { applyOps } from "./ops";

export class D1AllMail {
	constructor(private readonly sql: Sql, private readonly bucket: R2Bucket) {}

	#run<T>(query: Query<T>): Promise<T> {
		return runAsync(query, (text, ...params) => this.sql.all(text, ...params));
	}

	/** The filter with its substring matches found, so bulk targets match the list. */
	#search(filter: MailFilter): Promise<MailFilter> {
		return this.#run(withSubstrings(filter));
	}

	async #deleteFiles(keys: string[]) {
		if (keys.length === 0) return;
		try {
			await this.bucket.delete(keys);
		} catch (e) {
			console.error("purge: file delete failed:", (e as Error).message);
		}
	}

	async queryMail(filter: MailFilter, options: { cursor?: string | null; limit?: number } = {}) {
		return this.#run(d1MailQuery(filter, options));
	}

	async queryFacets(filter: MailFilter) {
		return this.#run(d1FacetsQuery(filter));
	}

	async folderViews() {
		return this.#run(folderViewsQuery());
	}

	// ── Search window ────────────────────────────────────────────────

	async suggest(filter: MailFilter, text: string, at: number) {
		return this.#run(suggestQuery(filter, text, at));
	}

	async contacts(partial: string, exclude: string[]) {
		return this.#run(contactsQuery(partial, exclude));
	}

	async listSavedSearches(counts?: { tzOffset: number }) {
		return this.#run(listSavedSearchesQuery(counts));
	}

	async createSavedSearch(input: { name?: unknown; query: unknown }) {
		return savedResult(() => this.#run(createSavedSearchQuery(input)));
	}

	async updateSavedSearch(id: string, input: { name?: unknown; query?: unknown; position?: unknown }) {
		return savedResult(() => this.#run(updateSavedSearchQuery(id, input)));
	}

	async deleteSavedSearch(id: string) {
		return this.#run(deleteSavedSearchQuery(id));
	}

	async threadKeysMatching(filter: MailFilter, limit: number) {
		return this.#run(matchingThreadKeysQuery(await this.#search(filter), limit));
	}

	async threadKeyOf(mailboxId: string, emailId: string) {
		return this.#run(threadKeyOfQuery(mailboxId, emailId));
	}

	async bulk(target: BulkTarget, action: BulkAction) {
		let threadKeys: string[];
		try {
			threadKeys = "threadKeys" in target
				? target.threadKeys
				: await this.#run(resolveFilterTargetQuery(await this.#search(target.filter), target.asOf, target.expectedCount));
		} catch (e) {
			if (e instanceof BulkConflictError) return { conflict: e.count };
			throw e;
		}
		const view = "threadKeys" in target ? target.view : target.filter.view;
		const plan = await this.#run(planBulkQuery(threadKeys, view, action));
		const undoId = crypto.randomUUID();
		await this.#run(saveUndoQuery(undoId, { action, entries: plan.entries }));
		const result = await applyOps(this.sql, plan.ops);
		return { affected: result.affected, undoId, failed: result.failed };
	}

	async bulkJob(jobId: string) {
		return this.#run(getBulkJobQuery(jobId));
	}

	async undo(undoId: string) {
		const payload = await this.#run(takeUndoQuery(undoId));
		if (!payload) return null;
		const result = await applyOps(this.sql, planUndo(payload));
		return { affected: result.affected, failed: result.failed };
	}

	async trashCount() {
		return this.#run(trashCountQuery());
	}

	async emptyTrash(expectedCount: number) {
		let ops;
		try {
			ops = await this.#run(planEmptyTrashQuery(expectedCount));
		} catch (e) {
			if (e instanceof BulkConflictError) return { conflict: e.count };
			throw e;
		}
		if (opSize(ops) === 0) return { deleted: 0, failed: [] };
		const result = await applyOps(this.sql, ops);
		await this.#deleteFiles(result.purged);
		return { deleted: result.affected, failed: result.failed };
	}

	async listLabels() {
		return this.#run(listLabelsQuery());
	}

	async createLabel(input: { name: unknown; color?: unknown; id?: string }) {
		try {
			return { label: await this.#run(createLabelQuery(input)) };
		} catch (e) {
			if (e instanceof LabelError) return { error: e.message };
			throw e;
		}
	}

	async updateLabel(id: string, input: { name?: unknown; color?: unknown }) {
		try {
			return { label: await this.#run(updateLabelQuery(id, input)) };
		} catch (e) {
			if (e instanceof LabelError) return { error: e.message };
			throw e;
		}
	}

	async markLabelsAuto(ids: string[]) {
		return { flagged: await this.#run(markLabelsAutoQuery(ids)) };
	}

	async deleteLabel(id: string) {
		if (!(await this.#run(allLabelsQuery())).some((l) => l.id === id)) return null;
		const keys = await this.#run(labelThreadKeysQuery(id));
		const plan = await this.#run(planBulkQuery(keys, "all", { type: "label_remove", labelId: id }));
		const result = await applyOps(this.sql, plan.ops);
		if (result.failed.length > 0) return { deleted: false, affected: result.affected, failed: result.failed };
		await this.#run(deleteLabelRowsQuery(id));
		return { deleted: true, affected: result.affected, failed: result.failed };
	}
}
