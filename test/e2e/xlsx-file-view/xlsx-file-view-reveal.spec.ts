import { test, expect } from '../common/test-base';
import { buildXlsxFixtureBytes } from '../common/build-xlsx-fixture';

/** A search hit opened in the file view: go to the sheet and cell, mark the matches. */
const PATH = 'data/book.xlsx';
type Page = import('@playwright/test').Page;

const sheets = () => buildXlsxFixtureBytes({
	sheets: [
		{ name: 'First', grid: [['Name', 'Note'], ['apple pie', 'x'], ['plain', 'Apple']] },
		{ name: 'Second Sheet', grid: [['Item'], ['an apple here'], ['nothing'], ['APPLE and apple']] },
	],
});
const single = () => buildXlsxFixtureBytes({ sheets: [{ name: 'Only', grid: [['H'], ['apple one'], ['two']] }] });
const hit = (sheet: string, row: number, col: number, query = 'apple') => ({ anchor: { sheet, row, col }, query: { query } });
const activeTab = (page: Page) => page.locator('.bt-sheet-tab-active');

test.describe('xlsx file view: going to a search hit', () => {
	test('switches to the sheet named in the anchor', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH);
		await expect(activeTab(page)).toHaveText('First');
		await view.reveal(hit('Second Sheet', 4, 1));
		await expect(activeTab(page)).toHaveText('Second Sheet');
	});

	test('a hit that arrives before the file is drawn is applied once it is drawn', async ({ page, renderXlsxFile }) => {
		await renderXlsxFile({ [PATH]: await sheets() }, PATH, { pendingReveal: hit('Second Sheet', 2, 1) });
		await expect(activeTab(page)).toHaveText('Second Sheet');
	});

	test('a single-sheet file ignores the sheet name and goes by coordinates', async ({ page, renderXlsxFile }) => {
		await page.setViewportSize({ width: 500, height: 200 });
		const rows = Array.from({ length: 60 }, (_, i) => [`row${i}`]);
		const view = await renderXlsxFile({ [PATH]: await buildXlsxFixtureBytes({ sheets: [{ name: 'Only', grid: [['H'], ...rows] }] }) }, PATH);
		await view.reveal(hit('Whatever', 50, 1));
		await expect.poll(() => page.locator('.bt-table-wrapper:not(#wrapper)').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
	});

	test('an anchor whose sheet is gone leaves the default view', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH);
		await view.reveal(hit('Deleted Sheet', 2, 1));
		await expect(activeTab(page)).toHaveText('First');
	});

	test('an anchor whose cell is gone is not an error', async ({ page, renderXlsxFile }) => {
		const errors: string[] = [];
		page.on('pageerror', e => errors.push(e.message));
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH);
		await view.reveal(hit('First', 500, 1));
		await page.waitForTimeout(100);
		expect(errors).toEqual([]);
	});

	test('requests that are not usable are ignored without an error', async ({ page, renderXlsxFile }) => {
		const errors: string[] = [];
		page.on('pageerror', e => errors.push(e.message));
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		const before = await view.hits();
		for (const bad of [null, undefined, 5, {}, { anchor: {}, query: { query: 'a' } }, { anchor: { sheet: 'First', row: 0, col: 1 }, query: { query: 'a' } }, { anchor: { sheet: 'First', row: 2, col: 1 }, query: {} }]) {
			await view.reveal(bad);
		}
		expect(await view.hits()).toEqual(before);
		expect(errors).toEqual([]);
	});

	test('a refresh from disk does not pull the scroll back to the hit', async ({ page, renderXlsxFile }) => {
		await page.setViewportSize({ width: 500, height: 200 });
		const rows = Array.from({ length: 60 }, (_, i) => [`row${i}`]);
		const book = (marker: string) => buildXlsxFixtureBytes({ sheets: [{ name: 'Only', grid: [['H'], ...rows, [marker]] }] });
		const view = await renderXlsxFile({ [PATH]: await book('one') }, PATH);
		await view.reveal(hit('Only', 50, 1));
		const wrapper = page.locator('.bt-table-wrapper:not(#wrapper)');
		await expect.poll(() => wrapper.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
		await wrapper.evaluate(el => { el.scrollTop = 0; });
		await view.modify(await book('two'));
		await expect(page.locator('.bt-td', { hasText: 'two' })).toBeAttached({ timeout: 3000 });
		expect(await wrapper.evaluate(el => el.scrollTop)).toBe(0);
	});
});

