import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// A header cell can now split into two rows/columns and merge downward into
// data rows, not just sideways into other header cells. Three things had to
// change together for this to actually be reachable: the split-cell-row
// reducer (operations.ts, unit-tested directly in test/split-cell.test.ts),
// a UI entry point for split on the header's own panel (it never had one at
// all before), and the header row's drag-select, which used to only
// recognize a COLUMN difference as "a real selection" — dragging straight
// down (same column) from the header into a data row silently cleared the
// selection instead of opening the merge panel.
const SOURCE = tableSource({
	widths: [80, 80],
	rows: [
		{ 0: 'a1', 1: 'b1' },
		{ 0: 'a2', 1: 'b2' },
	],
});

function clickMenuItem(page: import('@playwright/test').Page, title: string): Promise<boolean> {
	return page.evaluate((title) => {
		const menu = window.RichTableReal.ShimMenu.opened[0];
		return menu ? menu.clickItem(title) : false;
	}, title);
}

test.describe('header row split/merge with data rows', () => {
	test('the header panel offers "Split into 2 rows", dispatching split-cell-row with rowId "header"', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('th[data-row="0"][data-col="0"]').dblclick();
		await page.locator('.bt-cp-item', { hasText: 'Split into 2 rows' }).click();
		const ops = await page.evaluate(() => window.__btOps);
		expect(ops).toContainEqual({ type: 'split-cell-row', rowId: 'header', colId: 'c_0' });
	});

	test('the header panel offers "Split into 2 columns", dispatching split-cell-col with rowId "header"', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('th[data-row="0"][data-col="0"]').dblclick();
		await page.locator('.bt-cp-item', { hasText: 'Split into 2 columns' }).click();
		const ops = await page.evaluate(() => window.__btOps);
		expect(ops).toContainEqual({ type: 'split-cell-col', rowId: 'header', colId: 'c_0' });
	});

	test('dragging straight down from a header cell into a data cell (same column) opens the merge panel, not a cleared selection', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		const from = (await page.locator('th[data-row="0"][data-col="0"]').boundingBox())!;
		const to   = (await page.locator('[data-row="1"][data-col="0"]').boundingBox())!;
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
		await page.mouse.down();
		await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
		await page.mouse.up();

		const mergeItem = page.locator('.bt-cp-item', { hasText: 'Merge cells' });
		await expect(mergeItem).toBeVisible();
		await mergeItem.click();
		const ops = await page.evaluate(() => window.__btOps);
		expect(ops).toContainEqual({ type: 'merge-cells', anchorRowId: 'header', anchorColId: 'c_0', endRowId: 'r_0', endColId: 'c_0' });
	});

	test('dragging up from a data cell into the header (same column) also opens the merge panel', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		const from = (await page.locator('[data-row="1"][data-col="0"]').boundingBox())!;
		const to   = (await page.locator('th[data-row="0"][data-col="0"]').boundingBox())!;
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
		await page.mouse.down();
		await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
		await page.mouse.up();

		const mergeItem = page.locator('.bt-cp-item', { hasText: 'Merge cells' });
		await expect(mergeItem).toBeVisible();
		await mergeItem.click();
		const ops = await page.evaluate(() => window.__btOps);
		expect(ops).toContainEqual({ type: 'merge-cells', anchorRowId: 'header', anchorColId: 'c_0', endRowId: 'r_0', endColId: 'c_0' });
	});

	// renderFull only CAPTURES the merge-cells op (see test-base.ts) rather than
	// applying it and re-rendering — so this starts from a model that already
	// has the merge, instead of clicking "Merge cells" first and expecting the
	// live table to reflect it.
	const ALREADY_MERGED_SOURCE = `---
version: 2
columns:
  - { id: c_0, name: A, width: 80 }
  - { id: c_1, name: B, width: 80 }
rows:
  - { id: r_0, cells: { c_0: a1, c_1: b1 } }
  - { id: r_1, cells: { c_0: a2, c_1: b2 } }
merges:
  - { anchor: header.c_0, end: r_0.c_0 }
---`;

	test('a header cell already merged downward offers "Unmerge cells", dispatching the header-scoped op', async ({ page, renderFull }) => {
		await renderFull(ALREADY_MERGED_SOURCE);
		await page.locator('th[data-row="0"][data-col="0"]').dblclick();
		const unmergeItem = page.locator('.bt-cp-item', { hasText: 'Unmerge cells' });
		await expect(unmergeItem).toBeVisible();
		await unmergeItem.click();
		const ops = await page.evaluate(() => window.__btOps);
		expect(ops).toContainEqual({ type: 'unmerge-cells', anchorRowId: 'header', anchorColId: 'c_0' });
	});

	// Reported after the above shipped: splitting a header cell that has no
	// EXPLICIT style still looked wrong, because the absorbed row's cells are
	// real .bt-td data cells (not .bt-th) — the base stylesheet's .bt-td rule
	// only knows --bt-cell-bg, so with no per-cell style to duplicate the new
	// row fell back to the plain data-cell background instead of matching row
	// 1's header look. duplicateCellStyle (operations.ts) only copies a style
	// rule that actually exists; it was never going to fix a purely
	// theme-default appearance, so the real fix is CSS (styles.css), not a
	// model-layer change.
	const SPLIT_NO_EXPLICIT_STYLE_SOURCE = `---
version: 2
columns:
  - { id: c_0, name: A, width: 80 }
  - { id: c_1, name: B, width: 80 }
rows:
  - { id: r_new, cells: {} }
  - { id: r_0, cells: { c_0: "3", c_1: "4" } }
merges:
  - { anchor: header.c_1, end: r_new.c_1 }
---`;

	test('a row absorbed into <thead> by a header split matches the header background with no explicit style', async ({ page, renderFull }) => {
		await renderFull(SPLIT_NO_EXPLICIT_STYLE_SOURCE);
		const info = await page.evaluate(() => {
			const a1 = document.querySelector('[data-row="0"][data-col="0"]')!;
			const a2 = document.querySelector('[data-row="1"][data-col="0"]')!;
			return {
				a1bg: getComputedStyle(a1).backgroundColor,
				a2bg: getComputedStyle(a2).backgroundColor,
				a2tag: a2.tagName,
				a2parent: a2.closest('tr')!.parentElement!.tagName,
			};
		});
		expect(info.a2bg).toBe(info.a1bg);
		expect(info.a2tag).toBe('TD');
		expect(info.a2parent).toBe('THEAD');
	});
});
