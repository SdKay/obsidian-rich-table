import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported ("在一个窄的但是auto宽度的cell中持续输入内容，超过宽度后会拉高cell以多行
// 形式显示所有输入内容，退出编辑后cell会自动调整宽度变成一行显示"): a narrow auto
// column's editor wrapped to multiple lines mid-edit, then snapped back to
// single-line once the column caught up on commit — the mid-edit wrap was the
// unwanted flicker. Fixed with white-space:pre on the editor (styles.css) plus
// growColLiveForTextEdit (renderAutofit.ts), called on every keystroke: it
// widens the <col> DOM element directly (never through onStructuralOp/the
// model), so the editor stays single-line while typing, and the column still
// shrinks back to whatever the committed content actually needs once a real
// write-back rebuild happens (an auto column's whole point).
//
// Single-line is checked via the editor's own rendered HEIGHT against one
// line's worth (not Range.getClientRects().length — that can return more
// than one rect for a single visual line when a real \n is present, since a
// \n-delimited text-node segment gets its own rect even when it doesn't wrap
// to a new visual row).
test.describe('a narrow auto column stays single-line while typing', () => {
	const oneLineHeight = async (locator: import('@playwright/test').Locator) =>
		locator.evaluate(el => el.getBoundingClientRect().height);

	test('data cell in a mixed explicit+auto table: stays single-line and the <col> widens live, without touching the model', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [150, undefined], rows: [{ 0: 'x', 1: 'y' }] }));
		const cell = 'td[data-row="1"][data-col="1"]';
		await page.locator(cell).click();
		const editor = page.locator(`${cell} .bt-cell-editor`);
		await expect(editor).toHaveCount(1);

		const oneLine = await oneLineHeight(editor);
		const widthBefore = await page.locator('col[data-col="1"]').evaluate(el => parseFloat((el as HTMLElement).style.width) || 0);

		await page.keyboard.type('a fairly long line of text that would exceed a narrow auto column width by a lot honestly');
		await page.waitForTimeout(30);

		const height = await editor.evaluate(el => el.getBoundingClientRect().height);
		expect(height).toBeLessThanOrEqual(oneLine + 1);

		const widthAfter = await page.locator('col[data-col="1"]').evaluate(el => parseFloat((el as HTMLElement).style.width) || 0);
		expect(widthAfter).toBeGreaterThan(widthBefore);

		// growColLiveForTextEdit never dispatches an op — only the eventual
		// content commit does — since a col-width write would persist a fixed
		// width onto what's supposed to stay an auto-tracking column.
		const ops = await page.evaluate(() => (window as unknown as { __btOps: { type: string }[] }).__btOps);
		expect(ops.some(o => o.type === 'set-col-width')).toBe(false);
	});

	// Reported ("它是把左边这一列挤窄实现的...能不能保持其他列宽不变，整体表格宽度调大"):
	// table-layout:fixed pins the whole <table>'s own width too, so growing only
	// the edited column's <col> left the browser to redistribute the extra
	// space by squeezing every OTHER column back down to keep the declared
	// total unchanged. Fixed by growing <table>'s own width by the exact same
	// delta as the column — the extra space then comes from the table
	// widening, and every sibling column keeps its original width untouched.
	test('growing the edited column widens the TABLE, not its sibling columns', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [150, undefined], rows: [{ 0: 'x', 1: 'y' }] }));
		const cell = 'td[data-row="1"][data-col="1"]';
		await page.locator(cell).click();
		const editor = page.locator(`${cell} .bt-cell-editor`);
		await expect(editor).toHaveCount(1);

		const col0Before = await page.locator('col[data-col="0"]').evaluate(el => parseFloat((el as HTMLElement).style.width));
		const col1Before = await page.locator('col[data-col="1"]').evaluate(el => parseFloat((el as HTMLElement).style.width) || 0);
		const tableBefore = await page.locator('table.bt-table').evaluate(el => parseFloat((el as HTMLElement).style.width));

		await page.keyboard.type('a fairly long line of text that would exceed a narrow auto column width by a lot honestly');
		await page.waitForTimeout(30);

		const col0After = await page.locator('col[data-col="0"]').evaluate(el => parseFloat((el as HTMLElement).style.width));
		const col1After = await page.locator('col[data-col="1"]').evaluate(el => parseFloat((el as HTMLElement).style.width));
		const tableAfter = await page.locator('table.bt-table').evaluate(el => parseFloat((el as HTMLElement).style.width));

		expect(col0After).toBe(col0Before); // untouched — the whole point of this test
		expect(tableAfter - tableBefore).toBeCloseTo(col1After - col1Before, 0);
	});

	test('header cell: typing a long column name also stays single-line and grows the column', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [150, undefined], rows: [{ 0: 'x', 1: 'y' }] }));
		const headerCell = 'th[data-row="0"][data-col="1"]';
		await page.locator(headerCell).click();
		const editor = page.locator(`${headerCell} .bt-cell-editor`);
		await expect(editor).toHaveCount(1);

		const oneLine = await oneLineHeight(editor);
		const widthBefore = await page.locator('col[data-col="1"]').evaluate(el => parseFloat((el as HTMLElement).style.width) || 0);

		await page.keyboard.type('A fairly long column name that exceeds its narrow auto width');
		await page.waitForTimeout(30);

		const height = await editor.evaluate(el => el.getBoundingClientRect().height);
		expect(height).toBeLessThanOrEqual(oneLine + 1);

		const widthAfter = await page.locator('col[data-col="1"]').evaluate(el => parseFloat((el as HTMLElement).style.width) || 0);
		expect(widthAfter).toBeGreaterThan(widthBefore);
	});

	test('a real newline (Shift+Enter) still renders as a genuine line break, not just suppressed wrap', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [150, undefined], rows: [{ 0: 'x', 1: 'y' }] }));
		const cell = 'td[data-row="1"][data-col="1"]';
		await page.locator(cell).click();
		const editor = page.locator(`${cell} .bt-cell-editor`);
		await expect(editor).toHaveCount(1);

		const oneLine = await oneLineHeight(editor);
		await page.keyboard.type('line one');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('line two');
		await page.waitForTimeout(30);

		const height = await editor.evaluate(el => el.getBoundingClientRect().height);
		expect(height).toBeGreaterThanOrEqual(oneLine * 1.4); // genuinely two lines tall
		expect(await editor.innerText()).toContain('line one');
		expect(await editor.innerText()).toContain('line two');
	});

	test('the column shrinks back to the committed content\'s real width after a write-back rebuild', async ({ page, renderBlock }) => {
		const r = await renderBlock(tableSource({ widths: [150, undefined], rows: [{ 0: 'x', 1: 'y' }] }));
		const cell = 'td[data-row="1"][data-col="1"]';
		await page.locator(cell).click();
		const editor = page.locator(`${cell} .bt-cell-editor`);
		await expect(editor).toHaveCount(1);

		await page.keyboard.type('a fairly long line of text that would exceed a narrow auto column width by a lot honestly');
		await page.waitForTimeout(30);
		const widthDuring = await page.locator('col[data-col="1"]').evaluate(el => parseFloat((el as HTMLElement).style.width) || 0);

		await page.keyboard.press('Control+a');
		await page.keyboard.type('hi');
		await page.waitForTimeout(30);
		await editor.evaluate(el => el.blur());
		await page.waitForTimeout(200); // the write itself

		// renderBlock doesn't rebuild on its own (see CLAUDE.md's "keyboard cell
		// navigation" section) — reprocess() stands in for Obsidian noticing the
		// file changed and re-running the code-block processor, which is what
		// actually re-measures the auto column against the now-short content.
		await r.reprocess();
		await page.waitForTimeout(50);

		const widthAfter = await page.locator('col[data-col="1"]').evaluate(el => parseFloat((el as HTMLElement).style.width) || 0);
		expect(widthAfter).toBeLessThan(widthDuring);
	});

	// Reported ("中文输入法下...输入取消,...撑开的cell没有自动收缩窄,而且我点autofitall
	// 也无效"): growColLiveForTextEdit's width bump is undone by restoreNodes()
	// once an edit ends with a real content change (the normal write-back →
	// re-render cycle measures a fresh colgroup from scratch) — but an edit
	// that ends WITHOUT one (Escape, or content that round-trips back to
	// rawValue, e.g. an IME composition candidate the user cancels) takes the
	// restoreNodes() branch, which only knew how to restore the cell's own
	// child nodes, not the sibling <col>/<table> width growColLiveForTextEdit
	// had bumped — so the column stayed stuck wide with nothing (not even
	// auto-fit-all, which only touches col[data-auto] columns; this one had
	// been left with a genuine inline width) able to shrink it back short of
	// a full unrelated re-render. Fixed with captureColWidthForTextEdit
	// (renderAutofit.ts), which snapshots both widths before any edit-time
	// growth and is invoked from inside restoreNodes() itself, so every
	// existing "no real change" path gets the undo for free.
	test('an edit that ends with no real content change restores the column\'s pre-edit width', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [150, undefined], rows: [{ 0: 'x', 1: 'y' }] }));
		const cell = 'td[data-row="1"][data-col="1"]';
		await page.locator(cell).click();
		const editor = page.locator(`${cell} .bt-cell-editor`);
		await expect(editor).toHaveCount(1);

		const widthBefore = await page.locator('col[data-col="1"]').evaluate(el => (el as HTMLElement).style.width);

		// Simulate an IME composition candidate that visibly widens the cell,
		// then gets cancelled — the browser reverts the editor's content back
		// to the original stored value with no 'compositiondata' ever confirmed,
		// which is exactly what makes save()'s newValue === rawValue check take
		// the restoreNodes() (no real change) branch instead of a commit.
		await editor.evaluate((el) => {
			el.dispatchEvent(new CompositionEvent('compositionstart'));
			const text = 'a'.repeat(130);
			el.textContent = text;
			el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: text } as InputEventInit));
		});
		await page.waitForTimeout(30);
		const widthDuring = await page.locator('col[data-col="1"]').evaluate(el => (el as HTMLElement).style.width);
		expect(parseFloat(widthDuring)).toBeGreaterThan(parseFloat(widthBefore) || 40);

		await editor.evaluate((el) => {
			el.textContent = 'y'; // reverted by the browser on a cancelled composition
			el.dispatchEvent(new CompositionEvent('compositionend', { data: '' }));
			el.blur();
		});
		await page.waitForTimeout(50);

		const widthAfter = await page.locator('col[data-col="1"]').evaluate(el => (el as HTMLElement).style.width);
		expect(widthAfter).toBe(widthBefore);
		const ops = await page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps);
		expect(ops).toEqual([]); // genuinely no change was ever committed
	});

	test('Escape after growing an auto column restores its pre-edit width', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [150, undefined], rows: [{ 0: 'x', 1: 'y' }] }));
		const cell = 'td[data-row="1"][data-col="1"]';
		await page.locator(cell).click();
		const editor = page.locator(`${cell} .bt-cell-editor`);
		await expect(editor).toHaveCount(1);

		const widthBefore = await page.locator('col[data-col="1"]').evaluate(el => (el as HTMLElement).style.width);
		await page.keyboard.type('a fairly long line of text that would exceed a narrow auto column width by a lot honestly');
		await page.waitForTimeout(30);
		const widthDuring = await page.locator('col[data-col="1"]').evaluate(el => (el as HTMLElement).style.width);
		expect(parseFloat(widthDuring)).toBeGreaterThan(parseFloat(widthBefore) || 40);

		await page.keyboard.press('Escape');
		await page.waitForTimeout(30);

		const widthAfter = await page.locator('col[data-col="1"]').evaluate(el => (el as HTMLElement).style.width);
		expect(widthAfter).toBe(widthBefore);
	});
});
