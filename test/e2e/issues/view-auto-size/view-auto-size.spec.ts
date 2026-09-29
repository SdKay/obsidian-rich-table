import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Auto width/height in the view-settings menu is a real toggle: unchecking pins
// the size the view currently has, checking clears it back to auto.
async function openSettings(page: import('@playwright/test').Page) {
	await page.locator('.bt-ctrl-btn[aria-label="View settings"]').click();
}
const clickItem = (page: import('@playwright/test').Page, title: string) =>
	page.evaluate((t) => window.RichTableReal.ShimMenu.opened.at(-1)!.clickItem(t), title);

test('unchecking Auto width pins the current rendered width', async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'a', 1: 'b' }] }));
	const w = Math.round((await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!.width);
	await openSettings(page);
	await clickItem(page, 'Auto width');
	const ops = await page.evaluate(() => window.__btOps);
	expect(ops).toContainEqual({ type: 'set-view-width', width: w });
});

test('unchecking Auto height pins the current rendered height', async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [100], rows: [{ 0: 'a' }, { 0: 'b' }] }));
	const h = Math.round((await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!.height);
	await openSettings(page);
	await clickItem(page, 'Auto height');
	const ops = await page.evaluate(() => window.__btOps);
	expect(ops).toContainEqual({ type: 'set-view-height', height: h });
});

test('with a manual size set, checking Auto clears it', async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'a' }], viewWidth: 300, viewHeight: 120 }));
	await openSettings(page);
	await clickItem(page, 'Auto width');
	await clickItem(page, 'Auto height');
	const ops = await page.evaluate(() => window.__btOps);
	expect(ops).toContainEqual({ type: 'set-view-width', width: null });
	expect(ops).toContainEqual({ type: 'set-view-height', height: null });
});
