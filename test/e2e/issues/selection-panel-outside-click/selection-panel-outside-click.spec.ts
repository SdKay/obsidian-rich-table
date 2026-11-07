import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// The panel a column's strip opens closes on a click outside the table, and stays open for a click on itself.
const SOURCE = tableSource({ widths: [80, 80, 80], rows: [{ 0: 'a', 1: 'b', 2: 'c' }, { 0: 'd', 1: 'e', 2: 'f' }] });
type P = import('@playwright/test').Page;

const openFromColumnStrip = async (page: P) => {
	await page.locator('table.bt-table').hover();
	const strip = page.locator('.bt-col-selector .bt-sel-cell').nth(1);
	await expect(strip).toBeVisible();
	await strip.click();
	await expect(page.locator('.bt-cell-panel')).toHaveCount(1);
};

const clickOutside = async (page: P) => {
	const t = (await page.locator('table.bt-table').boundingBox())!;
	await page.mouse.click(t.x + t.width / 2, t.y + t.height + 200);
};

test.describe('the selection panel and a click outside the table', () => {
	test('a panel opened from a column strip closes on a click outside', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await openFromColumnStrip(page);
		await clickOutside(page);
		await expect(page.locator('.bt-cell-panel')).toHaveCount(0);
	});

	test('a click on the panel itself, away from its entries, leaves it open', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await openFromColumnStrip(page);
		// A divider does nothing when pressed; every other row of the panel is an action that closes it.
		await page.locator('.bt-cell-panel .bt-cp-divider').first().click();
		await expect(page.locator('.bt-cell-panel')).toHaveCount(1);
	});
});
