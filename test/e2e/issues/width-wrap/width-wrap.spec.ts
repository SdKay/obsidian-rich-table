import type { Page } from '@playwright/test';
import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Width and wrapping are two settings of a column. A column with a width keeps it; one without is sized by the
// browser. A column that wraps (the default) folds its text; one without a width then shares out the room the view
// leaves, down to its longest word. A column that does not wrap stays on one line.
const LONG = 'a fairly long sentence that goes on and on and on with plenty of ordinary words to break between';
const URL = 'https://example.com/a/very/long/path/without/any/spaces/at/all/for/testing/the/cell';

const view = (page: Page) => page.evaluate(() => {
	const w = document.querySelector('.bt-table-wrapper') as HTMLElement;
	return { viewW: w.clientWidth, scrollW: w.scrollWidth, scrolls: w.scrollWidth > w.clientWidth + 1 };
});
const cellBox = (page: Page, row: number, col: number) => page.locator(`[data-row="${row}"][data-col="${col}"]`)
	.evaluate(el => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }));
/** How many lines a cell's text takes: a row is as tall as its tallest cell, so the cell's own height says little. */
const lines = (page: Page, row: number, col: number) => page.locator(`[data-row="${row}"][data-col="${col}"]`).evaluate(el => {
	const r = document.createRange();
	r.selectNodeContents(el.querySelector('p') ?? el);
	return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size;
});

test('long text in an auto column wraps inside the pane instead of scrolling', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [0, 0], rows: [{ 0: 'x', 1: Array(6).fill(LONG).join(' ') }] }));
	const v = await view(page);
	expect(v.scrolls).toBe(false);
	expect(await lines(page, 1, 1), 'the text should fold onto several lines').toBeGreaterThan(2);
});

test('an auto column that does not wrap keeps its text on one line, and the view scrolls', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [0, 0], wraps: [undefined, false], rows: [{ 0: 'x', 1: `${LONG} ${LONG} ${LONG}` }] }));
	expect((await view(page)).scrolls).toBe(true);
	expect(await lines(page, 1, 1)).toBe(1);
});

test('a table-wide wrap: false applies to every column, and a column of its own overrides it', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [0, 0], wraps: [true, undefined], rows: [{ 0: `${LONG} ${LONG}`, 1: `${LONG} ${LONG}` }] })
		.replace('version: 2\n', 'version: 2\nwrap: false\n'));
	expect(await lines(page, 1, 1), 'the table says: no wrap').toBe(1);
	expect(await lines(page, 1, 0), 'the column says: wrap').toBeGreaterThan(1);
});

test('a column with a width keeps it against text that cannot wrap', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [100, 0], rows: [{ 0: URL, 1: 'y' }] }));
	expect((await cellBox(page, 1, 0)).w).toBeCloseTo(100, 0);
	expect((await cellBox(page, 0, 0)).w).toBeCloseTo(100, 0);
});

test('a column with a width that does not wrap stays on one line, cut off at its width', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [100, 0], wraps: [false], rows: [{ 0: LONG, 1: 'y' }] }));
	expect((await cellBox(page, 1, 0)).w).toBeCloseTo(100, 0);
	expect(await lines(page, 1, 0)).toBe(1);
	// The text runs past the paragraph, which cuts it off with an ellipsis rather than letting it spill out.
	const p = await page.locator('[data-row="1"][data-col="0"] p').evaluate(el => {
		const cs = getComputedStyle(el);
		return { cut: el.scrollWidth > el.clientWidth, overflow: cs.overflowX, ellipsis: cs.textOverflow, w: el.getBoundingClientRect().width };
	});
	expect(p).toMatchObject({ cut: true, overflow: 'hidden', ellipsis: 'ellipsis' });
	expect(p.w).toBeLessThanOrEqual(100);
});

test('two auto columns share the room a fixed column leaves, and the fixed column keeps its width', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [120, 0, 0], rows: [{ 0: 'fixed', 1: `${LONG} ${LONG}`, 2: `${LONG} ${LONG} ${LONG}` }], viewWidth: 600 }));
	expect((await view(page)).scrolls).toBe(false);
	expect((await cellBox(page, 1, 0)).w).toBeCloseTo(120, 0);
	const a = await cellBox(page, 1, 1), b = await cellBox(page, 1, 2);
	expect(a.w).toBeGreaterThan(60);
	expect(b.w, 'the column with more text gets more of the room').toBeGreaterThan(a.w);
});

test('a view with a width of its own is the room the auto columns share', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [0, 0], rows: [{ 0: LONG, 1: LONG }], viewWidth: 300 }));
	const v = await view(page);
	expect(v.viewW).toBeLessThanOrEqual(300);
	expect(v.scrolls).toBe(false);
});

