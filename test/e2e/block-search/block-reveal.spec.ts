import { test, expect } from '../common/test-base';

/**
 * Showing a search hit inside a rich-table block of an open note (what revealBlock does once it has found
 * the block). The note in the fixture opens its fence on line 2.
 */
type Page = import('@playwright/test').Page;

function bigTable(rows: number, cols: number, extra = ''): string {
	const c = Array.from({ length: cols }, (_, i) => `  - { id: c_${i}, name: H${i}, width: 90 }`).join('\n');
	const r = Array.from({ length: rows }, (_, i) => `  - { id: r_${i}, cells: { ${Array.from({ length: cols }, (_, j) => `c_${j}: "v${i}-${j}"`).join(', ')} } }`).join('\n');
	return `---\nversion: 2\ncolumns:\n${c}\nrows:\n${r}\n${extra}---\n`;
}

const SMALL = `---
version: 2
title: Plan
columns:
  - { id: c_a, name: Item, width: 100 }
  - { id: c_b, name: Secret, hidden: true }
  - { id: c_c, name: Qty, width: 100 }
rows:
  - { id: r_1, cells: { c_a: zed, c_b: hid, c_c: "3" } }
  - { id: r_2, cells: { c_a: amy, c_b: hid2, c_c: "1" } }
sort: { colId: c_a, dir: asc }
footer: end note
---
`;
const BOOK = `---
version: 3
active_sheet: s_1
sheets:
  - id: s_1
    name: First
    columns: [ { id: c_a, name: Item } ]
    rows: [ { id: r_1, cells: { c_a: one } } ]
  - id: s_2
    name: Second
    columns: [ { id: c_a, name: Item } ]
    rows: [ { id: r_9, cells: { c_a: two } } ]
    title: Second title
---
`;
const cell = (anchor: { rowId: string; colId: string; sheetId?: string }) => ({ kind: 'cell', ...anchor });
const q = { query: 'x' };

/** The cell's rect lies inside the part of the scroll container that the frozen cells leave uncovered. */
async function visibleOutsideFrozen(page: Page, text: string): Promise<boolean> {
	return page.evaluate((text) => {
		const w = document.querySelector('.bt-table-wrapper:not(#wrapper)') as HTMLElement;
		const cell = Array.from(w.querySelectorAll('td, th')).find(c => c.textContent === text) as HTMLElement;
		const c = cell.getBoundingClientRect();
		const port = w.getBoundingClientRect();
		let fl = port.left, ft = port.top;
		w.querySelectorAll('.bt-frozen-col').forEach(e => { fl = Math.max(fl, e.getBoundingClientRect().right); });
		w.querySelectorAll('.bt-frozen-row').forEach(e => { ft = Math.max(ft, e.getBoundingClientRect().bottom); });
		return c.left >= fl - 1 && c.top >= ft - 1 && c.right <= port.right + 1 && c.bottom <= port.bottom + 1;
	}, text);
}

test.describe('finding the block for a fence line', () => {
	test('the block that opens on that line is found, another line is not', async ({ renderBlock }) => {
		const block = await renderBlock(SMALL);
		expect(await block.blockAtLine(2)).toBe(true);
		expect(await block.blockAtLine(0)).toBe(false);
		expect(await block.blockAtLine(3)).toBe(false);
	});

	test('the same line of another note is not that block', async ({ renderBlock }) => {
		const block = await renderBlock(SMALL);
		expect(await block.blockAtLine(2, 'other.md')).toBe(false);
	});
});

