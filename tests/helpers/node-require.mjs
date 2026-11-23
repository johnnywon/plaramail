/**
 * esbuild banner for ESM bundles run in Node. Some packages are CommonJS that
 * require() Node built-ins (@vercel/oidc, through the AI SDK), which an ESM
 * bundle can only do with a real `require` in scope.
 */
export const NODE_REQUIRE = {
	js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(process.cwd() + '/');",
};
