import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported: on an editable table, the title sat visibly right of the table
// it names. Root cause: contentRow permanently reserves addColBtn's width
// alongside <table> (flex-shrink:0, occupying its layout box even while
// invisible), so wrapper's max-content sizing follows the WHOLE row — the
// title, centered in that wider box via text-align:center, landed off by
// half of addColBtn's width. Locked tables have no addColBtn and were never
// affected. Fixed by measuring <table>'s own rendered center and offsetting
// the title (--bt-title-center-adj, updateOuterFrame) to match it exactly,
// rather than centering in whatever box happens to contain it.
test.describe('title centers over the table, not the wider box containing addColBtn', () => {
	const centers = async (page: import('@playwright/test').Page) => page.evaluate(() => {
		const title = document.querySelector('.bt-table-title') as HTMLElement;
		const table = document.querySelector('table.bt-table') as HTMLElement;
		const t = title.getBoundingClientRect();
		const tb = table.getBoundingClientRect();
		return { titleCenter: t.left + t.width / 2, tableCenter: tb.left + tb.width / 2 };
	});

	test('editable table: title center matches table center', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [60, 60, 60], rows: [{ 0: 'a1', 1: 'b1', 2: 'c1' }], title: 'My Title' }));
		await page.waitForTimeout(50);
		const { titleCenter, tableCenter } = await centers(page);
		expect(Math.abs(titleCenter - tableCenter)).toBeLessThanOrEqual(1);
	});

	test('locked table: title center still matches table center (unaffected regression check)', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [60, 60, 60], rows: [{ 0: 'a1', 1: 'b1', 2: 'c1' }], title: 'My Title', locked: true }));
		await page.waitForTimeout(50);
		const { titleCenter, tableCenter } = await centers(page);
		expect(Math.abs(titleCenter - tableCenter)).toBeLessThanOrEqual(1);
	});

	test('centering survives hover (strips appearing changes root geometry)', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [60, 60, 60], rows: [{ 0: 'a1', 1: 'b1', 2: 'c1' }], title: 'My Title' }));
		await page.waitForTimeout(50);
		const wrapperBox = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
		await page.mouse.move(wrapperBox.x + wrapperBox.width / 2, wrapperBox.y + wrapperBox.height / 2);
		await expect.poll(() => page.locator('.bt-col-selector').evaluate((el: HTMLElement) => el.classList.contains('bt-strip-visible')))
			.toBe(true);
		const { titleCenter, tableCenter } = await centers(page);
		expect(Math.abs(titleCenter - tableCenter)).toBeLessThanOrEqual(1);
	});
});

// Reported: the gap between an untitled... no — a TITLED table's title and
// the table itself was uncomfortably large while not hovering (32px, the
// full column-selector clearance reserved permanently via
// --bt-title-sel-pad). --bt-title-mb-pull existed as a theme-authored "pull
// closer" intent but every built-in theme left it at the base default of
// 0px, so the mechanism was effectively dormant everywhere. Raised the base
// default to -20px so every theme gets a tighter at-rest gap without having
// to opt in individually; hover still cancels this via --bt-title-mb-adj
// (unconditionally, regardless of the pull amount), so the col-selector
// strip's clearance is never reduced.
test.describe('title sits closer to the table at rest, without losing hover clearance', () => {
	const SOURCE = tableSource({ widths: [60, 60, 60], rows: [{ 0: 'a1', 1: 'b1', 2: 'c1' }], title: 'My Title' });

	test('at-rest gap is tighter than the full selector-strip clearance', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.waitForTimeout(50);
		const gap = await page.evaluate(() => {
			const title = document.querySelector('.bt-table-title') as HTMLElement;
			const table = document.querySelector('table.bt-table') as HTMLElement;
			return table.getBoundingClientRect().top - title.getBoundingClientRect().bottom;
		});
		expect(gap).toBeLessThan(32);
		expect(gap).toBeGreaterThanOrEqual(0); // never negative — title must never overlap the table
	});

	test('hover still reserves the full 32px clearance for the column-selector strip', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.waitForTimeout(50);
		const wrapperBox = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
		await page.mouse.move(wrapperBox.x + wrapperBox.width / 2, wrapperBox.y + wrapperBox.height / 2);
		await expect.poll(() => page.locator('.bt-col-selector').evaluate((el: HTMLElement) => el.classList.contains('bt-strip-visible')))
			.toBe(true);
		const gap = await page.evaluate(() => {
			const title = document.querySelector('.bt-table-title') as HTMLElement;
			const table = document.querySelector('table.bt-table') as HTMLElement;
			return table.getBoundingClientRect().top - title.getBoundingClientRect().bottom;
		});
		expect(gap).toBeCloseTo(32, 0);
	});
});
