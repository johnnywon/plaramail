// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	LinkProvider,
	Loader,
	Toasty,
	TooltipProvider,
} from "@cloudflare/kumo";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { forwardRef, useState } from "react";
import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Link as RouterLink,
	Scripts,
	ScrollRestoration,
	useRouteLoaderData,
} from "react-router";
import type { Route } from "./+types/root";
import ErrorPage from "~/components/ErrorPage";
import { DEFAULT_APP_NAME } from "~/lib/brand";
import { shouldLogMutationError } from "~/lib/mutation-errors";
import { WINDOW_OS_SCRIPT } from "~/lib/window-os";
import { ApiError } from "~/services/api";
import "./index.css";

function makeQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				refetchOnWindowFocus: false,
				retry: (failureCount, error) => {
					// Don't retry 4xx errors (not found, unauthorized, etc.)
					if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
						return false;
					}
					return failureCount < 2;
				},
			},
		},
		mutationCache: new MutationCache({
			// Any mail change can move a conversation in or out of the unified list.
			onSuccess: () => {
				const client = getQueryClient();
				client.invalidateQueries({ queryKey: ["mail"] });
				client.invalidateQueries({ queryKey: ["mail-facets"] });
			},
			onError: (error, _variables, _context, mutation) => {
				// Global fallback for mutations that don't handle errors themselves.
				// Consumers using mutateAsync + try/catch handle their own errors.
				if (shouldLogMutationError(error, mutation.meta)) console.error("Mutation failed:", error);
			},
		}),
	});
}

// Lazy singleton for the browser — avoids module-scope instantiation that
// leaks cache across SSR requests.
let browserQueryClient: QueryClient | undefined;
function getQueryClient() {
	if (typeof window === "undefined") {
		// SSR: always create a fresh client per request to prevent cross-user cache leaks
		return makeQueryClient();
	}
	// Browser: reuse the same client across navigations
	if (!browserQueryClient) browserQueryClient = makeQueryClient();
	return browserQueryClient;
}

const KumoLink = forwardRef<
	HTMLAnchorElement,
	React.AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string }
>(function KumoLink({ href, ...props }, ref) {
	if (href && !href.startsWith("http")) {
		return (
			<RouterLink to={href} ref={ref} {...(props as Record<string, unknown>)} />
		);
	}
	return <a href={href} ref={ref} {...props} />;
});

export function loader({ context, request }: Route.LoaderArgs) {
	return { appName: context.cloudflare.env.APP_NAME || DEFAULT_APP_NAME, origin: new URL(request.url).origin };
}

// The app name only changes on deploy, so client navigations never refetch it.
export function shouldRevalidate() {
	return false;
}

export function Layout({ children }: { children: React.ReactNode }) {
	const data = useRouteLoaderData<typeof loader>("root");
	return (
		// data-os and data-window are set by WINDOW_OS_SCRIPT before hydration.
		<html lang="en" suppressHydrationWarning>
			<head>
				<meta charSet="UTF-8" />
				<script dangerouslySetInnerHTML={{ __html: WINDOW_OS_SCRIPT }} />
				<link
					rel="icon"
					type="image/x-icon"
					href="/favicon.ico"
					sizes="48x48 32x32 16x16"
				/>
				<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
				<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
				<link rel="manifest" href="/site.webmanifest" />
				<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#141518" />
				<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f6f6f4" />
				<meta property="og:title" content={data?.appName || DEFAULT_APP_NAME} />
				{data?.origin && <meta property="og:image" content={`${data.origin}/brand/og-image.png`} />}
				<meta property="og:image:width" content="1200" />
				<meta property="og:image:height" content="630" />
				<meta name="twitter:card" content="summary_large_image" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<title>{data?.appName || DEFAULT_APP_NAME}</title>
				<Meta />
				<Links />
			</head>
			<body className="bg-kumo-recessed text-kumo-default antialiased">
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export function HydrateFallback() {
	return (
		<div className="flex items-center justify-center h-screen">
			<Loader size="lg" />
		</div>
	);
}

export default function App() {
	// Use useState to ensure each SSR request gets a fresh client while the
	// browser reuses the same singleton across navigations.
	const [queryClient] = useState(getQueryClient);
	return (
		<QueryClientProvider client={queryClient}>
			<LinkProvider component={KumoLink}>
				<TooltipProvider>
					<Toasty>
						<Outlet />
					</Toasty>
				</TooltipProvider>
			</LinkProvider>
		</QueryClientProvider>
	);
}

export function ErrorBoundary({ error }: { error: unknown }) {
	if (isRouteErrorResponse(error)) {
		if (error.status === 404) {
			return <ErrorPage status={404} title="Page not found">Nothing lives here.</ErrorPage>;
		}
		return <ErrorPage status={error.status} title={error.statusText || "Something went wrong"} reload>Reload the page, or go back to mail.</ErrorPage>;
	}
	const detail = error instanceof Error && import.meta.env.DEV ? error.stack || error.message : undefined;
	return <ErrorPage title="Something went wrong" detail={detail} reload>Reload the page, or go back to mail.</ErrorPage>;
}
