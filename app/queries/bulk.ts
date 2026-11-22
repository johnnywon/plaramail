// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type InfiniteData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type BulkAction, type BulkOutcome, applyAction, sendBulk } from "~/lib/bulk-optimistic";
import type { MailFilter } from "~/lib/mail-filter";
import api, { type BulkJobStarted, type BulkResult, type BulkTarget, type MailPage } from "~/services/api";
import { mailListKey } from "./mail";

export interface BulkVariables {
	target: BulkTarget;
	action: BulkAction;
	/** Thread keys to patch before the server answers; null patches every loaded row. */
	patchKeys: string[] | null;
}

/**
 * Run a bulk action. Loaded rows change at once; rows that leave the view
 * disappear. On error the list goes back to what it was.
 */
export function useBulkAction(filter: MailFilter) {
	const queryClient = useQueryClient();
	const key = mailListKey(filter);
	return useMutation({
		mutationKey: ["bulk"],
		// The caller shows a toast for a changed count.
		meta: { handledStatuses: [409] },
		// Selected conversations go in batches the server accepts; a filter target is one request.
		mutationFn: ({ target, action }: BulkVariables): Promise<BulkOutcome | BulkResult | BulkJobStarted> => ("threadKeys" in target
			? sendBulk((t, a) => api.bulk(t, a) as Promise<BulkResult>, target, action)
			: api.bulk(target, action)),
		onMutate: async ({ action, patchKeys }) => {
			await queryClient.cancelQueries({ queryKey: key });
			const previous = queryClient.getQueryData<InfiniteData<MailPage>>(key);
			const only = patchKeys ? new Set(patchKeys) : null;
			queryClient.setQueryData<InfiniteData<MailPage>>(key, (data) => data && {
				...data,
				pages: data.pages.map((page) => ({
					...page,
					conversations: page.conversations.flatMap((row) => {
						if (only && !only.has(row.thread_key)) return [row];
						const next = applyAction(row, action, filter);
						return next ? [next] : [];
					}),
				})),
			});
			return { previous };
		},
		onError: (_error, _vars, context) => {
			if (context?.previous) queryClient.setQueryData(key, context.previous);
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ["mail"] });
			queryClient.invalidateQueries({ queryKey: ["mail-facets"] });
			queryClient.invalidateQueries({ queryKey: ["labels"] });
		},
	});
}

export function useUndoBulk() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (undoIds: string | string[]) => {
			let affected = 0;
			for (const id of [undoIds].flat().reverse()) affected += (await api.undoBulk(id)).affected;
			return { affected };
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ["mail"] });
			queryClient.invalidateQueries({ queryKey: ["mail-facets"] });
			queryClient.invalidateQueries({ queryKey: ["labels"] });
		},
	});
}
