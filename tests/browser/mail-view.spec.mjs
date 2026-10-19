import { expect, test } from "@playwright/test";

// WON-221: the mail view opens, lists the sample inbox and opens a conversation, with no console
// errors and no sideways scroll, at desktop width and at 375px (the projects in playwright.config.mjs).

let errors = [];

test.beforeEach(async ({ page }) => {
	errors = [];
	page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
	page.on("pageerror", (error) => errors.push(String(error)));
});

test.afterEach(async ({ page }) => {
	expect(errors, "console errors").toEqual([]);
	const [scrollWidth, width] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
	expect(scrollWidth, "no sideways scroll").toBeLessThanOrEqual(width);
});

test("the inbox lists conversations and opens one", async ({ page }, testInfo) => {
	await page.goto("/?view=inbox");
	const list = page.getByRole("region", { name: "Conversations" });
	const conversations = list.getByRole("listitem").getByRole("link");
	await expect(conversations.nth(9)).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole("link", { name: /^Inbox, all addresses/ })).toHaveCount(testInfo.project.name === "desktop" ? 1 : 0);

	const second = conversations.nth(1);
	const subject = (await second.textContent()).trim();
	await second.click();
	await expect(page).toHaveURL(/[?&]open=/);
	const message = page.getByRole("region", { name: "Message" });
	await expect(message.getByRole("heading", { level: 1, name: subject })).toBeVisible();
	await expect(message.getByRole("button", { name: "Reply", exact: true })).toBeVisible();

	if (testInfo.project.name === "375px") {
		await message.getByRole("button", { name: "Back to list" }).click();
		await expect(conversations.first()).toBeVisible();
	}
});

test("search finds mail", async ({ page }) => {
	await page.goto("/?view=inbox");
	const search = page.getByRole("combobox", { name: "Search mail" });
	await search.fill("invoice");
	await search.press("Enter");
	await expect(page).toHaveURL(/invoice/);
	await expect(page.getByRole("region", { name: "Conversations" }).getByRole("listitem").first()).toBeVisible({ timeout: 30_000 });
});
