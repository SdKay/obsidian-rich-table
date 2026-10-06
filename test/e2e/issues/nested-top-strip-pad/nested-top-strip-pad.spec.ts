import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// A nested rich-table (rendered inside a cell) reserves exactly the same top
// space as a top-level one: just the column-selector strip's height.
const UNTITLED = tableSource({ widths: [80], rows: [{ 0: 'x' }] });

test('a nested untitled table reserves only the selector strip height', async ({ page, renderFull }) => {
	await renderFull(UNTITLED, { cacheKey: 'test.md:nested-abc' });
	const pad = await page.locator('.bt-render-root').evaluate(el =>
		parseFloat((el as HTMLElement).style.getPropertyValue('--bt-sel-pad')) || 0);
	expect(pad).toBe(22);
});

test('a top-level untitled table reserves the same', async ({ page, renderFull }) => {
	await renderFull(UNTITLED);
	const pad = await page.locator('.bt-render-root').evaluate(el =>
		parseFloat((el as HTMLElement).style.getPropertyValue('--bt-sel-pad')) || 0);
	expect(pad).toBe(22);
});
