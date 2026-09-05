import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported: dragging a column's resize handle under fractional display
// scaling (Windows 125%/150% etc.) can save a FRACTIONAL width to the model
// — PointerEvent.clientX carries sub-pixel precision there, and the delta
// derived from it flowed straight into the committed set-col-width op with
// no rounding (row-resize's own equivalent code already rounds; column
// resize didn't). A fractional <col> width doesn't visibly misalign in a
// plain Chromium render at integer DPR, but does on the reporter's actual
// display — regardless, an unrounded pixel width is a real inconsistency
// worth closing on its own.
const SOURCE = tableSource({
	widths: [40, 40],
	rows: [{ 0: 'a1', 1: 'b1' }],
});

test('dragging a column resize handle with a fractional pointer delta commits a whole-pixel width', async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	const wrapperBox = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
	await page.mouse.move(wrapperBox.x + wrapperBox.width / 2, wrapperBox.y + wrapperBox.height / 2);
	await expect.poll(() => page.locator('.bt-col-selector').evaluate((el: HTMLElement) => el.classList.contains('bt-strip-visible')))
		.toBe(true);

	// The FIRST resize handle sits on column 0's own right edge — the seam
	// between column A and column B.
	const handle = page.locator('.bt-sel-resize-col').first();
	await handle.evaluate((el: HTMLElement) => {
		const down = new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: 100, clientY: 10, bubbles: true, cancelable: true });
		el.dispatchEvent(down);
		const move = new PointerEvent('pointermove', { pointerId: 1, clientX: 122.6, clientY: 10, bubbles: true, cancelable: true });
		el.dispatchEvent(move);
		const up = new PointerEvent('pointerup', { pointerId: 1, clientX: 122.6, clientY: 10, bubbles: true, cancelable: true });
		el.dispatchEvent(up);
	});

	const ops = await page.evaluate(() => window.__btOps);
	const widthOps = ops.filter((op: { type: string }) => op.type === 'set-col-width');
	expect(widthOps.length).toBeGreaterThan(0);
	for (const op of widthOps) {
		expect(Number.isInteger(op.width), `set-col-width committed a non-integer width: ${op.width}`).toBe(true);
	}
});
