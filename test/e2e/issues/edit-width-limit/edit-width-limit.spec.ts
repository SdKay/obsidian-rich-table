import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';
import type { Page } from '@playwright/test';

// While a cell is edited, an auto column widens with its text but never past the
// view; a fixed-width column keeps its width and the text wraps inside it.
const LONG = 'a fairly long line of text that goes on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on';
const CELL = 'td[data-row="1"][data-col="1"]';

const startEditing = async (page: Page) => {
	await page.locator(CELL).click();
	await page.locator(`${CELL} .bt-cell-editor`).waitFor();
	await page.keyboard.press('Control+a');
};

const geometry = (page: Page) => page.evaluate(() => {
	const w = document.querySelector('.bt-table-wrapper') as HTMLElement;
	const c = document.querySelector('td[data-row="1"][data-col="1"]') as HTMLElement;
	const e = c.querySelector('.bt-cell-editor') as HTMLElement;
	const wr = w.getBoundingClientRect(), cr = c.getBoundingClientRect();
	return { cellW: cr.width, cellRight: cr.right - wr.left, viewW: w.clientWidth, scrollW: w.scrollWidth, editorH: e.getBoundingClientRect().height };
});

/** Height of the editor holding a single short line, for telling wrapped from unwrapped. */
const oneLine = async (page: Page) => (await geometry(page)).editorH;

const SPECS = {
	fixed: tableSource({ widths: [150, 120], rows: [{ 0: 'x', 1: 'y' }], viewWidth: 400 }),
	mixedAuto: tableSource({ widths: [150, undefined], rows: [{ 0: 'x', 1: 'y' }], viewWidth: 400 }),
	allAuto: tableSource({ widths: [undefined, undefined], rows: [{ 0: 'x', 1: 'y' }], viewWidth: 400 }),
};

test('a fixed-width column keeps its width while typing, and the text wraps inside it', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(SPECS.fixed);
	await startEditing(page);
	const before = await geometry(page);
	await page.keyboard.type(LONG);
	const after = await geometry(page);
	expect(after.cellW).toBeCloseTo(before.cellW, 0);
	expect(after.scrollW, 'the table grew past the view').toBe(after.viewW);
	expect(after.editorH, 'long text should wrap in a fixed column').toBeGreaterThan(before.editorH * 1.5);
});

for (const [name, source] of [['a mixed table', SPECS.mixedAuto], ['an all-auto table', SPECS.allAuto]] as const) {
	test(`an auto column in ${name} widens with its text but stops at the view`, { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(source);
		await startEditing(page);
		const before = await geometry(page);
		await page.keyboard.type('a bit longer');
		const mid = await geometry(page);
		expect(mid.cellW, 'short text should still widen the column').toBeGreaterThan(before.cellW);
		expect(mid.editorH, 'short text should stay on one line').toBeLessThanOrEqual(before.editorH + 1);

		await page.keyboard.type(LONG);
		const after = await geometry(page);
		expect(after.cellRight, 'the cell ran past the right edge of the view').toBeLessThanOrEqual(after.viewW + 1);
		expect(after.scrollW, 'the table grew past the view').toBeLessThanOrEqual(after.viewW + 1);
		expect(after.editorH, 'text past the limit should wrap').toBeGreaterThan(before.editorH * 1.5);
	});
}

test('the view never widens past the note pane when there is no view width', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [undefined, undefined], rows: [{ 0: 'x', 1: 'y' }] }));
	await page.evaluate(() => { (document.querySelector('.markdown-preview-view') as HTMLElement).style.cssText = 'width:700px'; });
	await startEditing(page);
	const before = await geometry(page);
	await page.keyboard.type(LONG);
	const g = await geometry(page);
	expect(g.cellRight).toBeLessThanOrEqual(g.viewW + 1);
	expect(g.scrollW).toBeLessThanOrEqual(g.viewW + 1);
	// The view follows its content here, so the limit is the pane, not the width it started with.
	expect(g.viewW, 'the view should have grown with the text, up to the pane').toBeGreaterThan(before.viewW * 2);
});

test('the limit leaves the columns to the left at their own width', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(SPECS.mixedAuto);
	await startEditing(page);
	const left = () => page.locator('col[data-col="0"]').evaluate(el => parseFloat((el as HTMLElement).style.width));
	const before = await left();
	await page.keyboard.type(LONG);
	expect(await left()).toBe(before);
});

test('the width set while editing is not persisted', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(SPECS.mixedAuto);
	await startEditing(page);
	await page.keyboard.type(LONG);
	const ops = await page.evaluate(() => (window as unknown as { __btOps: { type: string }[] }).__btOps);
	expect(ops.some(o => o.type === 'set-col-width')).toBe(false);
});

