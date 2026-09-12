import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported: selecting a range of cells and pressing Ctrl+V did nothing at all
// — paste only ever worked while actively editing a single cell (a native
// browser paste event on the contenteditable), never for a merely Selected
// cell or a multi-cell drag range. Ctrl+V now reads the system clipboard and
// pastes starting at the selection's own top-left, reconstructing any merges
// the copied range had (parseHtmlTableWithMerges) rather than flattening them
// away — matching Excel's own "just make it work" behaviour when the pasted
// shape doesn't line up with what's already at the destination, rather than
// rejecting the paste outright over a merge mismatch. Copy is deliberately
// NOT bound to Ctrl+C (see the keydown handler's own comment, renderer.ts) —
// something ahead of it in the real app already claims that combination with
// the selection panel open, so the panel's own "Copy to Excel" button (which
// this test drives directly) is the one reliable way to copy a range.
const SOURCE = tableSource({
	widths: [80, 80],
	rows: [
		{ 0: 'a1', 1: 'b1' },
		{ 0: 'a2', 1: 'b2' },
		{ 0: 'a3', 1: 'b3' },
	],
	merges: [[0, 0, 1, 0]], // column A merged across storage rows 0-1 (display rows 1-2)
});

test('the selection panel\'s "Copy" button + Ctrl+V on a range copies values AND reconstructs merges at the destination', async ({ page, context, renderFull }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await renderFull(SOURCE);

	// Drag-select the full 2x2 block covering the merge.
	const topLeft = (await page.locator('[data-row="1"][data-col="0"]').boundingBox())!;
	const bottomRight = (await page.locator('[data-row="2"][data-col="1"]').boundingBox())!;
	await page.mouse.move(topLeft.x + topLeft.width / 2, topLeft.y + topLeft.height / 2);
	await page.mouse.down();
	await page.mouse.move(bottomRight.x + bottomRight.width / 2, bottomRight.y + bottomRight.height / 2, { steps: 5 });
	await page.mouse.up();
	await expect(page.locator('[data-row="1"][data-col="0"]')).toHaveClass(/bt-selected/);

	await page.locator('.bt-cp-item', { hasText: 'Copy as Excel/rich-table' }).click();
	// Real clipboard write is async (copyRangeToClipboard) — poll for it to
	// land rather than assume the click alone means it's already there.
	await expect.poll(() => page.evaluate(async () => {
		const items = await navigator.clipboard.read();
		return items.some(i => i.types.includes('text/html'));
	})).toBe(true);

	// A plain click enters EDITING, not Selected (see cellNav's own "three
	// states" doc in CLAUDE.md) — Escape is the only way into Selected, which
	// is what `sel`/effectiveSelRect() (and so Ctrl+V) reads.
	await page.locator('[data-row="3"][data-col="0"]').click();
	await expect.poll(() => page.locator('[data-row="3"][data-col="0"].bt-editing').count()).toBe(1);
	await page.keyboard.press('Escape');
	await expect.poll(() => page.locator('[data-row="3"][data-col="0"].bt-selected').count()).toBe(1);

	await page.keyboard.press('Control+v');

	await expect.poll(() => page.evaluate(() =>
		(window as unknown as { __btOps: { type: string }[] }).__btOps.some(o => o.type === 'paste-values')))
		.toBe(true);
	const pasteOp = await page.evaluate(() =>
		(window as unknown as { __btOps: { type: string; anchorRowId: string; anchorColId: string; values: string[][]; merges?: { r1: number; c1: number; r2: number; c2: number }[] }[] })
			.__btOps.find(o => o.type === 'paste-values')) as { anchorRowId: string; anchorColId: string; values: string[][]; merges?: { r1: number; c1: number; r2: number; c2: number }[] };

	expect(pasteOp.values).toEqual([['a1', 'b1'], ['a1', 'b2']]);
	expect(pasteOp.merges).toEqual([{ r1: 0, c1: 0, r2: 1, c2: 0 }]);
});
