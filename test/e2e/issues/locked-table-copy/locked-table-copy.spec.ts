import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

/**
 * A locked table has no editing, no onStructuralOp — so the custom drag-select
 * machinery (which exists to open the range-selection panel's merge/hide/
 * delete/copy menu) leads nowhere for it: showSelectionPanel's own
 * `!onStructuralOp` guard means the popup can never open. But the SAME
 * mousedown handler still called `preventDefault()` on every cell, which
 * blocks the browser's native click-and-drag text selection too — leaving a
 * locked table with NO way at all to copy a cell's content, not even by
 * selecting its rendered text and pressing Ctrl+C.
 *
 * Fixed by skipping the whole custom mousedown handler when `onStructuralOp`
 * is absent, so native text selection (and the browser's own Ctrl+C handling
 * of it) works exactly as it would on any other page. Ctrl+C itself is
 * deliberately NOT reimplemented here — see the handler's own comment in
 * renderer.ts for why a custom Ctrl+C binding doesn't work in the real app
 * (Obsidian's own editor consumes it first); native selection's browser-level
 * copy is a different mechanism that isn't intercepted the same way.
 */
const LOCKED = tableSource({
	widths: [80, 80],
	rows: [{ 0: 'copyme', 1: 'b1' }],
	locked: true,
});

const EDITABLE = tableSource({
	widths: [80, 80],
	rows: [{ 0: 'copyme', 1: 'b1' }],
});

test('a locked table lets native drag-select capture a cell\'s text', async ({ page, renderFull }) => {
	await renderFull(LOCKED);
	const cell = page.locator('[data-row="1"][data-col="0"]');
	const box = (await cell.boundingBox())!;

	await page.mouse.move(box.x + 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 5 });
	await page.mouse.up();

	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
	expect(selected).toContain('copyme');

	// The plugin's own custom cell-selection highlight must NOT have engaged —
	// this is native browser text selection instead, not the spreadsheet-style
	// range selection that (correctly) still does nothing on a locked table.
	await expect(cell).not.toHaveClass(/bt-selected/);
});

test('an editable table still gets the custom range-select highlight, not native text selection', async ({ page, renderFull }) => {
	await renderFull(EDITABLE);
	// A drag has to cross into a DIFFERENT cell to count as a range-select
	// (sel.hasMoved) rather than a plain click on the cell it started in —
	// a same-cell drag on an editable table opens the text editor instead,
	// same as a plain click would.
	const cellA = page.locator('[data-row="1"][data-col="0"]');
	const cellB = page.locator('[data-row="1"][data-col="1"]');
	const boxA = (await cellA.boundingBox())!;
	const boxB = (await cellB.boundingBox())!;

	await page.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
	await page.mouse.down();
	await page.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2, { steps: 5 });
	await page.mouse.up();

	await expect(cellA).toHaveClass(/bt-selected/);
	await expect(cellB).toHaveClass(/bt-selected/);
});
