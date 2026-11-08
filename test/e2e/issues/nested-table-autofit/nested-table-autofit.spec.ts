import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// A nested rich-table block's own .bt-table-wrapper has `max-width: 100%`, capped at the outer cell, so a width read
// off its box only confirms a too-narrow column. The outer column has to make room for the nested table's content.
// The harness's MarkdownRenderer cannot render a nested block, so the same DOM shape is injected: a
// `.bt-render-root .bt-table-wrapper` holding content wider than the outer column.
const SOURCE = tableSource({
	widths: [50, 0],
	rows: [{ 0: 'x', 1: 'y' }],
	viewWidth: 1000,
});

const injectNested = (page: import('@playwright/test').Page, width: number) => page.evaluate((w) => {
	const cell = document.querySelector('[data-row="1"][data-col="1"]')!;
	cell.innerHTML = '';
	const root = document.createElement('div');
	root.className = 'bt-render-root';
	const wrapper = document.createElement('div');
	wrapper.className = 'bt-table-wrapper';
	const table = document.createElement('table');
	table.style.width = `${w}px`;
	table.innerHTML = '<tr><td>nested</td></tr>';
	wrapper.appendChild(table);
	root.appendChild(wrapper);
	cell.appendChild(root);
}, width);

test("an auto column holding a nested table is as wide as the nested table's content", { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await injectNested(page, 700);
	const autoColWidth = await page.locator('col[data-col="1"]').evaluate(el => el.getBoundingClientRect().width);
	expect(autoColWidth, "should make room for the nested table's content, not stay squeezed").toBeGreaterThan(700);
});
