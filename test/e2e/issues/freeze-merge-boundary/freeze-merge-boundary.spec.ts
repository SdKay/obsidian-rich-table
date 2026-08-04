import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

declare global {
	interface Window {
		applyFreezeRows: (freezeRows: number, rowSpanAware: boolean) => void;
	}
}

// Regression test for: a merged (rowSpan>1) cell anchored one row above the
// frozen row band's TRUE bottom edge, extending down into it — reproduced
// from a real user table (freezeRows: 3, freezeCols: 3, a merge spanning
// rows 2-3 and columns 1-2). The row-freeze loop's "is this the frozen
// band's last row" check used the cell's own anchor row index, but a
// rowSpan>1 merge only has a DOM element in its anchor row — the row it
// visually extends into has no separate cell to match `idx === freezeRows`
// against — so this merge never got the bottom-seam treatment at all,
// leaving its real border untouched at exactly the boundary and no opaque
// backing there either. Reported as a stray leaking line and clipped/
// obscured text right at the merge. Fix: use the merge's true END row
// (idx + rowSpan - 1), mirroring the colSpan-aware fix the column-freeze
// loop already had for the same class of bug on the other axis.

const FIXTURE = path.resolve(__dirname, './freeze-merge-boundary.html');

test('pre-fix: a rowSpan merge anchored above the boundary never gets the bottom seam', async ({ page }) => {
	await page.goto(`file://${FIXTURE}`);
	await page.evaluate(() => window.applyFreezeRows(3, false));

	const merged = page.locator('#mergedCell');
	const borderBottomColor = await merged.evaluate(el => getComputedStyle(el).borderBottomColor);
	const boxShadow = await merged.evaluate(el => getComputedStyle(el).boxShadow);
	// Bug: the real border survives untouched (not hidden) AND no seam
	// box-shadow was ever added — a plain grid line where a seam belongs.
	expect(borderBottomColor).not.toBe('rgba(0, 0, 0, 0)');
	expect(boxShadow).toBe('none');
});

test('fix: the same merge gets its bottom edge hidden and replaced by the seam line', async ({ page }) => {
	await page.goto(`file://${FIXTURE}`);
	await page.evaluate(() => window.applyFreezeRows(3, true));

	const merged = page.locator('#mergedCell');
	const borderBottomColor = await merged.evaluate(el => getComputedStyle(el).borderBottomColor);
	const boxShadow = await merged.evaluate(el => getComputedStyle(el).boxShadow);
	expect(borderBottomColor).toBe('rgba(0, 0, 0, 0)');
	expect(boxShadow).not.toBe('none');
	expect(boxShadow).toContain('inset');
});

test('fix: a normal (non-merged) cell at the same row boundary is unaffected', async ({ page }) => {
	await page.goto(`file://${FIXTURE}`);
	await page.evaluate(() => window.applyFreezeRows(3, true));

	// data-row="3" data-col="0" ("7") — a plain cell at the frozen band's
	// true last row, no rowSpan involved — must still get the seam exactly
	// as before this fix.
	const plain = page.locator('td[data-row="3"][data-col="0"]');
	const borderBottomColor = await plain.evaluate(el => getComputedStyle(el).borderBottomColor);
	expect(borderBottomColor).toBe('rgba(0, 0, 0, 0)');
});
