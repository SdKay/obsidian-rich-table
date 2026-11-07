import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// While a cell's editor holds a formula, dragging across other cells inserts a reference to them, and shows them
// selected while the drag goes on.
const SOURCE = tableSource({
	widths: [80, 80, 80],
	rows: [{ 0: 'x', 1: '1', 2: '2' }, { 0: 'y', 1: '3', 2: '4' }, { 0: 'z', 1: '5', 2: '6' }],
});
type P = import('@playwright/test').Page;
const cell = (page: P, row: number, col: number) => page.locator(`.bt-td[data-row="${row}"][data-col="${col}"]`).first();
const editorText = (page: P) => page.locator('.bt-cell-editor').first().evaluate(el => el.textContent ?? '');

const startFormula = async (page: P) => {
	await cell(page, 3, 0).click();
	await expect.poll(() => page.locator('.bt-td[data-row="3"][data-col="0"].bt-editing').count()).toBe(1);
	await page.keyboard.press('Control+a');
	await page.keyboard.type('=');
};

const dragFrom = async (page: P, from: [number, number], to: [number, number]) => {
	const a = (await cell(page, ...from).boundingBox())!;
	const b = (await cell(page, ...to).boundingBox())!;
	await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
	await page.mouse.down();
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
};

test.describe('picking a range for a formula', () => {
	test('dragging across cells inserts a reference to the range', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startFormula(page);
		await dragFrom(page, [1, 1], [2, 2]);
		await page.mouse.up();
		await expect.poll(() => editorText(page)).toBe('=B1:C2');
	});

	test('a press without moving inserts a reference to the one cell', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startFormula(page);
		await dragFrom(page, [2, 2], [2, 2]);
		await page.mouse.up();
		await expect.poll(() => editorText(page)).toBe('=C2');
	});

	test('the cells being dragged over are shown selected, and only while the drag goes on', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startFormula(page);
		await dragFrom(page, [1, 1], [2, 2]);
		const selected = async () => page.evaluate(() =>
			Array.from(document.querySelectorAll<HTMLElement>('.bt-td.bt-selected')).map(e => `${e.dataset.row},${e.dataset.col}`).sort());
		expect(await selected()).toEqual(['1,1', '1,2', '2,1', '2,2']);
		await page.mouse.up();
		await expect.poll(selected).toEqual([]);
	});

	test('without a formula, a drag selects cells as usual and inserts nothing', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await dragFrom(page, [1, 1], [2, 2]);
		await page.mouse.up();
		await expect(page.locator('.bt-cell-editor')).toHaveCount(0);
	});
});