test.describe('revealing a hit in a block', () => {
	test('a cell is found by its ids, not by the place the sort gave its row', { tag: '@geometry' }, async ({ page, renderBlock }) => {
		await page.setViewportSize({ width: 700, height: 300 });
		// Sorted high to low, the stored first row r_0 is the last one on screen, far below the visible part.
		const block = await renderBlock(bigTable(80, 3, 'sort: { colId: c_0, dir: desc }\nviewHeight: 160\n'));
		const wrapper = page.locator('.bt-table-wrapper:not(#wrapper)');
		expect(await wrapper.evaluate(el => el.scrollTop)).toBe(0);
		expect(await block.revealHit(cell({ rowId: 'r_0', colId: 'c_1' }), q)).toBe(true);
		expect(await visibleOutsideFrozen(page, 'v0-1')).toBe(true);
		expect(await wrapper.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
	});

	test('a column name, the title and the footer can be revealed', async ({ renderBlock }) => {
		const block = await renderBlock(SMALL);
		expect(await block.revealHit({ kind: 'header', colId: 'c_c' }, q)).toBe(true);
		expect(await block.revealHit({ kind: 'title' }, q)).toBe(true);
		expect(await block.revealHit({ kind: 'footer', line: 0 }, q)).toBe(true);
	});

	test('a hit that is gone gives false and changes nothing', async ({ page, renderBlock }) => {
		const block = await renderBlock(SMALL);
		const before = await page.locator('.bt-render-root').first().innerHTML();
		for (const anchor of [
			cell({ rowId: 'r_404', colId: 'c_a' }), cell({ rowId: 'r_1', colId: 'c_404' }),
			{ kind: 'header', colId: 'c_404' }, { kind: 'footer', line: 5 },
			cell({ rowId: 'r_1', colId: 'c_a', sheetId: 's_1' }),
			{ kind: 'sheet', sheetId: 's_1' },
		]) expect(await block.revealHit(anchor, q), JSON.stringify(anchor)).toBe(false);
		expect(await page.locator('.bt-render-root').first().innerHTML()).toBe(before);
	});

	test('a cell in a hidden column cannot be shown, so it answers false', async ({ renderBlock }) => {
		const block = await renderBlock(SMALL);
		expect(await block.revealHit(cell({ rowId: 'r_1', colId: 'c_b' }), q)).toBe(false);
	});

	test('a collapsed table has no body to show, so it answers false', async ({ renderBlock }) => {
		const block = await renderBlock(SMALL.replace('footer: end note', 'collapsed: true'));
		expect(await block.revealHit(cell({ rowId: 'r_1', colId: 'c_a' }), q)).toBe(false);
	});

	test('a hit far down and right scrolls into view clear of the frozen rows and columns, from either side', { tag: '@geometry' }, async ({ page, renderBlock }) => {
		await page.setViewportSize({ width: 700, height: 420 });
		const block = await renderBlock(bigTable(80, 30, 'freezeRows: 1\nfreezeCols: 2\nviewHeight: 240\nviewWidth: 520\n'));
		expect(await block.revealHit(cell({ rowId: 'r_70', colId: 'c_25' }), q)).toBe(true);
		expect(await visibleOutsideFrozen(page, 'v70-25')).toBe(true);
		// And back to the top left, which the browser's own scrollIntoView leaves under the frozen band.
		expect(await block.revealHit(cell({ rowId: 'r_3', colId: 'c_3' }), q)).toBe(true);
		expect(await visibleOutsideFrozen(page, 'v3-3')).toBe(true);
	});
});

test.describe('revealing a hit on another sheet of a workbook', () => {
	test('switches to the sheet for the view only, without writing the note', async ({ page, renderBlock }) => {
		const block = await renderBlock(BOOK);
		const before = await block.noteText();
		expect(await block.revealHit(cell({ sheetId: 's_2', rowId: 'r_9', colId: 'c_a' }), q)).toBe(true);
		await expect(page.locator('.bt-sheet-tab-active')).toHaveText('Second');
		await expect(page.locator('.bt-td', { hasText: 'two' })).toBeVisible();
		expect(await block.noteText()).toBe(before);
	});

	test('the sheet stays chosen when the block is redrawn in place', async ({ page, renderBlock }) => {
		const block = await renderBlock(BOOK);
		await block.revealHit(cell({ sheetId: 's_2', rowId: 'r_9', colId: 'c_a' }), q);
		await block.changeSettingsAndRefresh({});
		await expect(page.locator('.bt-sheet-tab-active')).toHaveText('Second');
	});

	test('a sheet name and a sheet\'s title can be revealed', async ({ page, renderBlock }) => {
		const block = await renderBlock(BOOK);
		expect(await block.revealHit({ kind: 'sheet', sheetId: 's_2' }, q)).toBe(true);
		expect(await block.revealHit({ kind: 'title', sheetId: 's_2' }, q)).toBe(true);
		await expect(page.locator('.bt-sheet-tab-active')).toHaveText('Second');
	});

	test('a sheet that is no longer there gives false and keeps the sheet that was shown', async ({ page, renderBlock }) => {
		const block = await renderBlock(BOOK);
		expect(await block.revealHit(cell({ sheetId: 's_404', rowId: 'r_1', colId: 'c_a' }), q)).toBe(false);
		await expect(page.locator('.bt-sheet-tab-active')).toHaveText('First');
	});

	test('a hit for a workbook sheet sent to a single-sheet table gives false', async ({ renderBlock }) => {
		const block = await renderBlock(SMALL);
		expect(await block.revealHit(cell({ sheetId: 's_2', rowId: 'r_1', colId: 'c_a' }), q)).toBe(false);
	});

	test('after one block is revealed, the other blocks of the note still follow the panel', async ({ page, renderBlock }) => {
		const block = await renderBlock(BOOK, { searchHost: 'panel', initialQuery: { query: 'one' } });
		// A second block in the same page, drawn from the same source.
		await page.evaluate(() => { (window as unknown as { __btMount: () => void }).__btMount(); });
		await expect(page.locator('.bt-table-wrapper:not(#wrapper)')).toHaveCount(2);
		await expect.poll(() => block.hits()).toEqual(['one', 'one']);
		// Reveal a hit on the other sheet of the block mounted last; the first block must not be touched by it.
		expect(await block.revealHit(cell({ sheetId: 's_2', rowId: 'r_9', colId: 'c_a' }), { query: 'two' })).toBe(true);
		await expect(page.locator('.bt-sheet-tab-active').nth(1)).toHaveText('Second');
		await expect(page.locator('.bt-sheet-tab-active').first()).toHaveText('First');
		// The panel moves on: both blocks follow, each on the sheet it is showing.
		await block.setQuery({ query: 'two' });
		await expect.poll(() => block.hits()).toEqual(['two']);
		await block.setQuery({ query: 'one' });
		await expect.poll(() => block.hits()).toEqual(['one']);
		await block.setQuery(null);
		await expect.poll(() => block.hits()).toEqual([]);
	});
});

test.describe('revealing a hit with a Rich Search that cannot say when a search ends', () => {
	test('marks the matches of the hit and keeps them, since nothing will say when to stop', async ({ renderBlock }) => {
		const block = await renderBlock(SMALL, { searchHost: 'legacy' });
		expect(await block.hits()).toEqual([]);
		expect(await block.revealHit(cell({ rowId: 'r_1', colId: 'c_a' }), { query: 'zed' })).toBe(true);
		expect(await block.hits()).toEqual(['zed']);
		await block.setQuery(null);
		await new Promise(r => setTimeout(r, 300));
		expect(await block.hits()).toEqual(['zed']);
	});

	test('with a panel that can say, the hit\'s own query is not used for marking', async ({ renderBlock }) => {
		const block = await renderBlock(SMALL, { searchHost: 'panel' });
		expect(await block.revealHit(cell({ rowId: 'r_1', colId: 'c_a' }), { query: 'zed' })).toBe(true);
		expect(await block.hits()).toEqual([]);
	});
});

test.describe('waiting for a block that a note has not built yet', () => {
	test('finds a block that is mounted a little after the wait begins', async ({ page, renderBlock }) => {
		await renderBlock(SMALL);
		const found = await page.evaluate(async () => {
			const R = (window as any).RichTableReal;
			const w = window as unknown as { __btBlock: { unload(): void }; __btMount: () => void; __btNote: string };
			w.__btBlock.unload();
			document.getElementById('root')!.replaceChildren();
			const waiting = R.waitForBlockAt(w.__btNote, 2, document.body, () => true);
			await new Promise(r => setTimeout(r, 150));
			w.__btMount();
			const out = await waiting;
			return out ? { found: true, spent: R.BLOCK_WAIT_FRAMES - out.framesLeft } : { found: false, spent: 0 };
		});
		expect(found.found).toBe(true);
		expect(found.spent).toBeGreaterThan(1);
	});

	test('finds a block whose position in the note is unknown at first, as in Reading view before it is attached', async ({ page, renderBlock }) => {
		await renderBlock(SMALL);
		const found = await page.evaluate(async () => {
			const R = (window as any).RichTableReal;
			const w = window as unknown as { __btBlock: { unload(): void }; __btMount: () => void; __btNote: string; __btSectionNull: boolean };
			w.__btBlock.unload();
			document.getElementById('root')!.replaceChildren();
			w.__btSectionNull = true;
			w.__btMount();
			const waiting = R.waitForBlockAt(w.__btNote, 2, document.body, () => true);
			await new Promise(r => setTimeout(r, 150));
			w.__btSectionNull = false;
			return !!(await waiting);
		});
		expect(found).toBe(true);
	});

	test('gives up after the frames it was given when there is no such block', async ({ page, renderBlock }) => {
		await renderBlock(SMALL);
		const out = await page.evaluate(async () => {
			const R = (window as any).RichTableReal;
			const w = window as unknown as { __btNote: string };
			const t0 = performance.now();
			const result = await R.waitForBlockAt(w.__btNote, 99, document.body, () => true, 8);
			return { result, ms: performance.now() - t0 };
		});
		expect(out.result).toBeNull();
		expect(out.ms).toBeLessThan(1500);
	});

	test('stops at once when the note is no longer the one on screen', async ({ page, renderBlock }) => {
		await renderBlock(SMALL);
		const out = await page.evaluate(async () => {
			const R = (window as any).RichTableReal;
			const w = window as unknown as { __btNote: string };
			let wanted = true;
			setTimeout(() => { wanted = false; }, 100);
			const t0 = performance.now();
			const result = await R.waitForBlockAt(w.__btNote, 99, document.body, () => wanted, 600);
			return { result, ms: performance.now() - t0 };
		});
		expect(out.result).toBeNull();
		expect(out.ms).toBeLessThan(1000);
	});

	test('does not wait at all when the block is already there', async ({ page, renderBlock }) => {
		await renderBlock(SMALL);
		const left = await page.evaluate(async () => {
			const R = (window as any).RichTableReal;
			const w = window as unknown as { __btNote: string };
			const out = await R.waitForBlockAt(w.__btNote, 2, document.body, () => true);
			return out ? R.BLOCK_WAIT_FRAMES - out.framesLeft : -1;
		});
		expect(left).toBe(0);
	});

	test('the frames already spent finding the block are not spent again waiting for its table', async ({ page, renderBlock }) => {
		await renderBlock(SMALL);
		const out = await page.evaluate(async () => {
			const w = window as unknown as { __btBlock: { revealSearchHit(a: unknown, q: unknown, frames: number): Promise<boolean>; isRendering: boolean } };
			// A block whose table never finishes drawing: with 3 frames left it must give up after about 3 frames, not 120.
			w.__btBlock.isRendering = true;
			const t0 = performance.now();
			const result = await w.__btBlock.revealSearchHit({ kind: 'title' }, { query: 'x' }, 3);
			return { result, ms: performance.now() - t0 };
		});
		expect(out.result).toBe(false);
		expect(out.ms).toBeLessThan(500);
	});

});

test.describe('the same note open in two places', () => {
	/** Two containers, as two tabs or Reading view next to an editing view are, each holding its own block on the same fence line. */
	const twoViews = async (page: Page) => page.evaluate(() => {
		const w = window as unknown as { __btMount: (into?: HTMLElement) => HTMLElement; __btBlock: unknown };
		const root = document.getElementById('root')!;
		root.replaceChildren();
		const first = root.createDiv({ cls: 'view-a' });
		const second = root.createDiv({ cls: 'view-b' });
		w.__btMount(first);
		w.__btMount(second);
		return true;
	});
	const activeIn = (page: Page, view: 'view-a' | 'view-b') => page.locator(`.${view} .bt-sheet-tab-active`);

	test('a block is looked for inside the view that asked, not anywhere in the app', async ({ page, renderBlock }) => {
		await renderBlock(BOOK);
		await twoViews(page);
		const found = await page.evaluate(() => {
			const R = (window as any).RichTableReal;
			const w = window as unknown as { __btNote: string };
			const a = document.querySelector('.view-a') as HTMLElement;
			const b = document.querySelector('.view-b') as HTMLElement;
			const inA = R.findBlockAt(w.__btNote, 2, a);
			const inB = R.findBlockAt(w.__btNote, 2, b);
			const elsewhere = R.findBlockAt(w.__btNote, 2, document.createElement('div'));
			return {
				a: !!inA && a.contains(inA.containerEl), b: !!inB && b.contains(inB.containerEl),
				different: inA !== inB, elsewhere: elsewhere === null,
			};
		});
		expect(found).toEqual({ a: true, b: true, different: true, elsewhere: true });
	});

	test('showing a hit switches the sheet in the view that was asked, and leaves the other view alone', async ({ page, renderBlock }) => {
		await renderBlock(BOOK);
		await twoViews(page);
		await expect(activeIn(page, 'view-a')).toHaveText('First');
		await expect(activeIn(page, 'view-b')).toHaveText('First');
		// Ask in the second view, whose block was mounted last and so is the one the old lookup would not pick.
		const shown = await page.evaluate(async () => {
			const R = (window as any).RichTableReal;
			const w = window as unknown as { __btNote: string };
			const b = document.querySelector('.view-b') as HTMLElement;
			const found = await R.waitForBlockAt(w.__btNote, 2, b, () => true);
			return found.block.revealSearchHit({ kind: 'cell', sheetId: 's_2', rowId: 'r_9', colId: 'c_a' }, { query: 'x' }, found.framesLeft);
		});
		expect(shown).toBe(true);
		await expect(activeIn(page, 'view-b')).toHaveText('Second');
		await expect(activeIn(page, 'view-a')).toHaveText('First');
	});

	test('asking in the first view switches that one, not the later one', async ({ page, renderBlock }) => {
		await renderBlock(BOOK);
		await twoViews(page);
		const shown = await page.evaluate(async () => {
			const R = (window as any).RichTableReal;
			const w = window as unknown as { __btNote: string };
			const a = document.querySelector('.view-a') as HTMLElement;
			const found = await R.waitForBlockAt(w.__btNote, 2, a, () => true);
			return found.block.revealSearchHit({ kind: 'cell', sheetId: 's_2', rowId: 'r_9', colId: 'c_a' }, { query: 'x' }, found.framesLeft);
		});
		expect(shown).toBe(true);
		await expect(activeIn(page, 'view-a')).toHaveText('Second');
		await expect(activeIn(page, 'view-b')).toHaveText('First');
	});

	test('a view that holds no such block gets no answer, rather than another view\'s block', async ({ page, renderBlock }) => {
		await renderBlock(BOOK);
		const out = await page.evaluate(async () => {
			const R = (window as any).RichTableReal;
			const w = window as unknown as { __btNote: string };
			const empty = document.createElement('div');
			document.body.appendChild(empty);
			return await R.waitForBlockAt(w.__btNote, 2, empty, () => true, 5);
		});
		expect(out).toBeNull();
	});

});

test.describe('a block that the page has replaced but not yet dropped', () => {
	/**
	 * Reading view builds a block again when a note is opened over itself, and the old one can still be
	 * attached for a while, with no size. The hit has to go to the one that is on screen.
	 */
	const staleThenFresh = async (page: Page) => page.evaluate(() => {
		const w = window as unknown as { __btMount: (into?: HTMLElement) => HTMLElement };
		const root = document.getElementById('root')!;
		root.replaceChildren();
		const stale = root.createDiv({ cls: 'stale' });
		const fresh = root.createDiv({ cls: 'fresh' });
		w.__btMount(stale);
		stale.style.display = 'none';
		w.__btMount(fresh);
	});
	const tab = (page: Page, which: 'stale' | 'fresh') => page.locator(`.${which} .bt-sheet-tab-active`);
	const reveal = (page: Page) => page.evaluate(async () => {
		const R = (window as any).RichTableReal;
		const w = window as unknown as { __btNote: string };
		const found = await R.waitForBlockAt(w.__btNote, 2, document.body, () => true);
		return found.block.revealSearchHit({ kind: 'cell', sheetId: 's_2', rowId: 'r_9', colId: 'c_a' }, { query: 'x' }, found.framesLeft);
	});

	test('the hit goes to the block that is shown, not to the older one without a size', async ({ page, renderBlock }) => {
		await renderBlock(BOOK);
		await staleThenFresh(page);
		expect(await reveal(page)).toBe(true);
		await expect(tab(page, 'fresh')).toHaveText('Second');
		await expect(page.locator('.stale').locator('.bt-sheet-tab-active')).toHaveText('First', { useInnerText: false });
	});

	test('with the shown block mounted first and a hidden one after it, the shown one is still chosen', async ({ page, renderBlock }) => {
		await renderBlock(BOOK);
		await page.evaluate(() => {
			const w = window as unknown as { __btMount: (into?: HTMLElement) => HTMLElement };
			const root = document.getElementById('root')!;
			root.replaceChildren();
			const shown = root.createDiv({ cls: 'fresh' });
			const hidden = root.createDiv({ cls: 'stale' });
			w.__btMount(shown);
			w.__btMount(hidden);
			hidden.style.display = 'none';
		});
		expect(await reveal(page)).toBe(true);
		await expect(tab(page, 'fresh')).toHaveText('Second');
	});

	test('when no block has a size yet, the most recently built one is used', async ({ page, renderBlock }) => {
		await renderBlock(BOOK);
		await page.evaluate(() => {
			const w = window as unknown as { __btMount: (into?: HTMLElement) => HTMLElement };
			const root = document.getElementById('root')!;
			root.replaceChildren();
			const older = root.createDiv({ cls: 'stale' });
			const newer = root.createDiv({ cls: 'fresh' });
			w.__btMount(older);
			w.__btMount(newer);
			older.style.display = 'none';
			newer.style.display = 'none';
		});
		expect(await reveal(page)).toBe(true);
		await expect(page.locator('.fresh .bt-sheet-tab-active')).toHaveText('Second', { useInnerText: false });
	});

	test('a block that is laid out a moment later is waited for, rather than settling for one without a size', { tag: '@geometry' }, async ({ page, renderBlock }) => {
		await renderBlock(BOOK);
		const out = await page.evaluate(async () => {
			const R = (window as any).RichTableReal;
			const w = window as unknown as { __btMount: (into?: HTMLElement) => HTMLElement; __btNote: string };
			const root = document.getElementById('root')!;
			root.replaceChildren();
			const late = root.createDiv({ cls: 'late' });
			w.__btMount(late);
			late.style.display = 'none';
			setTimeout(() => { late.style.display = ''; }, 150);
			const found = await R.waitForBlockAt(w.__btNote, 2, document.body, () => true);
			return { found: !!found, shown: !!found && found.block.containerEl.getClientRects().length > 0, spent: found ? R.BLOCK_WAIT_FRAMES - found.framesLeft : -1 };
		});
		expect(out.found).toBe(true);
		expect(out.shown).toBe(true);
		expect(out.spent).toBeGreaterThan(1);
	});

	test('a block that is never shown is still answered with, on the last frame', async ({ page, renderBlock }) => {
		await renderBlock(BOOK);
		const out = await page.evaluate(async () => {
			const R = (window as any).RichTableReal;
			const w = window as unknown as { __btMount: (into?: HTMLElement) => HTMLElement; __btNote: string };
			const root = document.getElementById('root')!;
			root.replaceChildren();
			const hidden = root.createDiv();
			w.__btMount(hidden);
			hidden.style.display = 'none';
			const found = await R.waitForBlockAt(w.__btNote, 2, document.body, () => true, 6);
			return found ? { framesLeft: found.framesLeft } : null;
		});
		expect(out).toEqual({ framesLeft: 1 });
	});

	test('looking a block up prefers the shown one even when a newer one without a size exists', async ({ page, renderBlock }) => {
		await renderBlock(BOOK);
		const out = await page.evaluate(() => {
			const R = (window as any).RichTableReal;
			const w = window as unknown as { __btMount: (into?: HTMLElement) => HTMLElement; __btNote: string };
			const root = document.getElementById('root')!;
			root.replaceChildren();
			const shown = root.createDiv({ cls: 'shown' });
			const newerHidden = root.createDiv({ cls: 'newer' });
			w.__btMount(shown);
			w.__btMount(newerHidden);
			newerHidden.style.display = 'none';
			const picked = R.findBlockAt(w.__btNote, 2, document.body);
			return picked.containerEl.parentElement.className;
		});
		expect(out).toBe('shown');
	});
});