test.describe('xlsx file view: the marks follow the search panel', () => {
	test('marks every match on the sheet while the panel holds a query', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		expect(await view.hits()).toEqual(['apple', 'Apple']);
	});

	test('marks the matches on the sheet the hit led to', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.reveal(hit('Second Sheet', 4, 1));
		await expect(activeTab(page)).toHaveText('Second Sheet');
		await expect.poll(() => view.hits()).toEqual(['apple', 'APPLE', 'apple']);
	});

	test('a new query in the panel changes the marks', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.setQuery({ query: 'plain' });
		await expect.poll(() => view.hits()).toEqual(['plain']);
	});

	test('quick typing is marked once typing pauses, not on every key', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await page.evaluate(() => {
			const w = window as unknown as { __btMarkCalls: number };
			w.__btMarkCalls = 0;
			// markSpans swaps each text node for a fragment holding the marks; count those swaps.
			const real = CharacterData.prototype.replaceWith;
			CharacterData.prototype.replaceWith = function (...nodes: (Node | string)[]) {
				if (nodes.some(n => typeof n !== 'string' && (n as DocumentFragment).querySelector?.('mark.bt-search-hit'))) w.__btMarkCalls++;
				return real.apply(this, nodes as never);
			};
		});
		for (const q of ['p', 'pl', 'pla', 'plai', 'plain']) await view.setQuery({ query: q });
		await expect.poll(() => view.hits()).toEqual(['plain']);
		const calls = await page.evaluate(() => (window as unknown as { __btMarkCalls: number }).__btMarkCalls);
		// One pass marks the one cell that holds "plain"; five passes (one per key) would count more.
		expect(calls).toBe(1);
	});

	test('an emptied query or a closed panel takes the marks off, and a new query brings them back', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.setQuery(null);
		await expect.poll(() => view.hits()).toEqual([]);
		await view.setQuery({ query: 'apple' });
		await expect.poll(() => view.hits()).toEqual(['apple', 'Apple']);
	});

	test('the panel\'s query wins over the one that came with the hit', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH, { searchHost: 'panel', initialQuery: { query: 'plain' } });
		await view.reveal(hit('First', 2, 1, 'apple'));
		expect(await view.hits()).toEqual(['plain']);
	});

	test('a hit alone, with the panel closed, marks nothing', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH, { searchHost: 'panel' });
		await view.reveal(hit('First', 2, 1));
		expect(await view.hits()).toEqual([]);
	});

	test('the options of the panel\'s query reach the host\'s matching rules', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple', wholeWord: true, caseSensitive: true } });
		expect(await view.hits()).toEqual(['apple']);
	});

	test('clicking a cell does not take the marks off', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await page.locator('.bt-td', { hasText: 'plain' }).click();
		expect(await view.hits()).toEqual(['apple', 'Apple']);
	});

	test('Escape does not take the marks off', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await page.keyboard.press('Escape');
		expect(await view.hits()).toEqual(['apple', 'Apple']);
	});

	test('a refresh from disk keeps the marks for the panel\'s query', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.modify(await buildXlsxFixtureBytes({ sheets: [{ name: 'Only', grid: [['H'], ['apple two'], ['an apple']] }] }));
		await expect(page.locator('.bt-td', { hasText: 'apple two' })).toBeVisible({ timeout: 3000 });
		await expect.poll(() => view.hits()).toEqual(['apple', 'apple']);
	});

	test('switching sheets by the tabs marks the matches of the sheet now shown', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await page.locator('.bt-sheet-tab', { hasText: 'Second Sheet' }).click();
		await expect.poll(() => view.hits()).toEqual(['apple', 'APPLE', 'apple']);
	});

	test('opening another file marks that file by the same panel query', async ({ renderXlsxFile }) => {
		const other = await buildXlsxFixtureBytes({ sheets: [{ name: 'O', grid: [['H'], ['apple pie'], ['no']] }] });
		const view = await renderXlsxFile({ [PATH]: await single(), 'data/other.xlsx': other }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.openOther('data/other.xlsx');
		expect(await view.hits()).toEqual(['apple']);
	});

	test('after the file is closed and another opened in the same view, the marks still follow the panel', async ({ renderXlsxFile }) => {
		const other = await buildXlsxFixtureBytes({ sheets: [{ name: 'O', grid: [['H'], ['apple pie'], ['plain']] }] });
		const view = await renderXlsxFile({ [PATH]: await single(), 'data/other.xlsx': other }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.closeFile();
		await view.openOther('data/other.xlsx');
		expect(await view.panelListeners()).toBe(1);
		await view.setQuery({ query: 'plain' });
		await expect.poll(() => view.hits()).toEqual(['plain']);
	});

	test('opening one file after another in the same view never leaves a second listener', async ({ renderXlsxFile }) => {
		const other = await buildXlsxFixtureBytes({ sheets: [{ name: 'O', grid: [['H'], ['apple pie']] }] });
		const view = await renderXlsxFile({ [PATH]: await single(), 'data/other.xlsx': other }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.openOther('data/other.xlsx');
		await view.openOther(PATH);
		expect(await view.panelListeners()).toBe(1);
		// A second listener the view forgot about would keep the panel connected after the view is gone.
		await view.closeView();
		expect(await view.panelListeners()).toBe(0);
	});

	test('a Rich Search enabled after the file is open is followed from then on', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'none' });
		expect(await view.panelListeners()).toBe(0);
		await view.enableSearchHost('panel');
		await view.modify(await single());
		await expect.poll(() => view.panelListeners()).toBe(1);
		await view.setQuery({ query: 'apple' });
		await expect.poll(() => view.hits()).toEqual(['apple']);
	});

	test('the view listens to the panel while it is open and stops when it closes', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		expect(await view.panelListeners()).toBe(1);
		await view.closeView();
		expect(await view.panelListeners()).toBe(0);
	});

	test('unloading the view alone also stops listening', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.unloadView();
		expect(await view.panelListeners()).toBe(0);
	});

	test('re-drawing the view never adds a second listener', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.modify(await single());
		await view.modify(await single());
		await new Promise(r => setTimeout(r, 1200));
		expect(await view.panelListeners()).toBe(1);
	});

	test('a change in the panel after the view closed does nothing', async ({ page, renderXlsxFile }) => {
		const errors: string[] = [];
		page.on('pageerror', e => errors.push(e.message));
		const view = await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.unloadView();
		await view.setQuery({ query: 'two' });
		expect(await view.hits()).toEqual([]);
		expect(errors).toEqual([]);
	});
});

