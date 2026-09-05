import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported: a 2x2 table with column B merged across both data rows — dragging
// a select-all range from A1 down through the merged cell left A3 (the OTHER
// column's cell in the merge's second row) unselected, even though the merged
// cell visually spans both rows. The drag rectangle's end point can only ever
// land on the merge's ANCHOR cell (there's no separate DOM cell for a row a
// merge covers), so the raw start/end rectangle silently stopped one row
// short of the merge's real extent. Fixed by expanding the raw rectangle to
// fully contain any merge it overlaps, mirroring how Excel's own click-drag
// selection behaves — see effectiveSelRect (renderer.ts).
const SOURCE = tableSource({
	widths: [80, 80],
	rows: [
		{ 0: '3', 1: '4' },
		{ 0: '5', 1: '6' },
	],
	merges: [[0, 1, 1, 1]], // column B (col 1), spanning both data rows
});

test('dragging into a merged cell expands the selection to include every row/col the merge spans', async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	const headerA = (await page.locator('th[data-row="0"][data-col="0"]').boundingBox())!;
	const mergedCell = (await page.locator('[data-row="1"][data-col="1"]').boundingBox())!;

	await page.mouse.move(headerA.x + headerA.width / 2, headerA.y + headerA.height / 2);
	await page.mouse.down();
	await page.mouse.move(mergedCell.x + mergedCell.width / 2, mergedCell.y + mergedCell.height / 2, { steps: 5 });
	await page.mouse.up();

	// A3's equivalent: column A (col 0), the merge's second covered row (display row 2).
	await expect(page.locator('[data-row="2"][data-col="0"]')).toHaveClass(/bt-selected/);
	// The merge's own anchor cell should also be selected, same as before the fix.
	await expect(page.locator('[data-row="1"][data-col="1"]')).toHaveClass(/bt-selected/);
});
