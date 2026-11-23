// Before the tests: wait for the sample inbox, then load the mail view once. A cold dev server
// writes the seed on its first API request and optimizes dependencies on its first page load,
// which can reload the page; tests start after both.
import { chromium } from "@playwright/test";

export default async function warmUp(config) {
	const { baseURL } = config.projects[0].use;
	const deadline = Date.now() + 240_000;
	for (;;) {
		const body = await fetch(`${baseURL}/api/v1/mail?limit=1`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
		if (body?.conversations?.length) break;
		if (Date.now() > deadline) throw new Error("the dev server never returned sample mail");
		await new Promise((r) => setTimeout(r, 1000));
	}
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		await page.goto(`${baseURL}/?view=inbox`, { timeout: 240_000 });
		await page.getByRole("region", { name: "Conversations" }).getByRole("listitem").first().waitFor({ timeout: 120_000 });
		await page.waitForLoadState("networkidle");
	} finally {
		await browser.close();
	}
}
