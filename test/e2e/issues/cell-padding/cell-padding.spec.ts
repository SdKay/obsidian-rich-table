import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';
import type { Page } from '@playwright/test';

// A cell's top and bottom padding is the same in reading view and in the editor, whatever Obsidian
// styles tables with there. Obsidian's editor rule (.markdown-source-view.mod-cm6 td) is stronger than
// a plain `.bt-table .bt-td`, and it used to win: cells were 4px tighter in the editor than in reading
// view, which made a tall table scroll in one and not the other.
const SOURCE = tableSource({ widths: [90, 90, 90], rows: [{ 0: 'a1', 1: 'b1', 2: 'c1' }, { 0: 'a2', 1: 'b2', 2: 'c2' }] });

const asView = (page: Page, view: 'reading' | 'editor') => page.evaluate((view) => {
	const host = document.querySelector('.markdown-preview-view') as HTMLElement;
	host.classList.toggle('markdown-source-view', view === 'editor');
	host.classList.toggle('mod-cm6', view === 'editor');
}, view);

const padding = (page: Page, sel: string) => page.evaluate((sel) => {
	const cs = getComputedStyle(document.querySelector(sel) as HTMLElement);
	return { top: parseFloat(cs.paddingTop), bottom: parseFloat(cs.paddingBottom), left: parseFloat(cs.paddingLeft), right: parseFloat(cs.paddingRight) };
}, sel);

const BODY = 'td[data-row="1"][data-col="1"]';
const HEAD = 'th[data-row="0"][data-col="1"]';

for (const view of ['reading', 'editor'] as const) {
	test(`top and bottom padding is 4px in ${view} view`, { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await asView(page, view);
		for (const sel of [BODY, HEAD]) {
			const p = await padding(page, sel);
			expect(p.top, sel).toBe(4);
			expect(p.bottom, sel).toBe(4);
		}
	});

	test(`left and right padding of a middle column is 12px in ${view} view`, { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await asView(page, view);
		const p = await padding(page, BODY);
		expect(p.left).toBe(12);
		expect(p.right).toBe(12);
	});

	test(`the padding setting applies in ${view} view`, { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await asView(page, view);
		await page.evaluate(() => document.body.style.setProperty('--bt-cell-pad-y', '9px'));
		const p = await padding(page, BODY);
		expect(p.top).toBe(9);
		expect(p.bottom).toBe(9);
	});
}

test('a table is as tall in the editor as in reading view', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	const height = () => page.evaluate(() => (document.querySelector('table.bt-table') as HTMLElement).getBoundingClientRect().height);
	await asView(page, 'reading');
	const reading = await height();
	await asView(page, 'editor');
	expect(await height()).toBeCloseTo(reading, 1);
});

// Opening the editor must not move the rows below it: the editor box sits inside the cell, so its own
// padding has to follow the cell's.
for (const pad of [4, 12]) {
	test(`a row keeps its height when its editor opens, with ${pad}px padding`, { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.evaluate((pad) => document.body.style.setProperty('--bt-cell-pad-y', `${pad}px`), pad);
		const rowH = () => page.evaluate(() => (document.querySelector('td[data-row="1"][data-col="1"]') as HTMLElement).closest('tr')!.getBoundingClientRect().height);
		const before = await rowH();
		await page.locator('td[data-row="1"][data-col="1"]').click();
		await page.locator('td[data-row="1"][data-col="1"] .bt-cell-editor').waitFor();
		expect(await rowH()).toBeCloseTo(before, 0);
	});
}

