import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// A merged cell can be split along the axis it spans when that span is even, so splitting is as available for a
// merge as unmerging it is. The menu's own gating is in splitChoices (unit-tested); this checks the panel a person
// actually opens.
const rows = [{ 0: 'a1', 1: 'b1' }, { 0: 'a2', 1: 'b2' }, { 0: 'a3', 1: 'b3' }, { 0: 'a4', 1: 'b4' }, { 0: 'a5', 1: 'b5' }];

async function openPanel(page: import('@playwright/test').Page, row: number, col: number): Promise<string[]> {
	await page.locator(`[data-row="${row}"][data-col="${col}"]`).first().dblclick();
	await page.locator('.bt-cp-item').first().waitFor();
	return page.locator('.bt-cp-item').allInnerTexts();
}

test.describe('splitting a merged cell from its panel', () => {
	test('a two-row merge offers "Split into 2 rows" and dispatches split-cell-row on its anchor', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [80, 80], rows, merges: [[0, 0, 1, 0]] }));
		const items = await openPanel(page, 1, 0);
		expect(items).toContain('Split into 2 rows');
		await page.locator('.bt-cp-item', { hasText: 'Split into 2 rows' }).click();
		const ops = await page.evaluate(() => window.__btOps);
		expect(ops).toContainEqual({ type: 'split-cell-row', rowId: 'r_0', colId: 'c_0' });
	});

	test('a three-row merge has no middle: it offers no "Split into 2 rows", and still "Split into 2 columns"', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [80, 80], rows, merges: [[0, 0, 2, 0]] }));
		const items = await openPanel(page, 1, 0);
		expect(items).not.toContain('Split into 2 rows');
		expect(items).toContain('Split into 2 columns');
	});

	test('a two-column merge offers "Split into 2 columns"', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [80, 80], rows, merges: [[0, 0, 0, 1]] }));
		const items = await openPanel(page, 1, 0);
		expect(items).toContain('Split into 2 columns');
		expect(items).toContain('Split into 2 rows');
	});

	test('a merge across both axes offers neither', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [80, 80], rows, merges: [[0, 0, 1, 1]] }));
		const items = await openPanel(page, 1, 0);
		expect(items).not.toContain('Split into 2 rows');
		expect(items).not.toContain('Split into 2 columns');
	});
});
