import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

declare global {
	interface Window {
		pinColWidths: (pinTableWidth: boolean) => number;
	}
}

// Regression test for: a table with no explicit column widths ("fresh",
// never manually resized) permanently grew WIDER on every single hover —
// reported and confirmed via real console logs as an unbounded, monotonic
// ratchet (each hover added ~18px, eventually filling the page) — with the
// column selector's right edge one step behind since it's positioned
// BEFORE rebuild()'s pin logic runs each cycle.
//
// NOTE: the actual browser-level trigger (something about how
// .bt-table-content-row's `width: max-content` resolves the table's
// max-content contribution when the table itself has no explicit width)
// could not be reproduced in an isolated fixture across three attempts
// (tight loop, real DOM structure, real requestAnimationFrame-paced
// cycles) — likely something specific to the real Obsidian/Electron
// rendering context. This test instead verifies the concrete code-level
// fix directly: does the auto-layout pin logic (src/renderer.ts's
// rebuild()) give the <table> element itself an explicit width once real
// column widths are known, removing the ambiguity a `width: max-content`
// ancestor could otherwise read as room to invent extra space in.
const FIXTURE = path.resolve(__dirname, './autolayout-width-pin.html');

test('pre-fix: the auto-layout table never gets an explicit width of its own', async ({ page }) => {
	await page.goto(`file://${FIXTURE}`);
	await page.evaluate(() => window.pinColWidths(false));
	const styleWidth = await page.locator('#table').evaluate(el => el.style.width);
	expect(styleWidth).toBe('');
});

test('fix: pinning column widths also pins the table\'s own width to their sum', async ({ page }) => {
	await page.goto(`file://${FIXTURE}`);
	const pinnedTotal = await page.evaluate(() => window.pinColWidths(true));
	const styleWidth = await page.locator('#table').evaluate(el => el.style.width);
	expect(styleWidth).toMatch(/px$/);
	expect(parseFloat(styleWidth)).toBeCloseTo(pinnedTotal, 1); // CSS serialization rounds the raw float slightly
	expect(pinnedTotal).toBeGreaterThan(0);
});

test('fix: repeated pin cycles (simulating repeated hovers) leave the table width stable, not growing', async ({ page }) => {
	await page.goto(`file://${FIXTURE}`);
	const widths: number[] = [];
	for (let i = 0; i < 6; i++) {
		await page.evaluate(() => window.pinColWidths(true));
		widths.push(await page.locator('#table').evaluate(el => el.getBoundingClientRect().width));
	}
	// Every cycle after the table has an explicit width must measure the
	// exact same rendered width — no drift in either direction.
	for (let i = 1; i < widths.length; i++) {
		expect(widths[i]).toBeCloseTo(widths[0], 3);
	}
});