test('a cell merged across a fixed and an auto column leaves the fixed column its width', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [100, 0, 60], rows: [{ 0: `${LONG} ${URL}`, 2: 'z' }, { 0: 'a', 1: 'b', 2: 'c' }], merges: [[0, 0, 0, 1]], viewWidth: 500 }));
	expect((await cellBox(page, 2, 0)).w).toBeCloseTo(100, 0);
	expect((await cellBox(page, 2, 2)).w).toBeCloseTo(60, 0);
});

test('a cell merged across two fixed columns is as wide as both, whatever it holds', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [100, 60, 0], rows: [{ 0: URL, 2: 'z' }, { 0: 'a', 1: 'b', 2: 'c' }], merges: [[0, 0, 0, 1]] }));
	expect((await cellBox(page, 1, 0)).w).toBeCloseTo(160, 0);
	expect((await cellBox(page, 2, 0)).w).toBeCloseTo(100, 0);
	expect((await cellBox(page, 2, 1)).w).toBeCloseTo(60, 0);
});

test('text a column cannot wrap still scrolls the view, and the add-column button stays in it', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [0, 0], rows: [{ 0: URL + URL, 1: URL + URL }], viewWidth: 300 }));
	expect((await view(page)).scrolls).toBe(true);
	await page.locator('table.bt-table').hover();
	await page.evaluate(() => { const w = document.querySelector('.bt-table-wrapper') as HTMLElement; w.scrollLeft = w.scrollWidth; });
	const inside = await page.evaluate(() => {
		const w = (document.querySelector('.bt-table-wrapper') as HTMLElement).getBoundingClientRect();
		const b = (document.querySelector('.bt-edge-add-col') as HTMLElement).getBoundingClientRect();
		return b.width > 0 && b.left >= w.left - 1 && b.right <= w.right + 1;
	});
	expect(inside).toBe(true);
});

test('a short table hugs its content in a wide view and stays centred', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [0, 0], rows: [{ 0: 'a', 1: 'b' }], viewWidth: 800 }));
	const g = await page.evaluate(() => {
		const w = (document.querySelector('.bt-table-wrapper') as HTMLElement).getBoundingClientRect();
		const t = (document.querySelector('table.bt-table') as HTMLElement).getBoundingClientRect();
		return { tableW: t.width, left: t.left - w.left, right: w.right - t.right };
	});
	expect(g.tableW).toBeLessThan(300);
	expect(Math.abs(g.left - g.right), 'the gaps either side').toBeLessThan(80);
});

// Obsidian's own table rules are more specific than one class; the width and wrap rules must still hold.
test("Obsidian's own table rules do not undo the column's width or wrapping", { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [100, 0], rows: [{ 0: URL, 1: `${LONG} ${LONG} ${LONG}` }] }));
	await page.addStyleTag({ content: '.markdown-rendered table td, .markdown-preview-view table td { white-space: nowrap; max-width: none; min-width: 0; overflow-wrap: normal; }' });
	expect((await cellBox(page, 1, 0)).w).toBeCloseTo(100, 0);
	expect((await view(page)).scrolls).toBe(false);
});

test.describe('the column menu', () => {
	test('turning wrapping off for a column writes wrap: false, and turning it back on clears it', async ({ page, renderBlock }) => {
		const b = await renderBlock(tableSource({ widths: [0, 0], rows: [{ 0: 'x', 1: 'y' }] }));
		const pick = async (label: string) => {
			await page.locator('table.bt-table').hover();
			await page.locator('.bt-col-selector .bt-sel-cell').nth(1).click();
			await page.locator('.bt-cp-item', { hasText: label }).click();
		};
		await pick("Don't wrap text");
		await expect.poll(() => b.noteText()).toContain('wrap: false');
		await b.reprocess();
		await pick('Wrap text');
		await expect.poll(() => b.noteText()).not.toContain('wrap:');
	});
});

// The block a new tasks table starts as (buildTasksBlock): text columns without a width, marks and dates with one.
const NEW_TASKS_BLOCK = `---
version: 2
tasks:
  query: |
    not done
columns:
  - { id: c_s, name: Status, field: status, width: 40 }
  - { id: c_b, name: Task, field: body, align: left }
  - { id: c_d, name: Due, field: due, width: 100 }
  - { id: c_p, name: Priority, field: priority, width: 70 }
  - { id: c_t, name: Tags, field: tags, align: left }
  - { id: c_f, name: File, field: file, align: left }
---
`;

test('a new tasks table keeps long tasks inside the note pane', { tag: '@geometry' }, async ({ page, renderBlock }) => {
	await renderBlock(NEW_TASKS_BLOCK, { tasksFrom: { 'notes/a.md': `- [ ] ${LONG} ${LONG} ${LONG} 📅 2026-12-01 #work\n- [ ] short one` } });
	await expect(page.locator('td.bt-td', { hasText: 'short one' })).toHaveCount(1);
	const g = await page.evaluate(() => {
		const w = document.querySelector('.bt-table-wrapper') as HTMLElement;
		const pane = w.closest('.markdown-preview-view') as HTMLElement | null;
		const status = document.querySelector('td.bt-td[data-col="0"]') as HTMLElement;
		return { scrollW: w.scrollWidth, viewW: w.clientWidth, paneW: pane?.clientWidth ?? 0, statusW: status.getBoundingClientRect().width };
	});
	expect(g.scrollW, 'the table scrolls sideways').toBeLessThanOrEqual(g.viewW + 1);
	expect(g.statusW).toBeCloseTo(40, 0);
});

