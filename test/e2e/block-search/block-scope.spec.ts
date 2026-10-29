import { test, expect } from '../common/test-base';

/** The marks in a note's table stay inside the files the search covers (contract 5.11). */
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
const NOTE = 'inside/note.md';
const APPLE = { query: 'apple' };
const BOTH = ['apple', 'Apple'];
const OPENED = { path: NOTE, line: 2, index: 0, block: { fromLine: 2, anchor: { kind: 'cell', rowId: 'r_1', colId: 'c_a' } } };

test.describe('rich-table block in a note: marks follow the search scope', () => {
	test('a table the search does not cover is not marked, although the query matches it', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { sourcePath: NOTE, searchHost: 'scoped', initialQuery: APPLE });
		expect(await block.hits()).toEqual(BOTH);
		await block.setScope('elsewhere/');
		await expect.poll(() => block.hits()).toEqual([]);
	});

	test('a table created outside the scope starts unmarked', async ({ page, renderBlock }) => {
		const block = await renderBlock(TABLE, { sourcePath: NOTE, searchHost: 'scoped', initialQuery: APPLE });
		await block.setScope('elsewhere/');
		await expect.poll(() => block.hits()).toEqual([]);
		await page.evaluate(() => { (window as unknown as { __btMount: () => void }).__btMount(); });
		await expect(page.locator('.bt-table').nth(1)).toBeVisible();
		expect(await block.hits()).toEqual([]);
	});

	test('a scope change marks and unmarks the table although the query never changes', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { sourcePath: NOTE, searchHost: 'scoped', initialQuery: APPLE });
		await block.setScope('elsewhere/');
		await expect.poll(() => block.hits()).toEqual([]);
		await block.setScope('inside/');
		await expect.poll(() => block.hits()).toEqual(BOTH);
		await block.setScope('elsewhere/');
		await expect.poll(() => block.hits()).toEqual([]);
		await block.setScope(null);
		await expect.poll(() => block.hits()).toEqual(BOTH);
	});

	test('the bright mark goes with the others when the table leaves the scope, and comes back with it', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { sourcePath: NOTE, searchHost: 'scoped', initialQuery: APPLE });
		await block.openHit(OPENED);
		expect(await block.brightMarks()).toEqual(['apple']);
		await block.setScope('elsewhere/');
		await expect.poll(() => block.hits()).toEqual([]);
		expect(await block.brightMarks()).toEqual([]);
		await block.setScope('inside/');
		await expect.poll(() => block.hits()).toEqual(BOTH);
		expect(await block.brightMarks()).toEqual(['apple']);
	});

	test('the table is not marked after a rebuild while it is out of scope', async ({ page, renderBlock }) => {
		const block = await renderBlock(TABLE, { sourcePath: NOTE, searchHost: 'scoped', initialQuery: APPLE });
		await block.setScope('elsewhere/');
		await expect.poll(() => block.hits()).toEqual([]);
		await block.reprocess();
		await expect(page.locator('.bt-td').first()).toBeVisible();
		expect(await block.hits()).toEqual([]);
	});

	test('the scope is asked about the note that holds the block', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { sourcePath: 'inside/deep/note.md', searchHost: 'scoped', initialQuery: APPLE });
		expect(await block.hits()).toEqual(BOTH);
		await block.setScope('inside/deep/');
		await expect.poll(() => block.hits()).toEqual(BOTH);
		await block.setScope('inside/other/');
		await expect.poll(() => block.hits()).toEqual([]);
	});

	test('the block stops listening to the scope when it is unloaded', async ({ page, renderBlock }) => {
		const block = await renderBlock(TABLE, { sourcePath: NOTE, searchHost: 'scoped', initialQuery: APPLE });
		expect(await block.scopeListeners()).toBe(1);
		await page.evaluate(() => { (window as unknown as { __btBlock: { unload(): void } }).__btBlock.unload(); });
		expect(await block.scopeListeners()).toBe(0);
	});

	test('without inScope (an older Rich Search) the table is marked as before, whatever the scope', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { sourcePath: NOTE, searchHost: 'panel', initialQuery: APPLE });
		expect(await block.hits()).toEqual(BOTH);
		await block.setScope('elsewhere/');
		await block.setQuery({ query: 'plain' });
		await expect.poll(() => block.hits()).toEqual(['plain']);
	});

	test('onScopeChange without inScope is ignored: nothing is subscribed and the marks stay', async ({ renderBlock }) => {
		const block = await renderBlock(TABLE, { sourcePath: NOTE, searchHost: 'scopeListenerOnly', initialQuery: APPLE });
		expect(await block.scopeListeners()).toBe(0);
		await block.setScope('elsewhere/');
		expect(await block.hits()).toEqual(BOTH);
	});

	test('inScope without onScopeChange: out of scope at creation is unmarked, and the next query change reads it again', async ({ renderBlock }) => {
		const out = await renderBlock(TABLE, { sourcePath: 'elsewhere/note.md', searchHost: 'scopeOnly', initialQuery: APPLE });
		await out.setScope('inside/');
		await out.reprocess();
		await expect.poll(() => out.hits()).toEqual([]);
		await out.setQuery({ query: 'plain' });
		await new Promise(r => setTimeout(r, 200));
		expect(await out.hits()).toEqual([]);
		await out.setScope(null);
		await out.setQuery({ query: 'apple' });
		await expect.poll(() => out.hits()).toEqual(BOTH);
	});

	test('a scope check that throws counts as covered: the marks stay and nothing breaks', async ({ page, renderBlock }) => {
		const errors: string[] = [];
		page.on('pageerror', e => errors.push(e.message));
		const block = await renderBlock(TABLE, { sourcePath: NOTE, searchHost: 'scopeThrows', initialQuery: APPLE });
		expect(await block.hits()).toEqual(BOTH);
		await block.setScope('elsewhere/');
		expect(await block.hits()).toEqual(BOTH);
		await block.setQuery({ query: 'plain' });
		await expect.poll(() => block.hits()).toEqual(['plain']);
		expect(errors).toEqual([]);
	});
});
