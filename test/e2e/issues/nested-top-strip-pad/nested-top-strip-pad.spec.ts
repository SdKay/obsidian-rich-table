import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// A nested rich-table (rendered inside a cell) reserves exactly the same top
// space as a top-level one: the fixed edge gap plus the column-selector strip.
const UNTITLED = tableSource({ widths: [80], rows: [{ 0: 'x' }] });

test('a nested untitled table reserves the gap plus the selector strip', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(UNTITLED, { cacheKey: 'test.md:nested-abc' });
	const pad = await page.locator('.bt-render-root').evaluate(el => parseFloat(getComputedStyle(el).paddingTop));
	expect(pad).toBe(30);
});

test('a top-level untitled table reserves the same', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(UNTITLED);
	const pad = await page.locator('.bt-render-root').evaluate(el => parseFloat(getComputedStyle(el).paddingTop));
	expect(pad).toBe(30);
});
