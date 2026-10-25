import { test, expect } from '../common/test-base';

/**
 * The tables in a note mark the matches of the search panel, as the .xlsx tab does (contract 5.8):
 * as long as the panel holds a query, on the sheet shown, and never written into the note.
 */
const TABLE = `---
version: 2
title: Fruit plan
columns:
  - { id: c_a, name: Item, width: 120 }
  - { id: c_b, name: Note, width: 120 }
rows:
  - { id: r_1, cells: { c_a: apple pie, c_b: x } }
  - { id: r_2, cells: { c_a: plain, c_b: Apple } }
---
`;
const BOOK = `---
version: 3
active_sheet: s_1
sheets:
  - id: s_1
    name: First
    columns: [ { id: c_a, name: Item } ]
    rows: [ { id: r_1, cells: { c_a: apple one } } ]
  - id: s_2
    name: Second
    columns: [ { id: c_a, name: Item } ]
    rows: [ { id: r_1, cells: { c_a: apple two } } ]
---
`;

test.describe('rich-table block in a note: marks follow the search panel', () => {
	test('marks every match in the block while the panel holds a query', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		expect(await block.hits()).toEqual(['apple', 'Apple']);
	});

	test('marks a match in a column name as well', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'item' } });
		expect(await block.hits()).toEqual(['Item']);
	});

	test('a new query changes the marks, and an emptied one takes them off', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await block.setQuery({ query: 'plain' });
		await expect.poll(() => block.hits()).toEqual(['plain']);
		await block.setQuery(null);
		await expect.poll(() => block.hits()).toEqual([]);
		await block.setQuery({ query: 'apple' });
		await expect.poll(() => block.hits()).toEqual(['apple', 'Apple']);
	});

	test('the options of the query reach the host\'s matching rules', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple', caseSensitive: true } });
		expect(await block.hits()).toEqual(['apple']);
	});

	test('clicking a cell and pressing Escape leave the marks in place', async ({ page, renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await page.locator('.bt-td', { hasText: 'plain' }).click();
		await page.keyboard.press('Escape');
		expect(await block.hits()).toEqual(['apple', 'Apple']);
	});

	test('the marks survive the rebuild that follows a write to the note', async ({ page, renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await block.reprocess();
		await expect(page.locator('.bt-td').first()).toBeVisible();
		await expect.poll(() => block.hits()).toEqual(['apple', 'Apple']);
	});

	test('a workbook marks only the sheet that is shown', async ({ page, renderBlock }) => {
		const block = await renderBlock(BOOK, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		expect(await block.hits()).toEqual(['apple']);
		await page.locator('.bt-sheet-tab', { hasText: 'Second' }).click();
		// Switching a sheet writes the note; Obsidian then rebuilds the block.
		await expect.poll(() => block.noteText()).toContain('active_sheet: s_2');
		await block.reprocess();
		await expect(page.locator('.bt-td', { hasText: 'apple two' })).toBeVisible();
		await expect.poll(() => block.hits()).toEqual(['apple']);
		expect(await page.locator('.bt-td', { hasText: 'apple two' }).evaluate(el => el.querySelectorAll('mark.bt-search-hit').length)).toBe(1);
	});

	test('the note\'s text is never touched by marking', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		const before = await block.noteText();
		await block.setQuery({ query: 'plain' });
		await expect.poll(() => block.hits()).toEqual(['plain']);
		expect(await block.noteText()).toBe(before);
		expect(before).not.toContain('bt-search-hit');
	});

	test('without Rich Search, or with one whose matching fails, nothing is marked and nothing breaks', async ({ page, renderBlock }) => {
		const errors: string[] = [];
		page.on('pageerror', e => errors.push(e.message));
		expect(await (await renderBlock(TABLE, { searchHost: 'none' })).hits()).toEqual([]);
		expect(await (await renderBlock(TABLE, { searchHost: 'throws', initialQuery: { query: 'apple' } })).hits()).toEqual([]);
		await expect(page.locator('.bt-td').first()).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('with a Rich Search that cannot say when a search ends, nothing is marked until a hit brings its query', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'legacy' });
		expect(await block.hits()).toEqual([]);
	});

	test('the block listens to the panel while it is shown and stops when it is unloaded', async ({ page, renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		expect(await block.panelListeners()).toBe(1);
		await page.evaluate(() => { (window as unknown as { __btBlock: { unload(): void } }).__btBlock.unload(); });
		expect(await block.panelListeners()).toBe(0);
	});

	test('several blocks share one listener on the panel', async ({ page, renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await page.evaluate(() => {
			const w = window as unknown as { __btMount: () => void };
			w.__btMount(); w.__btMount();
		});
		expect(await block.panelListeners()).toBe(1);
	});

	test('the placeholder shown while a block is rebuilt carries no marks of the old table', { tag: '@geometry' }, async ({ page, renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		expect(await block.hits()).toEqual(['apple', 'Apple']);
		// A write snapshots the live table for the placeholder; adding a row is the simplest write.
		const wrapper = page.locator('.bt-table-wrapper:not(#wrapper)');
		const box = (await wrapper.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.locator('.bt-edge-add-row').click();
		await expect.poll(async () => (await block.noteText()).match(/id: r_/g)?.length ?? 0).toBe(3);
		// Hold the rebuild open so the placeholder stays on the page long enough to look at.
		const seen = await page.evaluate(async () => {
			const R = (window as any).RichTableReal;
			const real = R.ShimMarkdownRenderer.render;
			let release!: () => void;
			const gate = new Promise<void>(r => { release = r; });
			R.ShimMarkdownRenderer.render = async (...a: unknown[]) => { await gate; return real.apply(R.ShimMarkdownRenderer, a); };
			const w = window as unknown as { __btBlock: { unload(): void }; __btMount: () => HTMLElement };
			w.__btBlock.unload();
			document.getElementById('root')!.replaceChildren();
			const container = w.__btMount();
			const out = { cells: container.querySelectorAll('.bt-td').length, marks: container.querySelectorAll('mark.bt-search-hit').length };
			release();
			R.ShimMarkdownRenderer.render = real;
			return out;
		});
		expect(seen.cells).toBeGreaterThan(0);
		expect(seen.marks).toBe(0);
	});

	test('a table nested in a cell is left for its own block: the outer block neither counts nor marks its cells', async ({ page, renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel' });
		// A cell holding another rich-table renders a second .bt-render-root with its own table; build that shape by hand.
		await page.evaluate(() => {
			const cell = Array.from(document.querySelectorAll('.bt-td')).find(td => td.textContent === 'plain') as HTMLElement;
			cell.innerHTML = 'outer <div class="bt-render-root"><table class="bt-table"><tbody><tr><td data-row="1" data-col="0">inner apple</td></tr></tbody></table></div> apple';
		});
		await block.setQuery({ query: 'apple' });
		// Document order: row 1 "apple pie", the rewritten cell's own "apple", then row 2's "Apple". Not "inner apple".
		await expect.poll(() => block.hits()).toEqual(['apple', 'apple', 'Apple']);
		const inner = await page.evaluate(() => document.querySelectorAll('td .bt-render-root mark.bt-search-hit').length);
		expect(inner).toBe(0);
	});

	test('a mark in a table in a note has the colour the user chose, dimmed, and at full strength when it is the opened one', { tag: '@geometry' }, async ({ page, renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await block.openHit({ path: 'note.md', line: 2, index: 0, block: { fromLine: 2, anchor: { kind: 'cell', rowId: 'r_1', colId: 'c_a' } } });
		await page.evaluate(() => {
			document.body.style.setProperty('--rs-match-bg', 'rgb(10, 20, 30)');
			document.body.style.setProperty('--rs-match-fg', 'rgb(250, 240, 230)');
		});
		const read = (sel: string) => page.evaluate((sel) => { const m = getComputedStyle(document.querySelector(sel)!); return { bg: m.backgroundColor, fg: m.color, ring: m.boxShadow }; }, sel);
		const bright = await read('mark.bt-search-hit-active');
		expect(bright.bg).toBe('rgb(10, 20, 30)');
		expect(bright.fg).toBe('rgb(250, 240, 230)');
		expect(bright.ring).toContain('rgb(250, 240, 230)');
		const dim = await read('mark.bt-search-hit:not(.bt-search-hit-active)');
		expect(dim.bg).not.toBe('rgb(10, 20, 30)');
		expect(dim.bg).toContain('0.45');
		expect(dim.ring).toBe('none');
		expect(await block.hits()).toEqual(['apple', 'Apple']);
	});

});

test.describe('rich-table block in a note: the opened match is brighter (contract 5.10)', () => {
	const PATH = 'note.md';
	const open = (anchor: unknown, over: { path?: string; fromLine?: number } = {}) =>
		({ path: over.path ?? PATH, line: over.fromLine ?? 2, index: 0, block: { fromLine: over.fromLine ?? 2, anchor } });
	const cellA = { kind: 'cell', rowId: 'r_1', colId: 'c_a' };

	test('with nothing opened every match is dimmed', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		expect(await block.hits()).toEqual(['apple', 'Apple']);
		expect(await block.brightMarks()).toEqual([]);
	});

	test('the opened match is bright and the others stay dimmed', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await block.openHit(open(cellA));
		expect(await block.hits()).toEqual(['apple', 'Apple']);
		expect(await block.brightMarks()).toEqual(['apple']);
	});

	test('a match in a column name can be the opened one', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'item' } });
		await block.openHit(open({ kind: 'header', colId: 'c_a' }));
		expect(await block.brightMarks()).toEqual(['Item']);
	});

	test('opening another match moves the bright one without marking the text again', async ({ page, renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await block.openHit(open(cellA));
		await page.evaluate(() => {
			const w = window as unknown as { __btSwaps: number };
			w.__btSwaps = 0;
			const real = CharacterData.prototype.replaceWith;
			CharacterData.prototype.replaceWith = function (...n: (Node | string)[]) { w.__btSwaps++; return real.apply(this, n as never); };
		});
		await block.openHit(open({ kind: 'cell', rowId: 'r_2', colId: 'c_b' }));
		expect(await block.brightMarks()).toEqual(['Apple']);
		expect(await page.evaluate(() => (window as unknown as { __btSwaps: number }).__btSwaps)).toBe(0);
	});

	test('a match opened in another note brightens nothing here', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await block.openHit(open(cellA, { path: 'other.md' }));
		expect(await block.brightMarks()).toEqual([]);
	});

	test('a match opened in another block of the note brightens nothing here, even with an equal anchor', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await block.openHit(open(cellA, { fromLine: 40 }));
		expect(await block.brightMarks()).toEqual([]);
	});

	test('of two blocks only the one whose fence line is meant is bright', async ({ page, renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await page.evaluate(() => { (window as unknown as { __btMount: (i?: HTMLElement, l?: number) => void }).__btMount(undefined, 40); });
		await expect(page.locator('.bt-table-wrapper:not(#wrapper)')).toHaveCount(2);
		await block.openHit(open(cellA, { fromLine: 40 }));
		expect(await block.brightMarks()).toEqual(['apple']);
		const where = await page.evaluate(() => Array.from(document.querySelectorAll('.bt-table-wrapper:not(#wrapper)')).map(w => w.querySelectorAll('mark.bt-search-hit-active').length));
		expect(where.sort()).toEqual([0, 1]);
	});

	test('a table nested in a block is never the one a fence line points at', async ({ page, renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		// A nested block has a key that says so; give it the outer block's fence line, as Obsidian reports for it.
		await page.evaluate(() => {
			const R = (window as any).RichTableReal;
			const w = window as unknown as { __btPlugin: unknown; __btNote: string; __btBlock: { unload(): void } };
			w.__btBlock.unload();
			document.getElementById('root')!.replaceChildren();
			const container = document.getElementById('root')!.createDiv();
			const ctx = { getSectionInfo: () => ({ lineStart: 2, lineEnd: 8, text: '' }) };
			const nested = new R.TableBlock(container, '---\nversion: 2\ncolumns:\n  - { id: c_a, name: Item }\nrows:\n  - { id: r_1, cells: { c_a: apple } }\n---\n', w.__btPlugin, w.__btNote, ctx, `${w.__btNote}:2:nested-x`);
			nested.load();
		});
		await expect(page.locator('.bt-table-wrapper:not(#wrapper)')).toHaveCount(1);
		await block.openHit(open({ kind: 'cell', rowId: 'r_1', colId: 'c_a' }));
		expect(await block.brightMarks()).toEqual([]);
	});

	test('a match in a hidden column or a collapsed table has nothing to draw, so everything stays dimmed', async ({ renderBlock }) => {
		const hidden = `---\nversion: 2\ncolumns:\n  - { id: c_a, name: Item }\n  - { id: c_b, name: Secret, hidden: true }\nrows:\n  - { id: r_1, cells: { c_a: apple, c_b: apple } }\n---\n`;
		const block = await renderBlock(hidden, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await block.openHit(open({ kind: 'cell', rowId: 'r_1', colId: 'c_b' }));
		expect(await block.hits()).toEqual(['apple']);
		expect(await block.brightMarks()).toEqual([]);
		const collapsed = await renderBlock(TABLE.replace('title: Fruit plan', 'collapsed: true'), { searchHost: 'panel', initialQuery: { query: 'item' } });
		await collapsed.openHit(open({ kind: 'cell', rowId: 'r_1', colId: 'c_a' }));
		expect(await collapsed.brightMarks()).toEqual([]);
	});

	test('a title, a footer or a sheet name has no cell, so it is not drawn bright', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		for (const anchor of [{ kind: 'title' }, { kind: 'footer', line: 0 }, { kind: 'sheet', sheetId: 's_1' }]) {
			await block.openHit(open(anchor));
			expect(await block.brightMarks(), JSON.stringify(anchor)).toEqual([]);
		}
	});

	test('a match on another sheet is not bright here, and is once that sheet is shown', async ({ page, renderBlock }) => {
		const block = await renderBlock(BOOK, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await block.openHit(open({ kind: 'cell', sheetId: 's_2', rowId: 'r_1', colId: 'c_a' }));
		expect(await block.brightMarks()).toEqual([]);
		await page.locator('.bt-sheet-tab', { hasText: 'Second' }).click();
		await expect.poll(() => block.noteText()).toContain('active_sheet: s_2');
		await block.reprocess();
		await expect(page.locator('.bt-td', { hasText: 'apple two' })).toBeVisible();
		await expect.poll(() => block.brightMarks()).toEqual(['apple']);
	});

	test('an anchor that is not one of ours brightens nothing and is no error', async ({ page, renderBlock }) => {
		const errors: string[] = [];
		page.on('pageerror', e => errors.push(e.message));
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		for (const anchor of [null, undefined, 5, 'x', {}, { kind: 'cell' }, { kind: 'cell', rowId: 'r_404', colId: 'c_a' }]) {
			await block.openHit(open(anchor));
			expect(await block.brightMarks(), JSON.stringify(anchor)).toEqual([]);
		}
		expect(errors).toEqual([]);
	});

	test('a new search keeps the bright mark on the same cell when it still matches there, and drops it when it does not', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await block.openHit(open(cellA));
		await block.setQuery({ query: 'app' });
		await expect.poll(() => block.brightMarks()).toEqual(['app']);
		await block.setQuery({ query: 'plain' });
		await expect.poll(() => block.hits()).toEqual(['plain']);
		expect(await block.brightMarks()).toEqual([]);
	});

	test('clearing the opened match dims everything again', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await block.openHit(open(cellA));
		await block.openHit(null);
		expect(await block.brightMarks()).toEqual([]);
		expect(await block.hits()).toEqual(['apple', 'Apple']);
	});

	test('the bright mark survives the rebuild that follows a write', async ({ page, renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await block.openHit(open(cellA));
		await block.reprocess();
		await expect(page.locator('.bt-td').first()).toBeVisible();
		await expect.poll(() => block.brightMarks()).toEqual(['apple']);
	});

	test('the placeholder shown during a rebuild carries no bright mark either', { tag: '@geometry' }, async ({ page, renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await block.openHit(open(cellA));
		expect(await block.brightMarks()).toEqual(['apple']);
		const wrapper = page.locator('.bt-table-wrapper:not(#wrapper)');
		const box = (await wrapper.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.locator('.bt-edge-add-row').click();
		await expect.poll(async () => (await block.noteText()).match(/id: r_/g)?.length ?? 0).toBe(3);
		const seen = await page.evaluate(async () => {
			const R = (window as any).RichTableReal;
			const real = R.ShimMarkdownRenderer.render;
			let release!: () => void;
			const gate = new Promise<void>(r => { release = r; });
			R.ShimMarkdownRenderer.render = async (...a: unknown[]) => { await gate; return real.apply(R.ShimMarkdownRenderer, a); };
			const w = window as unknown as { __btBlock: { unload(): void }; __btMount: () => HTMLElement };
			w.__btBlock.unload();
			document.getElementById('root')!.replaceChildren();
			const container = w.__btMount();
			const out = { cells: container.querySelectorAll('.bt-td').length, bright: container.querySelectorAll('.bt-search-hit-active').length };
			release();
			R.ShimMarkdownRenderer.render = real;
			return out;
		});
		expect(seen.cells).toBeGreaterThan(0);
		expect(seen.bright).toBe(0);
	});

	test('a Rich Search that predates the opened match draws every match dimmed, without an error', async ({ page, renderBlock }) => {
		const errors: string[] = [];
		page.on('pageerror', e => errors.push(e.message));
		const block = await renderBlock(TABLE, { searchHost: 'noHit', initialQuery: { query: 'apple' } });
		expect(await block.hits()).toEqual(['apple', 'Apple']);
		expect(await block.brightMarks()).toEqual([]);
		expect(await block.hitListeners()).toBe(0);
		expect(errors).toEqual([]);
	});

	test('a Rich Search whose currentHit fails draws every match dimmed, without an error', async ({ page, renderBlock }) => {
		const errors: string[] = [];
		page.on('pageerror', e => errors.push(e.message));
		const block = await renderBlock(TABLE, { searchHost: 'hitThrows', initialQuery: { query: 'apple' } });
		expect(await block.hits()).toEqual(['apple', 'Apple']);
		expect(await block.brightMarks()).toEqual([]);
		expect(errors).toEqual([]);
	});

	test('the block listens for the opened match while shown and stops when unloaded, with one listener for any number of blocks', async ({ page, renderBlock }) => {
		const block = await renderBlock(TABLE, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await page.evaluate(() => { const w = window as unknown as { __btMount: () => void }; w.__btMount(); w.__btMount(); });
		expect(await block.hitListeners()).toBe(1);
		await page.evaluate(() => {
			const w = window as unknown as { __btBlock: { unload(): void } };
			w.__btBlock.unload();
		});
		expect(await block.hitListeners()).toBe(1);
	});
});
