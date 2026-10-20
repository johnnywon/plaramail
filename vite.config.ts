// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// A deployment kept in another repo can point at its own Wrangler config and
// public/ folder (brand files) without copying them into this checkout.
const wranglerConfig = process.env.PLARAMAIL_WRANGLER_CONFIG;
const publicDir = process.env.PLARAMAIL_PUBLIC_DIR;
// The browser check keeps its local D1, R2 and KV apart from the dev server's (playwright.config.mjs).
const persistPath = process.env.PLARAMAIL_PERSIST;

// Dependencies Vite otherwise discovers only after the first request. Re-optimizing them
// mid-load gives the open page a second copy of React ("Invalid hook call").
const PREBUNDLE = [
  "@cloudflare/ai-chat/react",
  "@cloudflare/kumo",
  "@phosphor-icons/react",
  "@tanstack/react-query",
  "@tanstack/react-virtual",
  "@tiptap/extension-color",
  "@tiptap/extension-highlight",
  "@tiptap/extension-image",
  "@tiptap/extension-link",
  "@tiptap/extension-text-align",
  "@tiptap/extension-text-style",
  "@tiptap/extension-underline",
  "@tiptap/react",
  "@tiptap/starter-kit",
  "agents/react",
  "dompurify",
  "react-markdown",
  "remark-gfm",
  "zustand",
];

// PLARAMAIL_DEMO=1 makes a demo build: filled with the sample inbox, no sends, no AI, no sign-in (workers/lib/demo.ts).
const demo = process.env.PLARAMAIL_DEMO === "1";

export default defineConfig({
  // The sample inbox arrives in the developer's working hours. Workers run in UTC, so the build hands over this machine's offset.
  define: {
    __PLARAMAIL_TZ_OFFSET__: JSON.stringify(new Date().getTimezoneOffset()),
    __PLARAMAIL_DEMO__: JSON.stringify(demo),
  },
  publicDir: publicDir ? resolve(publicDir) : "public",
  optimizeDeps: { include: PREBUNDLE },
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      configPath: wranglerConfig ? resolve(wranglerConfig) : undefined,
      persistState: persistPath ? { path: resolve(persistPath) } : undefined,
    }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
});