test.describe('xlsx file view: a Rich Search without currentQuery', () => {
	test('marks the matches of the hit once, and never takes them off on its own', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'legacy' });
		await view.reveal(hit('Only', 2, 1));
		expect(await view.hits()).toEqual(['apple']);
		await page.locator('.bt-td', { hasText: 'two' }).click();
		await page.keyboard.press('Escape');
		expect(await view.hits()).toEqual(['apple']);
	});

	test('a hit that arrives before the file is drawn is marked once it is drawn', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'legacy', pendingReveal: hit('Only', 2, 1) });
		await expect.poll(() => view.hits()).toEqual(['apple']);
	});

	test('opening without a hit marks nothing', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'legacy' });
		expect(await view.hits()).toEqual([]);
	});
});

test.describe('xlsx file view: no usable Rich Search', () => {
	test('without Rich Search the view still goes to the hit and marks nothing', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH, { searchHost: 'none' });
		await view.reveal(hit('Second Sheet', 2, 1));
		await expect(activeTab(page)).toHaveText('Second Sheet');
		expect(await view.hits()).toEqual([]);
	});

	test('a Rich Search with another apiVersion is not listened to and marks nothing', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH, { searchHost: 'future', initialQuery: { query: 'apple' } });
		await view.reveal(hit('Second Sheet', 2, 1));
		await expect(activeTab(page)).toHaveText('Second Sheet');
		expect(await view.hits()).toEqual([]);
		expect(await view.panelListeners()).toBe(0);
	});

	test('a Rich Search whose matching fails means no marks and no error, and the view stays usable', async ({ page, renderXlsxFile }) => {
		const errors: string[] = [];
		page.on('pageerror', e => errors.push(e.message));
		const view = await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'throws' });
		await view.reveal(hit('Only', 2, 1));
		expect(await view.hits()).toEqual([]);
		expect(errors).toEqual([]);
		await expect(page.locator('.bt-td', { hasText: 'apple one' })).toBeVisible();
	});
});

