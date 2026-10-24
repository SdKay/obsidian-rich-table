import { test, expect } from '../common/test-base';

/**
 * The rendered table carries the ids of its rows and columns (on <tr> and <col>, not on every cell),
 * so a block's cell can be found by id however the table is sorted or has hidden parts.
 */
const SOURCE = `---
version: 2
columns:
  - { id: c_a, name: Name, width: 100 }
  - { id: c_b, name: Secret, hidden: true }
  - { id: c_c, name: Score, width: 100 }
rows:
  - { id: r_1, cells: { c_a: zed, c_b: hid1, c_c: "3" } }
  - { id: r_2, cells: { c_a: amy, c_b: hid2, c_c: "1" } }
  - { id: r_3, hidden: true, cells: { c_a: gone, c_c: "9" } }
---
`;
type Page = import('@playwright/test').Page;

const rowIds = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll('tr[data-row-id]')).map(tr => tr.getAttribute('data-row-id')));
const colIds = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll('col[data-col-id]')).map(c => c.getAttribute('data-col-id')));

test.describe('row and column ids in the rendered table', () => {
	test('the header row is "header" and each data row carries its own id, in display order', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		expect(await rowIds(page)).toEqual(['header', 'r_1', 'r_2']);
	});

	test('a visible column carries its id; a hidden column and the hidden-group stand-in carry none', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		expect(await colIds(page)).toEqual(['c_a', 'c_c']);
	});

	test('the hidden-rows indicator row carries no row id', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		expect(await page.locator('tr.bt-row-indicator').count()).toBe(1);
		expect(await page.locator('tr.bt-row-indicator[data-row-id]').count()).toBe(0);
	});

	test('after a sort the ids follow the rows to their new places', async ({ page, renderFull }) => {
		await renderFull(SOURCE.replace('rows:', 'sort: { colId: c_a, dir: asc }\nrows:'));
		expect(await rowIds(page)).toEqual(['header', 'r_2', 'r_1']);
		const firstDataCell = await page.evaluate(() => document.querySelector('tr[data-row-id="r_2"] td')?.textContent);
		expect(firstDataCell).toBe('amy');
	});

	test('a cell is found from its row id and column id', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		const text = await page.evaluate(() => {
			const col = document.querySelector('col[data-col-id="c_c"]') as HTMLElement;
			const tr = document.querySelector('tr[data-row-id="r_1"]') as HTMLElement;
			return tr.querySelector(`[data-col="${col.dataset.col}"]`)?.textContent;
		});
		expect(text).toBe('3');
	});

	test('a filtered-out row has no <tr>, so its id is absent', async ({ page, renderFull }) => {
		await renderFull(SOURCE.replace('{ id: c_c, name: Score, width: 100 }', '{ id: c_c, name: Score, width: 100, filter: ["3"] }'));
		expect(await rowIds(page)).toEqual(['header', 'r_1']);
	});
});
