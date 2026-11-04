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
		const title = document.querySelector('.bt-table-title > span') as HTMLElement;
		const table = document.querySelector('table.bt-table') as HTMLElement;
		const t = title.getBoundingClientRect();
		const tb = table.getBoundingClientRect();
		return { titleCenter: t.left + t.width / 2, tableCenter: tb.left + tb.width / 2 };
	});

	test('editable table: title center matches table center', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [60, 60, 60], rows: [{ 0: 'a1', 1: 'b1', 2: 'c1' }], title: 'My Title' }));
		await page.waitForTimeout(50);
		const { titleCenter, tableCenter } = await centers(page);
		expect(Math.abs(titleCenter - tableCenter)).toBeLessThanOrEqual(1);
	});

	test('locked table: title center still matches table center (unaffected regression check)', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [60, 60, 60], rows: [{ 0: 'a1', 1: 'b1', 2: 'c1' }], title: 'My Title', locked: true }));
		await page.waitForTimeout(50);
		const { titleCenter, tableCenter } = await centers(page);
		expect(Math.abs(titleCenter - tableCenter)).toBeLessThanOrEqual(1);
	});

	test('centering survives hover (strips appearing changes root geometry)', { tag: '@geometry' }, async ({ page, renderFull }) => {
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

// Reported: with a table wider than the note, its title was centered over the whole table, out past
// the note's edge, and the note had to be scrolled sideways to read it.
test.describe('a title stays readable over a table wider than the view', () => {
	const LONG = 'A rather long table title that keeps going well past the width of this table';
	const place = async (page: import('@playwright/test').Page) => page.evaluate(() => {
		const r = (s: string) => (document.querySelector(s) as HTMLElement).getBoundingClientRect();
		const t = r('.bt-table-title > span');
		const table = r('table.bt-table');
		const view = r('.bt-render-root-shell .bt-table-wrapper');
		const root = r('.bt-render-root-shell > .bt-render-root');
		return {
			title: { l: t.left, r: t.right, c: t.left + t.width / 2 },
			shownCenter: (Math.max(table.left, view.left) + Math.min(table.right, view.right)) / 2,
			root: { l: root.left, r: root.right },
			pageScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
		};
	});

	for (const locked of [false, true]) {
		test(`${locked ? 'locked' : 'editable'}: centered over the part of the table on screen`, { tag: '@geometry' }, async ({ page, renderBlock }) => {
			await page.setViewportSize({ width: 420, height: 700 });
			await renderBlock(tableSource({ widths: [200, 200, 200, 200], rows: [{ 0: 'a', 1: 'b' }], title: 'Short', locked }));
			await expect.poll(async () => Math.abs((await place(page)).title.c - (await place(page)).shownCenter)).toBeLessThanOrEqual(1);
			expect((await place(page)).pageScrolls).toBe(false);
		});

		test(`${locked ? 'locked' : 'editable'}: a long title wraps inside the view`, { tag: '@geometry' }, async ({ page, renderBlock }) => {
			await page.setViewportSize({ width: 420, height: 700 });
			await renderBlock(tableSource({ widths: [200, 200, 200, 200], rows: [{ 0: 'a', 1: 'b' }], title: LONG, locked }));
			await page.waitForTimeout(100);
			const p = await place(page);
			expect(p.title.l).toBeGreaterThanOrEqual(p.root.l - 0.5);
			expect(p.title.r).toBeLessThanOrEqual(p.root.r + 0.5);
			expect(p.pageScrolls).toBe(false);
		});
	}
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

	test('at-rest gap is tighter than the full selector-strip clearance', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.waitForTimeout(50);
		const gap = await page.evaluate(() => {
			const title = document.querySelector('.bt-table-title') as HTMLElement;
			const table = document.querySelector('table.bt-table') as HTMLElement;
			return table.getBoundingClientRect().top - title.getBoundingClientRect().bottom;
		});
		expect(gap).toBeLessThan(22);
		expect(gap).toBeGreaterThanOrEqual(0); // never negative — title must never overlap the table
	});

	test('hover still reserves the full 22px (SEL_UNIT) clearance for the column-selector strip', { tag: '@geometry' }, async ({ page, renderFull }) => {
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
		expect(gap).toBeCloseTo(22, 0);
	});
});
