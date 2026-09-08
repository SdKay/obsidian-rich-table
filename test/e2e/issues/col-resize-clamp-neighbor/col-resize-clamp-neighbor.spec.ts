import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported: dragging column B's resize handle left past B's own minimum
// width kept growing column C — the neighbor mirrored the raw pointer delta
// rather than how much B actually moved, so once B clamped at its minimum
// and stopped shrinking, C kept growing anyway with nothing on B's side to
// balance it. Fixed by mirroring the CLAMPED amount B actually moved
// (newW - startW), not the unclamped pointer delta — once B is pinned at
// its minimum, that clamped amount stops changing too, and dragging further
// has no effect on either column.
const SOURCE = tableSource({
	widths: [60, 60, 60],
	rows: [{ 0: 'a1', 1: 'b1', 2: 'c1' }],
});

test('dragging column B past its own minimum width does not keep growing column C', async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	const wrapperBox = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
	await page.mouse.move(wrapperBox.x + wrapperBox.width / 2, wrapperBox.y + wrapperBox.height / 2);
	await expect.poll(() => page.locator('.bt-col-selector').evaluate((el: HTMLElement) => el.classList.contains('bt-strip-visible')))
		.toBe(true);

	// The SECOND resize handle sits on column B's (index 1) own right edge —
	// the seam between B and C.
	const handle = page.locator('.bt-sel-resize-col').nth(1);
	await handle.evaluate((el: HTMLElement) => {
		const down = new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: 300, clientY: 10, bubbles: true, cancelable: true });
		el.dispatchEvent(down);
		// B starts at 60px; -30px already clamps it to its 40px minimum.
		const move1 = new PointerEvent('pointermove', { pointerId: 1, clientX: 270, clientY: 10, bubbles: true, cancelable: true });
		el.dispatchEvent(move1);
	});
	const widthsAtFirstClamp = await page.evaluate(() => Array.from(document.querySelectorAll('col')).map(c => parseInt(c.style.width)));
	expect(widthsAtFirstClamp[1], 'B should already be clamped to its minimum').toBe(40);

	await handle.evaluate((el: HTMLElement) => {
		// Drag much further left — B is already at its minimum and cannot
		// shrink any more.
		const move2 = new PointerEvent('pointermove', { pointerId: 1, clientX: 220, clientY: 10, bubbles: true, cancelable: true });
		el.dispatchEvent(move2);
		const up = new PointerEvent('pointerup', { pointerId: 1, clientX: 220, clientY: 10, bubbles: true, cancelable: true });
		el.dispatchEvent(up);
	});

	const finalWidths = await page.evaluate(() => Array.from(document.querySelectorAll('col')).map(c => parseInt(c.style.width)));
	expect(finalWidths[1], 'B stays at its minimum').toBe(40);
	expect(finalWidths[2], 'C should not have kept growing once B was already clamped').toBe(widthsAtFirstClamp[2]);

	const ops = await page.evaluate(() => window.__btOps);
	const cWidthOps = ops.filter((op: { type: string; colId?: string }) => op.type === 'set-col-width' && op.colId === 'c_2');
	for (const op of cWidthOps as { width: number }[]) {
		expect(op.width, 'no committed width for C should exceed what it was when B first clamped').toBe(widthsAtFirstClamp[2]);
	}
});
