import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Alignment UI redesign: every relevant menu now offers "Align" behind its
// own divider, opening a second-level menu (Left/Center/Right/Clear) instead
// of showing three inline icons — and, unlike before, the header's own align
// only ever touches the header cell (set-align on "header.c_x"), while the
// whole-column default (still set-col-align, still covers future rows too)
// moved to the column-selector strip's own menu.
const SOURCE = tableSource({
	widths: [80, 80],
	rows: [
		{ 0: 'a1', 1: 'b1' },
		{ 0: 'a2', 1: 'b2' },
	],
});

function clickMenuItem(page: import('@playwright/test').Page, title: string): Promise<boolean> {
	return page.evaluate((title) => {
		const menu = window.RichTableReal.ShimMenu.opened[0];
		return menu ? menu.clickItem(title) : false;
	}, title);
}

async function openAlignSubmenu(page: import('@playwright/test').Page): Promise<void> {
	const alignItem = page.locator('.bt-cp-item', { hasText: 'Align' }).filter({ hasText: /^Align$/ });
	await alignItem.click();
}

test.describe('cell alignment menus', () => {
	test('header panel offers Align, scoped to the header cell only (set-align, not set-col-align)', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('th[data-row="0"][data-col="0"]').dblclick();
		await expect(page.locator('.bt-cp-item', { hasText: /^Align$/ })).toBeVisible();

		await openAlignSubmenu(page);
		const titles = await page.evaluate(() => window.RichTableReal.ShimMenu.opened[0]?.items.map(i => i.title));
		expect(titles).toEqual(['Align left', 'Align center', 'Align right', 'Clear alignment']);

		expect(await clickMenuItem(page, 'Align center')).toBe(true);
		const ops = await page.evaluate(() => window.__btOps);
		expect(ops).toContainEqual({ type: 'set-align', target: 'header.c_0', align: 'center' });
	});

	test('a single data cell\'s Align applies only to that cell (set-align on the exact cell target)', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="0"]').dblclick();
		await openAlignSubmenu(page);

		expect(await clickMenuItem(page, 'Align right')).toBe(true);
		const ops = await page.evaluate(() => window.__btOps);
		expect(ops).toContainEqual({ type: 'set-align', target: 'r_0.c_0', align: 'right' });
	});

	test('a multi-cell drag selection\'s Align applies to the whole selected range', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		const from = (await page.locator('[data-row="1"][data-col="0"]').boundingBox())!;
		const to   = (await page.locator('[data-row="2"][data-col="1"]').boundingBox())!;
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
		await page.mouse.down();
		await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
		await page.mouse.up();

		await expect(page.locator('.bt-cp-item', { hasText: /^Align$/ })).toBeVisible();
		await openAlignSubmenu(page);
		expect(await clickMenuItem(page, 'Align left')).toBe(true);
		const ops = await page.evaluate(() => window.__btOps);
		expect(ops).toContainEqual({ type: 'set-align', target: 'r_0.c_0:r_1.c_1', align: 'left' });
	});

	test('select-all + Align applies to the header too, not just data cells (issue #8)', async ({ page, renderBlock }) => {
		// renderBlock, not renderFull: this is exactly the "does the op have a
		// real visible effect after a genuine write-back + re-render" question
		// that bit here — the underlying bug (matchesHeaderCell had no case
		// for a 'rect' target) is invisible to a test that only inspects the
		// captured op itself, since the op it produces (a rect spanning
		// header.c_0:r_1.c_1) is correct either way; only resolving that
		// target against the header was ever broken.
		const source = `---
version: 2
columns:
  - { id: c_0, name: A }
  - { id: c_1, name: B }
rows:
  - { id: r_0, cells: { c_0: a1, c_1: b1 } }
  - { id: r_1, cells: { c_0: a2, c_1: b2 } }
---
| A | B |
| --- | --- |
| a1 | b1 |
| a2 | b2 |
`;
		const block = await renderBlock(source);
		await page.locator('table.bt-table').hover();
		await page.locator('.bt-ctrl-btn[aria-label="Select all and open menu"]').click();
		await openAlignSubmenu(page);
		expect(await clickMenuItem(page, 'Align right')).toBe(true);

		await expect.poll(() => block.noteText()).toContain('header.c_0');
		await block.reprocess();

		await expect.poll(() => page.locator('th[data-row="0"][data-col="0"]').evaluate(el => getComputedStyle(el).textAlign))
			.toBe('right');
		await expect.poll(() => page.locator('[data-row="1"][data-col="0"]').evaluate(el => getComputedStyle(el).textAlign))
			.toBe('right');
	});

	test('the column-selector strip\'s Align sets the whole-column default (set-col-align), not set-align', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		const wrapperBox = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
		await page.mouse.move(wrapperBox.x + wrapperBox.width / 2, wrapperBox.y + wrapperBox.height / 2);
		await expect.poll(() => page.locator('.bt-col-selector').evaluate((el: HTMLElement) => el.classList.contains('bt-strip-visible')))
			.toBe(true);

		await page.locator('.bt-col-selector [data-idx="0"]').click();
		await expect(page.locator('.bt-cp-item', { hasText: /^Align$/ })).toBeVisible();
		await openAlignSubmenu(page);
		expect(await clickMenuItem(page, 'Align center')).toBe(true);
		const ops = await page.evaluate(() => window.__btOps);
		expect(ops).toContainEqual({ type: 'set-col-align', colId: 'c_0', align: 'center' });
	});
});