// A cell that is already wider than the view at rest (its column was sized to the whole line)
// is brought back inside the view for the edit, instead of keeping that width.
const WIDE_AT_REST = `---
version: 2
columns:
  - { id: c_1, name: A, width: 89 }
  - { id: c_2, name: B, width: 83 }
  - { id: c_3, name: C }
rows:
  - id: r_1
    cells:
      c_1: one
      c_2: two
      c_3: ${'a long description that was written on one line and runs well past the edge of the view '.repeat(4)}
viewWidth: 736
---
`;

test('an auto column that is wider than the view at rest is brought inside it for the edit', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(WIDE_AT_REST);
	const rest = await page.evaluate(() => (document.querySelector('.bt-table-wrapper') as HTMLElement).scrollWidth);
	const viewW = await page.evaluate(() => (document.querySelector('.bt-table-wrapper') as HTMLElement).clientWidth);
	expect(rest, 'the fixture should overflow the view at rest').toBeGreaterThan(viewW + 100);

	await page.locator('td[data-row="1"][data-col="2"]').click();
	await page.locator('td[data-row="1"][data-col="2"] .bt-cell-editor').waitFor();
	const g = await page.evaluate(() => {
		const w = document.querySelector('.bt-table-wrapper') as HTMLElement;
		const c = document.querySelector('td[data-row="1"][data-col="2"]') as HTMLElement;
		const r = document.createRange(); r.selectNodeContents(c.querySelector('.bt-cell-editor')!);
		const lines = new Set([...r.getClientRects()].map(x => Math.round(x.top)));
		return { scrollW: w.scrollWidth, viewW: w.clientWidth, lines: lines.size, cellRight: c.getBoundingClientRect().right - w.getBoundingClientRect().left };
	});
	expect(g.scrollW, 'the table still runs past the view while editing').toBeLessThanOrEqual(g.viewW + 1);
	expect(g.cellRight).toBeLessThanOrEqual(g.viewW + 1);
	expect(g.lines, 'the text should wrap inside the narrower column').toBeGreaterThan(1);
});

// The limit is worked out again on every key. Typed one character at a time past the point where
// the text wraps, the column has to hold at its limit and not drift away from it.
test('typing on past the limit leaves the column at the limit', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(SPECS.mixedAuto);
	await startEditing(page);
	const colWidth = () => page.locator('col[data-col="1"]').evaluate(el => parseFloat((el as HTMLElement).style.width));
	let last = await colWidth();
	let reached = 0;
	for (const ch of LONG) {
		await page.keyboard.type(ch);
		const now = await colWidth();
		expect(now, 'the column got narrower while typing').toBeGreaterThanOrEqual(last - 0.5);
		last = now;
		if (now > reached) reached = now;
	}
	const g = await geometry(page);
	expect(g.cellRight).toBeLessThanOrEqual(g.viewW + 1);
	expect(last, 'the column should sit at its limit, not shrink away from it').toBeGreaterThan(g.viewW * 0.5);
});

// A description column written on one long line: its width at rest is the whole line, far past the
// view. Editing it has to fold the text back into the view, with every line a reasonable length.
test('a long description column is folded into the view while it is edited', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(`---
version: 2
columns:
  - { id: c_1, name: Field, width: 89 }
  - { id: c_2, name: Size, width: 83 }
  - { id: c_3, name: Function }
rows:
  - id: r_1
    cells:
      c_1: rsvd1
      c_2: 6b
      c_3: ${'The next few steps are to drop the test commits, then tidy up the history and re-date every one of the commits '.repeat(3)}
viewWidth: 736
---
`);
	await page.locator('td[data-row="1"][data-col="2"]').click();
	await page.locator('td[data-row="1"][data-col="2"] .bt-cell-editor').waitFor();
	const g = await page.evaluate(() => {
		const w = document.querySelector('.bt-table-wrapper') as HTMLElement;
		const c = document.querySelector('td[data-row="1"][data-col="2"]') as HTMLElement;
		const r = document.createRange(); r.selectNodeContents(c.querySelector('.bt-cell-editor')!);
		const tops = new Map<number, number>();
		for (const rect of r.getClientRects()) tops.set(Math.round(rect.top), Math.max(tops.get(Math.round(rect.top)) ?? 0, rect.right - rect.left));
		const lines = [...tops.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
		return { scrollW: w.scrollWidth, viewW: w.clientWidth, lines, cellW: c.getBoundingClientRect().width };
	});
	expect(g.scrollW).toBeLessThanOrEqual(g.viewW + 1);
	expect(g.lines.length, 'the text should fold into several lines').toBeGreaterThan(2);
	// No line runs past the cell, and the first is not left far longer than the rest.
	expect(Math.max(...g.lines)).toBeLessThanOrEqual(g.cellW);
	expect(g.lines[0]!, 'the first line is much longer than the others').toBeLessThanOrEqual(g.lines[1]! * 1.3);
});

