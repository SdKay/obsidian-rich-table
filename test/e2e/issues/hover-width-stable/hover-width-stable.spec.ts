import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';
import type { Page } from '@playwright/test';

const ROWS = [
	{ 0: 'alpha one', 1: 'beta two', 2: 'gamma three' },
	{ 0: 'alpha two', 1: 'beta three', 2: 'gamma one' },
];
const CYCLES = 5;

async function hoverWidths(page: Page): Promise<number[]> {
	const box = (await page.locator('table.bt-table').boundingBox())!;
	const widths: number[] = [];
	for (let i = 0; i < CYCLES; i++) {
		await page.mouse.move(box.x + 30, box.y + 10);
		await page.waitForTimeout(150);
		widths.push(await page.locator('table.bt-table').evaluate(el => el.getBoundingClientRect().width));
		await page.mouse.move(2, 2);
		await page.waitForTimeout(60);
	}
	return widths;
}

function expectStable(widths: number[]) {
	for (const w of widths) expect(w, `widths per hover: ${widths.join(', ')}`).toBeCloseTo(widths[0]!, 1);
}

test.describe('auto-layout table keeps its width across hovers', () => {
	test('grid theme (the table has a border)', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [0, 0, 0], rows: ROWS, theme: 'grid' } as never));
		expectStable(await hoverWidths(page));
	});

	test('a thick table border', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [0, 0, 0], rows: ROWS }));
		await page.addStyleTag({ content: '.bt-table { border: 6px solid red !important; }' });
		expectStable(await hoverWidths(page));
	});

	test('table padding', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [0, 0, 0], rows: ROWS }));
		await page.addStyleTag({ content: '.bt-table { padding: 4px !important; }' });
		expectStable(await hoverWidths(page));
	});

	test('no theme', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [0, 0, 0], rows: ROWS }));
		expectStable(await hoverWidths(page));
	});
});
