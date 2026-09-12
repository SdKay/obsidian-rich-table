import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// The left-toolbar "select all" button — selects every cell (header
// included) in one click and opens the same range-selection popup a manual
// corner-to-corner drag-select would, so range-level actions (merge/hide/
// delete rows or columns, align, style, copy) don't require dragging by hand.
const SOURCE = tableSource({
	widths: [80, 80],
	rows: [
		{ 0: '1', 1: '2' },
		{ 0: '3', 1: '4' },
	],
});

test('selects every cell and opens the range menu', async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	await page.locator('table.bt-table').hover();
	await page.locator('.bt-ctrl-btn[aria-label="Select all and open menu"]').click();

	// Header and every data cell are highlighted.
	await expect(page.locator('th[data-row="0"][data-col="0"]')).toHaveClass(/bt-selected/);
	await expect(page.locator('th[data-row="0"][data-col="1"]')).toHaveClass(/bt-selected/);
	await expect(page.locator('[data-row="1"][data-col="0"]')).toHaveClass(/bt-selected/);
	await expect(page.locator('[data-row="1"][data-col="1"]')).toHaveClass(/bt-selected/);
	await expect(page.locator('[data-row="2"][data-col="0"]')).toHaveClass(/bt-selected/);
	await expect(page.locator('[data-row="2"][data-col="1"]')).toHaveClass(/bt-selected/);

	// The range-selection popup is open.
	await expect(page.locator('.bt-cell-panel')).toHaveCount(1);
});
