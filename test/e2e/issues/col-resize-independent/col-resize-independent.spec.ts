import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported: dragging the seam between columns B and C changed BOTH columns —
// B grew/shrank and C shrank/grew to match, keeping the table's overall width
// constant. That's neither how Excel's own column resize behaves (only the
// dragged column changes; the table's total width grows/shrinks with it) nor
// consistent with how row-resize already works in this same file
// (bindResizeHandle never touches any row but the one being dragged). An
// earlier, narrower fix (col-resize-clamp-neighbor, since removed) had only
// clamped how much of the mirrored shrink/growth carried onto the neighbor
// once the dragged column hit its own minimum — that fix's whole premise
// (mirroring at all) is what this report asks to remove entirely: dragging B
// must never move C's width by so much as a pixel, not even before B clamps.
const SOURCE = tableSource({
	widths: [60, 60, 60],
	rows: [{ 0: 'a1', 1: 'b1', 2: 'c1' }],
});

test('dragging column B never changes column C\'s width, and the table\'s total width tracks B alone', async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	const wrapperBox = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
	await page.mouse.move(wrapperBox.x + wrapperBox.width / 2, wrapperBox.y + wrapperBox.height / 2);
	await expect.poll(() => page.locator('.bt-col-selector').evaluate((el: HTMLElement) => el.classList.contains('bt-strip-visible')))
		.toBe(true);

	const startWidths = await page.evaluate(() => Array.from(document.querySelectorAll('col')).map(c => parseInt(c.style.width)));
	const startTableWidth = await page.locator('table.bt-table').evaluate(el => parseInt((el as HTMLElement).style.width));
	expect(startWidths).toEqual([60, 60, 60]);
	expect(startTableWidth).toBe(180);

	// The SECOND resize handle sits on column B's (index 1) own right edge —
	// the seam between B and C.
	const handle = page.locator('.bt-sel-resize-col').nth(1);
	await handle.evaluate((el: HTMLElement) => {
		const down = new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: 300, clientY: 10, bubbles: true, cancelable: true });
		el.dispatchEvent(down);
		// Widen B by 40px.
		const move1 = new PointerEvent('pointermove', { pointerId: 1, clientX: 340, clientY: 10, bubbles: true, cancelable: true });
		el.dispatchEvent(move1);
	});
	const widthsWhileWidening = await page.evaluate(() => Array.from(document.querySelectorAll('col')).map(c => parseInt(c.style.width)));
	expect(widthsWhileWidening, 'only B should have grown').toEqual([60, 100, 60]);
	const tableWidthWhileWidening = await page.locator('table.bt-table').evaluate(el => parseInt((el as HTMLElement).style.width));
	expect(tableWidthWhileWidening, 'the table should have grown by exactly the amount B grew').toBe(220);

	await handle.evaluate((el: HTMLElement) => {
		// Now drag B far past its own minimum width — even while B is clamped,
		// C must stay untouched (this is exactly the scenario the removed
		// clamp-neighbor fix used to still move C in, just by a bounded amount).
		const move2 = new PointerEvent('pointermove', { pointerId: 1, clientX: 150, clientY: 10, bubbles: true, cancelable: true });
		el.dispatchEvent(move2);
		const up = new PointerEvent('pointerup', { pointerId: 1, clientX: 150, clientY: 10, bubbles: true, cancelable: true });
		el.dispatchEvent(up);
	});

	const finalWidths = await page.evaluate(() => Array.from(document.querySelectorAll('col')).map(c => parseInt(c.style.width)));
	expect(finalWidths[1], 'B clamps to its minimum').toBe(40);
	expect(finalWidths[2], 'C must never move, clamped or not').toBe(60);
	const finalTableWidth = await page.locator('table.bt-table').evaluate(el => parseInt((el as HTMLElement).style.width));
	expect(finalTableWidth, "the table's total width should reflect only B's own change").toBe(160);

	const ops = await page.evaluate(() => window.__btOps);
	expect(ops.some((op: { type: string; colId?: string }) => op.type === 'set-col-width' && op.colId === 'c_2'),
		'no set-col-width op should ever be dispatched for C').toBe(false);
	const bWidthOps = ops.filter((op: { type: string; colId?: string }) => op.type === 'set-col-width' && op.colId === 'c_1');
	expect(bWidthOps, 'exactly one committed width for B, on pointerup').toHaveLength(1);
	expect((bWidthOps[0] as { width: number }).width).toBe(40);
});
