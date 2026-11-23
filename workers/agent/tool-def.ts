// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { z } from "zod";
import { type ActivityActor, logged } from "../lib/activity";
import type { Sql } from "../store/sql";

// AI SDK v6 changed tool() overloads significantly. We define tools as plain
// objects matching the Tool type to avoid overload resolution issues.
export function defineTool(def: {
	description: string;
	parameters: z.ZodType<any>;
	execute: (...args: any[]) => Promise<any>;
}) {
	return {
		description: def.description,
		inputSchema: def.parameters,
		execute: def.execute,
	};
}

/** The same tools, each call logged to the activity log (lib/activity.ts). */
export function logTools<T extends Record<string, ReturnType<typeof defineTool>>>(
	tools: T,
	sql: Sql,
	who: { actor: ActivityActor; bound: string | null },
): T {
	return Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, {
		...tool,
		execute: (args: Record<string, unknown>, options: unknown) => logged(sql, who, name, args ?? {}, () => tool.execute(args, options)),
	}])) as T;
}
