// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import api from "~/services/api";
import PostalMail from "~/components/postal/PostalMail";
import { queryKeys } from "~/queries/keys";
import { pageTitle } from "~/lib/brand";

export function meta({ matches }: { matches: Parameters<typeof pageTitle>[0] }) {
	return [{ title: pageTitle(matches) }];
}

export default function HomeRoute() {
	const { data: configData } = useQuery({
		queryKey: queryKeys.config,
		queryFn: () => api.getConfig(),
		staleTime: Infinity, // config rarely changes
	});
	const { data: mailboxes, isFetched: mailboxesFetched } = useQuery({
		queryKey: queryKeys.mailboxes.all,
		queryFn: () => api.listMailboxes(),
	});

	const emailAddresses = configData?.emailAddresses ?? [];

	// Create a mailbox for each configured address that doesn't have one yet.
	// Inbound mail also creates it, so this only matters for a new address.
	const autoCreateDone = useRef(false);
	useEffect(() => {
		if (autoCreateDone.current) return;
		if (emailAddresses.length === 0 || !mailboxesFetched) return;
		autoCreateDone.current = true;
		const existing = new Set((mailboxes ?? []).map((m) => m.email.toLowerCase()));
		for (const addr of emailAddresses) {
			if (!existing.has(addr.toLowerCase())) api.createMailbox(addr, addr.split("@")[0] || addr).catch(() => {});
		}
	}, [emailAddresses, mailboxes, mailboxesFetched]);

	if (!configData) return <div className="flex h-dvh bg-kumo-recessed" />;
	return <PostalMail addresses={emailAddresses.map((a) => a.toLowerCase())} domains={configData.domains} autoDraft={!!configData.autoDraft} demo={!!configData.demo} />;
}