test.describe('dragging a column', () => {
	const SRC = tableSource({ widths: [100, 0], rows: [{ 0: 'x', 1: `${LONG} ${LONG} ${LONG}` }], viewWidth: 500 });
	const dispatch = (page: Page, type: string, x: number) => page.locator('.bt-sel-resize-col').first().evaluate((el, [t, cx]) => {
		el.dispatchEvent(new PointerEvent(t as string, { button: 0, pointerId: 1, clientX: cx as number, clientY: 10, bubbles: true, cancelable: true }));
	}, [type, x] as const);
	const widths = (page: Page) => page.evaluate(() => [...document.querySelectorAll('col')].map(c => Math.round(c.getBoundingClientRect().width)));

	test('the other columns keep still while a column is dragged', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(SRC);
		await page.locator('table.bt-table').hover();
		const before = await widths(page);
		await dispatch(page, 'pointerdown', 300);
		await dispatch(page, 'pointermove', 340);
		const during = await widths(page);
		expect(during[0]).toBe(before[0]! + 40);
		expect(during[1], 'the auto column did not give way to the dragged one').toBe(before[1]);
		await dispatch(page, 'pointerup', 340);
		const ops = await page.evaluate(() => (window as unknown as { __btOps: { type: string; width?: number }[] }).__btOps);
		expect(ops).toEqual([{ type: 'set-col-width', colId: 'c_0', width: 140 }]);
	});

	test('a press on the handle that does not move leaves the table laid out as before', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(SRC);
		await page.locator('table.bt-table').hover();
		await dispatch(page, 'pointerdown', 300);
		await dispatch(page, 'pointerup', 300);
		const after = await page.evaluate(() => {
			const t = document.querySelector('table.bt-table') as HTMLElement;
			return { frozen: t.classList.contains('bt-cols-frozen'), tableWidth: t.style.width, colWidths: [...t.querySelectorAll('col')].map(c => (c as HTMLElement).style.width) };
		});
		expect(after).toEqual({ frozen: false, tableWidth: '', colWidths: ['', ''] });
		// And the auto column still follows the view.
		await page.evaluate(() => { const w = document.querySelector('.bt-table-wrapper') as HTMLElement; w.style.setProperty('--bt-view-width', '350px'); });
		expect((await view(page)).scrolls).toBe(false);
	});
});

test.describe('the table-wide setting', () => {
	const menu = (page: Page) => page.locator('.bt-ctrl-btn[aria-label="View settings"]').click();
	const entry = (page: Page) => page.evaluate(() => window.RichTableReal.ShimMenu.opened.at(-1)!.items.find(i => i.title === 'Wrap text')?.checked);
	const click = (page: Page) => page.evaluate(() => window.RichTableReal.ShimMenu.opened.at(-1)!.clickItem('Wrap text'));
	const ops = (page: Page) => page.evaluate(() => window.__btOps);

	test('turning it off writes wrap: false', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [0], rows: [{ 0: 'x' }] }).replace('version: 2\n', 'version: 2\nwrap: true\n'));
		await page.locator('table.bt-table').hover();
		await menu(page);
		expect(await entry(page)).toBe(true);
		await click(page);
		expect(await ops(page)).toContainEqual({ type: 'set-table-wrap', wrap: false });
	});

	test('turning it back on writes wrap: true, so the block says so', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [0], rows: [{ 0: 'x' }] }).replace('version: 2\n', 'version: 2\nwrap: false\n'));
		await page.locator('table.bt-table').hover();
		await menu(page);
		expect(await entry(page)).toBe(false);
		await click(page);
		expect(await ops(page)).toContainEqual({ type: 'set-table-wrap', wrap: true });
	});
});

test.describe('a new table says in its block that it wraps', () => {
	const inserted = (page: Page, key: string) => page.locator(`.bt-template-btn[data-preview-key="${key}"]`);
	test('a template', async ({ page, renderBlock }) => {
		const b = await renderBlock('');
		await inserted(page, 'demo').click();
		await expect.poll(() => b.noteText()).toMatch(/^wrap: true$/m);
	});
	test('a tasks table, whose columns have no width', async ({ page, renderBlock }) => {
		const b = await renderBlock('');
		await inserted(page, 'tasks').click();
		await expect.poll(() => b.noteText()).toMatch(/^wrap: true$/m);
		expect(await b.noteText()).not.toContain('width:');
	});
});
