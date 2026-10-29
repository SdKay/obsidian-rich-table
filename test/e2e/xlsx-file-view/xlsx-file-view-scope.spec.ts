import { test, expect } from '../common/test-base';
import { buildXlsxFixtureBytes } from '../common/build-xlsx-fixture';

/** The marks in the .xlsx tab stay inside the files the search covers (contract 5.11). */
const PATH = 'data/book.xlsx';
const book = () => buildXlsxFixtureBytes({ sheets: [{ name: 'Only', grid: [['Name', 'Note'], ['apple pie', 'x'], ['plain', 'Apple']] }] });
const APPLE = { query: 'apple' };
const BOTH = ['apple', 'Apple'];
const OPENED = { path: PATH, line: 2, index: 0, anchor: { sheet: 'Only', row: 2, col: 1 } };

test.describe('xlsx file view: marks follow the search scope', () => {
	test('a file the search does not cover is not marked, although the query matches it', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await book() }, PATH, { searchHost: 'scoped', initialQuery: APPLE });
		expect(await view.hits()).toEqual(BOTH);
		await view.setScope('elsewhere/');
		await expect.poll(() => view.hits()).toEqual([]);
	});

	test('a scope change marks and unmarks the file although the query never changes', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await book() }, PATH, { searchHost: 'scoped', initialQuery: APPLE });
		await view.setScope('elsewhere/');
		await expect.poll(() => view.hits()).toEqual([]);
		await view.setScope('data/');
		await expect.poll(() => view.hits()).toEqual(BOTH);
		await view.setScope('elsewhere/');
		await expect.poll(() => view.hits()).toEqual([]);
		await view.setScope(null);
		await expect.poll(() => view.hits()).toEqual(BOTH);
	});

	test('the bright mark goes with the others when the file leaves the scope, and comes back with it', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await book() }, PATH, { searchHost: 'scoped', initialQuery: APPLE });
		await view.openHit(OPENED);
		expect(await view.brightMarks()).toEqual(['apple']);
		await view.setScope('elsewhere/');
		await expect.poll(() => view.hits()).toEqual([]);
		expect(await view.brightMarks()).toEqual([]);
		await view.setScope('data/');
		await expect.poll(() => view.hits()).toEqual(BOTH);
		expect(await view.brightMarks()).toEqual(['apple']);
	});

	test('the scope is asked about the file the tab shows now', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await book(), 'other/two.xlsx': await book() }, PATH, { searchHost: 'scoped', initialQuery: APPLE });
		await view.setScope('data/');
		await expect.poll(() => view.hits()).toEqual(BOTH);
		await view.openOther('other/two.xlsx');
		await expect.poll(() => view.hits()).toEqual([]);
		await view.openOther(PATH);
		await expect.poll(() => view.hits()).toEqual(BOTH);
	});

	test('the view stops listening to the scope when it is closed', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await book() }, PATH, { searchHost: 'scoped', initialQuery: APPLE });
		expect(await view.scopeListeners()).toBe(1);
		await view.closeView();
		expect(await view.scopeListeners()).toBe(0);
	});

	test('without inScope (an older Rich Search) the file is marked as before, whatever the scope', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await book() }, PATH, { searchHost: 'panel', initialQuery: APPLE });
		await view.setScope('elsewhere/');
		await view.setQuery({ query: 'plain' });
		await expect.poll(() => view.hits()).toEqual(['plain']);
	});

	test('onScopeChange without inScope is ignored: nothing is subscribed and the marks stay', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await book() }, PATH, { searchHost: 'scopeListenerOnly', initialQuery: APPLE });
		expect(await view.scopeListeners()).toBe(0);
		await view.setScope('elsewhere/');
		expect(await view.hits()).toEqual(BOTH);
	});

	test('inScope without onScopeChange: it is read again on the next repaint for another reason', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await book() }, PATH, { searchHost: 'scopeOnly', initialQuery: APPLE });
		await view.setScope('elsewhere/');
		expect(await view.scopeListeners()).toBe(0);
		expect(await view.hits()).toEqual(BOTH);
		await view.setQuery({ query: 'plain' });
		await new Promise(r => setTimeout(r, 200));
		expect(await view.hits()).toEqual([]);
		await view.setScope(null);
		await view.setQuery({ query: 'apple' });
		await expect.poll(() => view.hits()).toEqual(BOTH);
	});

	test('a scope check that throws counts as covered: the marks stay and nothing breaks', async ({ page, renderXlsxFile }) => {
		const errors: string[] = [];
		page.on('pageerror', e => errors.push(e.message));
		const view = await renderXlsxFile({ [PATH]: await book() }, PATH, { searchHost: 'scopeThrows', initialQuery: APPLE });
		expect(await view.hits()).toEqual(BOTH);
		await view.setScope('elsewhere/');
		expect(await view.hits()).toEqual(BOTH);
		await view.setQuery({ query: 'plain' });
		await expect.poll(() => view.hits()).toEqual(['plain']);
		expect(errors).toEqual([]);
	});
});
