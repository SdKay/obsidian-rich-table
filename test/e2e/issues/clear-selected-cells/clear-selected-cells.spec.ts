import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// "Clear cell contents" in the menu of a multi-cell selection. The selection is
// made with the left-toolbar "select all" button, which opens the same popup a
// drag-select does.
const SOURCE = tableSource({
	widths: [80, 80],
	rows: [
		{ 0: 'a1', 1: 'b1' },
		{ 0: 'a2', 1: 'b2' },
	],
});

const FILTERED = `---
version: 2
columns:
  - { id: c_0, name: A, width: 80, filter: [keep] }
  - { id: c_1, name: B, width: 80 }
rows:
  - { id: r_0, cells: { c_0: keep, c_1: x1 } }
  - { id: r_1, cells: { c_0: drop, c_1: x2 } }
---
`;

type Page = import('@playwright/test').Page;
const ops = (page: Page) =>
	page.evaluate(() => (window as unknown as { __btOps: { type: string; [k: string]: unknown }[] }).__btOps);

const selectAll = async (page: Page) => {
	await page.locator('table.bt-table').hover();
	await page.locator('.bt-ctrl-btn[aria-label="Select all and open menu"]').click();
	await expect(page.locator('.bt-cell-panel')).toHaveCount(1);
};
const clearItem = (page: Page) => page.locator('.bt-cell-panel .bt-cp-item', { hasText: 'Clear cell contents' });

test('the menu of a multi-cell selection offers it, and one click empties every selected cell', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await selectAll(page);
	await clearItem(page).click();

	const sent = await ops(page);
	const fill = sent.find(o => o.type === 'fill-cells') as { cells: { rowId: string; colId: string }[]; values: string[] } | undefined;
	expect(fill, 'no fill-cells op was sent').toBeTruthy();
	expect(fill!.cells.map(c => `${c.rowId}.${c.colId}`).sort()).toEqual(['r_0.c_0', 'r_0.c_1', 'r_1.c_0', 'r_1.c_1']);
	expect(fill!.values.every(v => v === '')).toBe(true);
	// One batched op for the data cells, not one write per cell.
	expect(sent.filter(o => o.type === 'fill-cells')).toHaveLength(1);
});

test('the header cells in the selection are cleared too', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await selectAll(page);
	await clearItem(page).click();

	const names = (await ops(page)).filter(o => o.type === 'set-col-name');
	expect(names.map(o => `${o.colId}:${o.name}`).sort()).toEqual(['c_0:', 'c_1:']);
});

test('a row hidden by a filter is left alone', async ({ page, renderFull }) => {
	await renderFull(FILTERED);
	await selectAll(page);
	await clearItem(page).click();

	const fill = (await ops(page)).find(o => o.type === 'fill-cells') as { cells: { rowId: string }[] } | undefined;
	expect(fill!.cells.map(c => c.rowId)).not.toContain('r_1');
	expect(fill!.cells.map(c => c.rowId)).toContain('r_0');
});