test.describe('the opened match is brighter (contract 5.10)', () => {
	const open = (path: string, sheet: string, row: number, col: number) => ({ path, line: 0, index: 0, anchor: { sheet, row, col } });
	const twoOnOneRow = () => buildXlsxFixtureBytes({ sheets: [{ name: 'Only', grid: [['H'], ['apple and apple'], ['an apple']] }] });

	test('with no match opened every match is dimmed', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		expect(await view.hits()).toEqual(['apple']);
		expect(await view.brightMarks()).toEqual([]);
	});

	test('the opened match is drawn bright and the others stay dimmed', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.openHit(open(PATH, 'First', 3, 2));
		expect(await view.hits()).toEqual(['apple', 'Apple']);
		expect(await view.brightMarks()).toEqual(['Apple']);
	});

	test('a bright mark is also an ordinary one, so it keeps its place and its dim styling base', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.openHit(open(PATH, 'Only', 2, 1));
		const classes = await page.evaluate(() => document.querySelector('mark.bt-search-hit-active')!.className);
		expect(classes.split(' ').sort()).toEqual(['bt-search-hit', 'bt-search-hit-active']);
	});

	test('in a cell with two matches only the first is bright', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await twoOnOneRow() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.openHit(open(PATH, 'Only', 2, 1));
		expect(await view.hits()).toEqual(['apple', 'apple', 'apple']);
		expect(await view.brightMarks()).toEqual(['apple']);
		const which = await view.brightIndex();
		expect(which).toBe(0);
	});

	test('opening another match moves the bright one without marking the text again', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await twoOnOneRow() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.openHit(open(PATH, 'Only', 2, 1));
		await page.evaluate(() => {
			const w = window as unknown as { __btSwaps: number };
			w.__btSwaps = 0;
			const real = CharacterData.prototype.replaceWith;
			CharacterData.prototype.replaceWith = function (...n: (Node | string)[]) { w.__btSwaps++; return real.apply(this, n as never); };
		});
		await view.openHit(open(PATH, 'Only', 3, 1));
		expect(await view.hits()).toEqual(['apple', 'apple', 'apple']);
		expect(await view.brightMarks()).toEqual(['apple']);
		expect(await page.evaluate(() => (window as unknown as { __btSwaps: number }).__btSwaps)).toBe(0);
		expect(await view.brightCellText()).toBe('an apple');
	});

	test('a match opened in another file brightens nothing here', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.openHit(open('data/other.xlsx', 'Only', 2, 1));
		expect(await view.brightMarks()).toEqual([]);
	});

	test('a match on another sheet is not bright here, and is once that sheet is shown', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.openHit(open(PATH, 'Second Sheet', 2, 1));
		await expect(page.locator('.bt-sheet-tab-active')).toHaveText('First');
		expect(await view.brightMarks()).toEqual([]);
		await page.locator('.bt-sheet-tab', { hasText: 'Second Sheet' }).click();
		await expect.poll(() => view.brightMarks()).toEqual(['apple']);
	});

	test('clearing the opened match dims everything again', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.openHit(open(PATH, 'Only', 2, 1));
		expect(await view.brightMarks()).toEqual(['apple']);
		await view.openHit(null);
		expect(await view.brightMarks()).toEqual([]);
		expect(await view.hits()).toEqual(['apple']);
	});

	test('a new search keeps the bright mark on the same cell when it still matches there', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.openHit(open(PATH, 'First', 2, 1));
		await view.setQuery({ query: 'app' });
		await expect.poll(() => view.brightMarks()).toEqual(['app']);
		expect(await view.brightCellText()).toBe('apple pie');
	});

	test('nothing is bright when the opened cell no longer holds a match', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.openHit(open(PATH, 'First', 2, 1));
		await view.setQuery({ query: 'plain' });
		await expect.poll(() => view.hits()).toEqual(['plain']);
		expect(await view.brightMarks()).toEqual([]);
	});

	test('a refresh from disk keeps the opened match bright', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.openHit(open(PATH, 'Only', 2, 1));
		await view.modify(await buildXlsxFixtureBytes({ sheets: [{ name: 'Only', grid: [['H'], ['apple two'], ['x']] }] }));
		await expect(page.locator('.bt-td', { hasText: 'apple two' })).toBeVisible({ timeout: 3000 });
		await expect.poll(() => view.brightMarks()).toEqual(['apple']);
	});

	test('clicking a cell leaves the bright mark as it is', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.openHit(open(PATH, 'Only', 2, 1));
		await page.locator('.bt-td', { hasText: 'two' }).click();
		expect(await view.brightMarks()).toEqual(['apple']);
	});

	test('a Rich Search that predates the opened match draws every match dimmed, without an error', async ({ page, renderXlsxFile }) => {
		const errors: string[] = [];
		page.on('pageerror', e => errors.push(e.message));
		const view = await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'noHit', initialQuery: { query: 'apple' } });
		expect(await view.hits()).toEqual(['apple']);
		expect(await view.brightMarks()).toEqual([]);
		expect(await view.hitListeners()).toBe(0);
		expect(errors).toEqual([]);
	});

	test('a Rich Search whose currentHit fails draws every match dimmed, without an error', async ({ page, renderXlsxFile }) => {
		const errors: string[] = [];
		page.on('pageerror', e => errors.push(e.message));
		const view = await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'hitThrows', initialQuery: { query: 'apple' } });
		expect(await view.hits()).toEqual(['apple']);
		expect(await view.brightMarks()).toEqual([]);
		expect(errors).toEqual([]);
	});

	test('the view listens for the opened match while it is open and stops when it closes', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		expect(await view.hitListeners()).toBe(1);
		await view.closeView();
		expect(await view.hitListeners()).toBe(0);
		expect(await view.panelListeners()).toBe(0);
	});
});

