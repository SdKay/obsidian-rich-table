import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// The toolbar to the left of the table sits inside the outer frame at every zoom: the frame's left line is the toolbar's
// left edge, not a line through the middle of it. The frame is outside the zoomed subtree and the toolbar inside it, so
// the room kept for the toolbar has to be the same on screen for both.
for (const zoom of [100, 116, 150, 75]) {
	test(`the toolbar is inside the outer frame at zoom ${zoom}`, { tag: '@geometry' }, async ({ page, renderFull }) => {
		// Wider than the status bar, so the frame's left line is the toolbar's room beside the table and not the bar's width.
		await renderFull(tableSource({ widths: [200, 200, 200, 200], rows: [{ 0: 'x', 1: 'y' }], zoom }));
		await page.locator('table.bt-table').hover();
		await expect.poll(async () => {
			const frame = await page.locator('.bt-outer-frame').boundingBox();
			const bar = await page.locator('.bt-ctrl-col').boundingBox();
			if (!frame || !bar) return null;
			return Math.round((bar.x - frame.x) * 10) / 10;
		}).toBeGreaterThanOrEqual(-0.5);
	});
}

// ...and it is no wider than it needs to be: the room between the frame's left line and the table is the same 44 px of
// room at every zoom, as it looks on screen, so a zoomed-out table does not float in a frame with a gap beside it.
for (const zoom of [100, 116, 150, 75]) {
	test(`the frame keeps the toolbar's room beside the table at zoom ${zoom}`, { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [200, 200, 200, 200], rows: [{ 0: 'x', 1: 'y' }], zoom }));
		await page.locator('table.bt-table').hover();
		await expect.poll(async () => {
			const frame = await page.locator('.bt-outer-frame').boundingBox();
			const table = await page.locator('table.bt-table').boundingBox();
			const bar = await page.locator('.bt-ctrl-col').boundingBox();
			if (!frame || !table || !bar) return null;
			// The toolbar's left edge is at the frame's line (within its own 2 px) in the zoomed subtree's units.
			return Math.round(Math.abs((table.x - frame.x) - (table.x - bar.x)));
		}).toBeLessThanOrEqual(2);
	});
}
