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
		expect(await view.hits()).toEqual(['plain']);
	});

	test('an emptied query or a closed panel takes the marks off, and a new query brings them back', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await sheets() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await view.setQuery(null);
		expect(await view.hits()).toEqual([]);
		await view.setQuery({ query: 'apple' });
		expect(await view.hits()).toEqual(['apple', 'Apple']);
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

test.describe('search hit styling', () => {
	test('wins over a host stylesheet that colours every mark, and differs from the reader\'s own mark', async ({ page, renderXlsxFile }) => {
		await renderXlsxFile({ [PATH]: await single() }, PATH, { searchHost: 'panel', initialQuery: { query: 'apple' } });
		await page.evaluate(() => document.getElementById('root')!.classList.add('markdown-preview-view', 'markdown-rendered'));
		await page.addStyleTag({ content: '.markdown-preview-view.markdown-rendered mark, body mark { background-color: rgb(255, 0, 0); color: rgb(1, 2, 3); }' });
		await page.evaluate(() => {
			const probe = document.createElement('div');
			probe.className = 'markdown-preview-view markdown-rendered';
			probe.innerHTML = '<mark id="own">own</mark>';
			document.body.appendChild(probe);
		});
		const colours = await page.evaluate(() => {
			const mine = getComputedStyle(document.querySelector('mark.bt-search-hit')!);
			const own = getComputedStyle(document.getElementById('own')!);
			return { mine: mine.backgroundColor, mineColor: mine.color, own: own.backgroundColor };
		});
		expect(colours.mine).not.toBe('rgb(255, 0, 0)');
		expect(colours.mine).not.toBe(colours.own);
		expect(colours.mineColor).not.toBe('rgb(1, 2, 3)');
	});
});