test.describe('search hit colour (contract 5.9 and 5.10)', () => {
	type P = import('@playwright/test').Page;
	interface Paint { rgb: [number, number, number]; alpha: number; fg: string; ring: string }
	/** Every match is the user's colour at 45%; the opened one is that colour at full strength with a ring in the text colour. */
	const paint = (page: P, which: 'dim' | 'bright') => page.evaluate((which) => {
		const el = document.querySelector(which === 'bright' ? 'mark.bt-search-hit-active' : 'mark.bt-search-hit:not(.bt-search-hit-active)')!;
		const cs = getComputedStyle(el);
		// Computed colours come back as rgb(), rgba() or color(srgb …), whichever the engine prefers for a mix.
		const parse = (c: string): { rgb: [number, number, number]; alpha: number } => {
			const m = /^(?:rgba?|color\(srgb)\s*\(?([^)]*)\)?$/.exec(c.trim()) ?? [];
			const nums = (m[1] ?? '').split(/[\s,\/]+/).filter(Boolean).map(Number);
			const unit = c.startsWith('color(') ? 255 : 1;
			return { rgb: [Math.round(nums[0]! * unit), Math.round(nums[1]! * unit), Math.round(nums[2]! * unit)], alpha: nums[3] ?? 1 };
		};
		const bg = parse(cs.backgroundColor);
		return { rgb: bg.rgb, alpha: Math.round(bg.alpha * 100) / 100, fg: cs.color, ring: cs.boxShadow };
	}, which) as Promise<Paint>;
	const hostile = (page: P) => page.addStyleTag({ content: '.markdown-preview-view.markdown-rendered mark, body mark { background-color: rgb(255, 0, 0); color: rgb(1, 2, 3); box-shadow: none; }' });
	const inNote = (page: P) => page.evaluate(() => document.getElementById('root')!.classList.add('markdown-preview-view', 'markdown-rendered'));
	const bothMarks = async (renderXlsxFile: (f: Record<string, number[]>, o: string, opts?: { searchHost?: 'panel'; initialQuery?: { query: string } }) => Promise<{ openHit(h: unknown): Promise<void> }>) => {
		const view = await renderXlsxFile({ [PATH]: await buildXlsxFixtureBytes({ sheets: [{ name: 'Only', grid: [['H'], ['apple'], ['an apple']] }] }) }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.openHit({ path: PATH, line: 0, index: 0, anchor: { sheet: 'Only', row: 2, col: 1 } });
		return view;
	};

	test('without Rich Search\'s variables a match is the shared default colour at 45%, and the opened one at full strength', async ({ page, renderXlsxFile }) => {
		await bothMarks(renderXlsxFile);
		// A dark theme's light text must not leak into the dim marks; they take the cell's own text colour.
		await page.evaluate(() => { document.body.style.color = 'rgb(240, 240, 240)'; });
		expect(await paint(page, 'dim')).toMatchObject({ rgb: [204, 255, 0], alpha: 0.45 });
		expect(await paint(page, 'bright')).toMatchObject({ rgb: [204, 255, 0], alpha: 1, fg: 'rgb(0, 0, 0)' });
	});

	test('the dim marks have no ring and keep the text colour of the cell; the opened one has a ring in the chosen text colour', async ({ page, renderXlsxFile }) => {
		await bothMarks(renderXlsxFile);
		await page.evaluate(() => {
			document.body.style.color = 'rgb(240, 240, 240)';
			document.body.style.setProperty('--rs-match-fg', 'rgb(5, 6, 7)');
		});
		const dim = await paint(page, 'dim');
		const bright = await paint(page, 'bright');
		expect(dim.ring).toBe('none');
		expect(dim.fg).toBe('rgb(240, 240, 240)');
		expect(bright.fg).toBe('rgb(5, 6, 7)');
		expect(bright.ring).toContain('rgb(5, 6, 7)');
		expect(bright.ring).toContain('1px');
	});

	test('takes the colours the user chose, from the variables on the body', async ({ page, renderXlsxFile }) => {
		await bothMarks(renderXlsxFile);
		await page.evaluate(() => {
			document.body.style.setProperty('--rs-match-bg', 'rgb(10, 20, 30)');
			document.body.style.setProperty('--rs-match-fg', 'rgb(250, 240, 230)');
		});
		expect(await paint(page, 'dim')).toMatchObject({ rgb: [10, 20, 30], alpha: 0.45 });
		expect(await paint(page, 'bright')).toMatchObject({ rgb: [10, 20, 30], alpha: 1, fg: 'rgb(250, 240, 230)' });
	});

	test('follows a change of the chosen colour without being redrawn', async ({ page, renderXlsxFile }) => {
		await bothMarks(renderXlsxFile);
		await page.evaluate(() => document.body.style.setProperty('--rs-match-bg', 'rgb(1, 1, 1)'));
		expect((await paint(page, 'bright')).rgb).toEqual([1, 1, 1]);
		await page.evaluate(() => document.body.style.setProperty('--rs-match-bg', 'rgb(2, 2, 2)'));
		expect((await paint(page, 'bright')).rgb).toEqual([2, 2, 2]);
		expect((await paint(page, 'dim')).rgb).toEqual([2, 2, 2]);
	});

	test('a theme or snippet rule on every mark does not override either strength', async ({ page, renderXlsxFile }) => {
		await bothMarks(renderXlsxFile);
		await inNote(page);
		await hostile(page);
		await page.evaluate(() => document.body.style.setProperty('--rs-match-bg', 'rgb(10, 20, 30)'));
		expect(await paint(page, 'dim')).toMatchObject({ rgb: [10, 20, 30], alpha: 0.45 });
		const bright = await paint(page, 'bright');
		expect(bright).toMatchObject({ rgb: [10, 20, 30], alpha: 1 });
		expect(bright.fg).not.toBe('rgb(1, 2, 3)');
		expect(bright.ring).not.toBe('none');
	});

	test('does not take the theme\'s accent colour', async ({ page, renderXlsxFile }) => {
		await bothMarks(renderXlsxFile);
		await page.evaluate(() => document.body.style.setProperty('--interactive-accent', 'rgb(200, 0, 200)'));
		expect((await paint(page, 'dim')).rgb).not.toEqual([200, 0, 200]);
		expect((await paint(page, 'bright')).rgb).not.toEqual([200, 0, 200]);
	});

	test('the reader\'s own highlight is left as it is', async ({ page, renderXlsxFile }) => {
		await bothMarks(renderXlsxFile);
		await page.evaluate(() => {
			document.body.style.setProperty('--rs-match-bg', 'rgb(10, 20, 30)');
			const own = document.createElement('mark');
			own.id = 'own';
			own.textContent = 'mine';
			document.body.appendChild(own);
		});
		const own = await page.evaluate(() => getComputedStyle(document.getElementById('own')!).backgroundColor);
		expect(own).not.toBe('rgb(10, 20, 30)');
		expect(own).not.toContain('0.45');
	});
});
