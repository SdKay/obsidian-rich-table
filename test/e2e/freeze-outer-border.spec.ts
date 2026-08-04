import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

declare global {
	interface Window {
		applyColumnFreeze: (themeClass: string | null) => { outerLeftColor: string | null; outerLeftWidth: number };
	}
}

// Regression test for: freezing a column silently replaced a theme's own
// bold outer border (e.g. grid.css's --bt-border-outer: 2px solid
// var(--text-normal)) with a color/width-mismatched generic line —
// reported as "the left border disappeared" once freeze was on. Root cause
// and fix: src/renderFreeze.ts's applyFreeze() now reads the table's own
// real border color/width BEFORE suppressing it, and reuses both for the
// frozen block's outer-frame synthetic line instead of a fixed generic one.

const FIXTURE = path.resolve(__dirname, 'fixtures/freeze-outer-border.html');

test('frozen column outer frame matches a theme with a real outer border (grid)', async ({ page }) => {
	await page.goto(`file://${FIXTURE}`);
	const result = await page.evaluate(() => window.applyColumnFreeze('bt-theme-grid'));

	expect(result.outerLeftColor).toBe('rgb(17, 17, 17)'); // --text-normal: #111
	expect(result.outerLeftWidth).toBe(2); // grid.css's --bt-border-outer: 2px

	const frozenCell = page.locator('td[data-col="0"][data-row="1"]');
	const boxShadow = await frozenCell.evaluate(el => getComputedStyle(el).boxShadow);
	expect(boxShadow).toContain('rgb(17, 17, 17)');
	expect(boxShadow).toMatch(/\b2px\b/);

	// The real border is suppressed (not doubled with the synthetic line).
	const borderLeftColor = await page.locator('#table').evaluate(el => getComputedStyle(el).borderLeftColor);
	expect(borderLeftColor).toBe('rgba(0, 0, 0, 0)');

	// applyFreeze's column-freeze path only hides LEFT/RIGHT borders on a
	// frozen cell (hideBorder(cell, 'left')/'right') — TOP/BOTTOM (the
	// row-separator lines between rows 1 and 2, both inside the frozen
	// column) must survive untouched, using the theme's normal grid line —
	// this is the "只有行线" invariant: a frozen column shows row-separator
	// lines only, never a synthetic vertical line between its own rows.
	const rowSeparatorColor = await frozenCell.evaluate(el => getComputedStyle(el).borderBottomColor);
	expect(rowSeparatorColor).not.toBe('rgba(0, 0, 0, 0)');
});

test('frozen column outer frame falls back to the generic divider for a theme with no outer border', async ({ page }) => {
	await page.goto(`file://${FIXTURE}`);
	const result = await page.evaluate(() => window.applyColumnFreeze(null));

	expect(result.outerLeftColor).toBeNull();

	const frozenCell = page.locator('td[data-col="0"][data-row="1"]');
	const boxShadow = await frozenCell.evaluate(el => getComputedStyle(el).boxShadow);
	// --background-modifier-border shim value from the fixture's :root block.
	expect(boxShadow).toContain('rgb(204, 204, 204)');
	expect(boxShadow).toMatch(/\b1px\b/);
});
