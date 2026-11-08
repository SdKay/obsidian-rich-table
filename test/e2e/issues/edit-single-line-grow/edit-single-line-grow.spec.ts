import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// An edited cell is laid out the way its column is: text wraps inside a column that wraps, and stays on one line in
// one that does not, which the browser widens as the text grows. Nothing outside the cell is changed for the edit, so
// an edit that ends without a change (Escape, a cancelled IME composition) leaves the column as it was.
//
// One line is told apart by the editor's height against a single short line's: Range.getClientRects() can return
// more than one rect for one visual line when a real \n is present.
const LONG = 'a fairly long line of text that would exceed a narrow auto column width by a lot honestly';
const CELL = 'td[data-row="1"][data-col="1"]';
// A view narrower than LONG on one line, so a column that does not wrap has to run past it and one that wraps folds.
const NOWRAP = () => tableSource({ widths: [150, 0], wraps: [undefined, false], rows: [{ 0: 'x', 1: 'y' }], viewWidth: 320 });
const WRAP = tableSource({ widths: [150, 0], rows: [{ 0: 'x', 1: 'y' }], viewWidth: 320 });

const cellWidth = (page: import('@playwright/test').Page, sel = CELL) =>
	page.locator(sel).evaluate(el => el.getBoundingClientRect().width);
const height = (locator: import('@playwright/test').Locator) => locator.evaluate(el => el.getBoundingClientRect().height);

test.describe('editing a column that does not wrap', () => {
	test('the source marks the column', async () => {
		expect(NOWRAP()).toContain('wrap: false');
	});

	test('a data cell stays on one line and the column widens with the text, without touching the model', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(NOWRAP());
		await page.locator(CELL).click();
		const editor = page.locator(`${CELL} .bt-cell-editor`);
		await expect(editor).toHaveCount(1);
		const oneLine = await height(editor);
		const before = await cellWidth(page);

		await page.keyboard.type(LONG);
		expect(await height(editor)).toBeLessThanOrEqual(oneLine + 1);
		expect(await cellWidth(page)).toBeGreaterThan(before + 100);
		const g = await page.evaluate(() => { const w = document.querySelector('.bt-table-wrapper') as HTMLElement; return { scrollW: w.scrollWidth, viewW: w.clientWidth }; });
		expect(g.scrollW, 'the line runs past the view, which scrolls').toBeGreaterThan(g.viewW + 50);
		const ops = await page.evaluate(() => (window as unknown as { __btOps: { type: string }[] }).__btOps);
		expect(ops.some(o => o.type === 'set-col-width')).toBe(false);
	});

	test('growing the edited column leaves the column with a width as it was', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(NOWRAP());
		await page.locator(CELL).click();
		await expect(page.locator(`${CELL} .bt-cell-editor`)).toHaveCount(1);
		const before = await cellWidth(page, 'td[data-row="1"][data-col="0"]');
		await page.keyboard.type(LONG);
		expect(await cellWidth(page, 'td[data-row="1"][data-col="0"]')).toBeCloseTo(before, 0);
	});

	test('a header cell stays on one line too', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(NOWRAP());
		const header = 'th[data-row="0"][data-col="1"]';
		await page.locator(header).click();
		const editor = page.locator(`${header} .bt-cell-editor`);
		await expect(editor).toHaveCount(1);
		const oneLine = await height(editor);
		const before = await cellWidth(page, header);
		await page.keyboard.type('A fairly long column name that exceeds its narrow auto width');
		expect(await height(editor)).toBeLessThanOrEqual(oneLine + 1);
		expect(await cellWidth(page, header)).toBeGreaterThan(before);
	});

	test('a real newline (Shift+Enter) is still a line break', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(NOWRAP());
		await page.locator(CELL).click();
		const editor = page.locator(`${CELL} .bt-cell-editor`);
		await expect(editor).toHaveCount(1);
		const oneLine = await height(editor);
		await page.keyboard.type('line one');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('line two');
		expect(await height(editor)).toBeGreaterThanOrEqual(oneLine * 1.4);
		expect(await editor.innerText()).toContain('line one');
		expect(await editor.innerText()).toContain('line two');
	});

	test('the column is as wide as the committed text after the write-back rebuild', { tag: '@geometry' }, async ({ page, renderBlock }) => {
		const r = await renderBlock(NOWRAP());
		await page.locator(CELL).click();
		const editor = page.locator(`${CELL} .bt-cell-editor`);
		await expect(editor).toHaveCount(1);
		await page.keyboard.type(LONG);
		const during = await cellWidth(page);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('hi');
		await editor.evaluate(el => el.blur());
		await expect.poll(() => r.noteText()).toContain('c_1: hi');
		await r.reprocess();
		expect(await cellWidth(page)).toBeLessThan(during);
	});

	test('an edit that ends with no change (a cancelled IME composition) leaves the column as it was', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(NOWRAP());
		await page.locator(CELL).click();
		const editor = page.locator(`${CELL} .bt-cell-editor`);
		await expect(editor).toHaveCount(1);
		const before = await cellWidth(page);
		await editor.evaluate((el) => {
			el.dispatchEvent(new CompositionEvent('compositionstart'));
			const text = 'a'.repeat(130);
			el.textContent = text;
			el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: text } as InputEventInit));
		});
		expect(await cellWidth(page)).toBeGreaterThan(before + 100);
		await editor.evaluate((el) => {
			el.textContent = 'y';
			el.dispatchEvent(new CompositionEvent('compositionend', { data: '' }));
			el.blur();
		});
		await expect.poll(() => cellWidth(page)).toBeCloseTo(before, 0);
		expect(await page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps)).toEqual([]);
	});

	test('Escape leaves the column as it was', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(NOWRAP());
		await page.locator(CELL).click();
		await expect(page.locator(`${CELL} .bt-cell-editor`)).toHaveCount(1);
		const before = await cellWidth(page);
		await page.keyboard.type(LONG);
		expect(await cellWidth(page)).toBeGreaterThan(before + 100);
		await page.keyboard.press('Escape');
		await expect.poll(() => cellWidth(page)).toBeCloseTo(before, 0);
	});
});

test.describe('editing a column that wraps', () => {
	test('long text wraps inside the view instead of widening the table past it', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(WRAP);
		await page.locator(CELL).click();
		const editor = page.locator(`${CELL} .bt-cell-editor`);
		await expect(editor).toHaveCount(1);
		const oneLine = await height(editor);
		await page.keyboard.type(LONG);
		const g = await page.evaluate(() => {
			const w = document.querySelector('.bt-table-wrapper') as HTMLElement;
			return { scrollW: w.scrollWidth, viewW: w.clientWidth };
		});
		expect(g.scrollW).toBeLessThanOrEqual(g.viewW + 1);
		expect(await height(editor)).toBeGreaterThan(oneLine * 1.5);
	});
});
