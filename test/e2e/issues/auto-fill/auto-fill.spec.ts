import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Auto-fill from a column / row selector: the real menu, the real dialog, and the
// op that comes out of it.
const SOURCE = tableSource({
	widths: [80, 80, 80],
	rows: [
		{ 0: 'a1', 1: 'b1', 2: 'c1' },
		{ 0: 'a2', 1: 'b2', 2: 'c2' },
		{ 0: 'a3', 1: 'b3', 2: 'c3' },
	],
});

type P = import('@playwright/test').Page;
type FillOp = { type: string; cells: { rowId: string; colId: string }[]; values: string[] };

const showStrips = async (page: P) => {
	const box = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await expect.poll(() => page.locator('.bt-col-selector').evaluate((el: HTMLElement) => el.classList.contains('bt-strip-visible'))).toBe(true);
};
const openColumnMenu = async (page: P, idx: number) => {
	await showStrips(page);
	await page.locator(`.bt-col-selector [data-idx="${idx}"]`).click();
};
const openRowMenu = async (page: P, idx: number) => {
	await showStrips(page);
	await page.locator(`.bt-row-selector [data-idx="${idx}"]`).click();
};
/** Drags across the selector strip from one index to another, like a user selecting several. */
const dragSelect = async (page: P, axis: 'col' | 'row', from: number, to: number) => {
	await showStrips(page);
	const a = (await page.locator(`.bt-${axis}-selector [data-idx="${from}"]`).boundingBox())!;
	const b = (await page.locator(`.bt-${axis}-selector [data-idx="${to}"]`).boundingBox())!;
	await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
	await page.mouse.down();
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
	await page.mouse.up();
};
const openDialog = async (page: P) => {
	await page.locator('.bt-cp-item', { hasText: 'Auto-fill…' }).click();
	await expect(page.locator('.modal')).toBeVisible();
};
const fillOps = (page: P) =>
	page.evaluate(() => (window as unknown as { __btOps: FillOp[] }).__btOps.filter(o => o.type === 'fill-cells'));
const setting = (page: P, name: string) => page.locator('.modal .setting-item', { hasText: name });
const pickType = (page: P, kind: string) => setting(page, 'Fill type').locator('select').selectOption(kind);
const submit = (page: P) => page.locator('.modal button', { hasText: /^Fill$/ }).click();

test.describe('auto-fill', () => {
	test('a column fills its data rows with 1, 2, 3 by default', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await openColumnMenu(page, 1);
		await openDialog(page);
		await submit(page);
		const ops = await fillOps(page);
		expect(ops).toHaveLength(1);
		expect(ops[0]?.cells).toEqual([
			{ rowId: 'r_0', colId: 'c_1' }, { rowId: 'r_1', colId: 'c_1' }, { rowId: 'r_2', colId: 'c_1' },
		]);
		expect(ops[0]?.values).toEqual(['1', '2', '3']);
	});

	test('start and step are honoured, including a negative step', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await openColumnMenu(page, 0);
		await openDialog(page);
		await setting(page, 'Start value').locator('input').fill('10');
		await setting(page, 'Step').locator('input').fill('-3');
		await submit(page);
		expect((await fillOps(page))[0]?.values).toEqual(['10', '7', '4']);
	});

	test('circled and roman forms', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await openColumnMenu(page, 0);
		await openDialog(page);
		await pickType(page, 'circled');
		await submit(page);
		expect((await fillOps(page))[0]?.values).toEqual(['①', '②', '③']);

		await openColumnMenu(page, 1);
		await openDialog(page);
		await pickType(page, 'roman');
		await submit(page);
		expect((await fillOps(page))[1]?.values).toEqual(['I', 'II', 'III']);
	});

	test('dates step by the chosen unit', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await openColumnMenu(page, 2);
		await openDialog(page);
		await pickType(page, 'date');
		await setting(page, 'Start date').locator('input').fill('2026-01-31');
		await setting(page, 'Step unit').locator('select').selectOption('month');
		await submit(page);
		expect((await fillOps(page))[0]?.values).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
	});

	test('a row fills left to right', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await openRowMenu(page, 2);
		await openDialog(page);
		await submit(page);
		const op = (await fillOps(page))[0]!;
		expect(op.cells.map(c => `${c.rowId}.${c.colId}`)).toEqual(['r_1.c_0', 'r_1.c_1', 'r_1.c_2']);
		expect(op.values).toEqual(['1', '2', '3']);
	});

	test('several selected columns each restart from the first value', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await dragSelect(page, 'col', 0, 1);
		await openDialog(page);
		await submit(page);
		const ops = await fillOps(page);
		expect(ops).toHaveLength(2);
		expect(ops.map(o => o.cells.map(c => c.colId))).toEqual([['c_0', 'c_0', 'c_0'], ['c_1', 'c_1', 'c_1']]);
		expect(ops.map(o => o.values)).toEqual([['1', '2', '3'], ['1', '2', '3']]);
	});

	test('selecting the header together with data rows fills only the data rows', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await dragSelect(page, 'row', 0, 1);
		await openDialog(page);
		await submit(page);
		const ops = await fillOps(page);
		expect(ops).toHaveLength(1);
		expect(ops[0]?.cells.map(c => c.rowId)).toEqual(['r_0', 'r_0', 'r_0']);
	});

	test('the header row has no auto-fill', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await openRowMenu(page, 0);
		await expect(page.locator('.bt-cp-item', { hasText: 'Auto-fill…' })).toHaveCount(0);
	});

	test('a bad start date shows a message and writes nothing', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await openColumnMenu(page, 0);
		await openDialog(page);
		await pickType(page, 'date');
		await setting(page, 'Start date').locator('input').fill('2026-02-30');
		await submit(page);
		expect(await fillOps(page)).toEqual([]);
		await expect(page.locator('.modal')).toBeVisible();
		await expect(page.locator('.modal .bt-fill-preview')).toHaveText('Enter the start date as YYYY-MM-DD');
	});

	test('the dialog previews the first values as they are typed', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await openColumnMenu(page, 0);
		await openDialog(page);
		await expect(page.locator('.modal .bt-fill-preview')).toHaveText('1, 2, 3');
		await setting(page, 'Step').locator('input').fill('5');
		await expect(page.locator('.modal .bt-fill-preview')).toHaveText('1, 6, 11');
	});

	test('the dialog remembers the last choices for the next fill', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await openColumnMenu(page, 0);
		await openDialog(page);
		await pickType(page, 'roman');
		await submit(page);
		await openColumnMenu(page, 1);
		await openDialog(page);
		expect(await setting(page, 'Fill type').locator('select').inputValue()).toBe('roman');
	});
});
