import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';
import type { Page } from '@playwright/test';

// A grid table's top and left edge are the table's own border: a cell owns only its right and bottom. A theme that styles
// tables in Live Preview must not take that border away. Minimal does, with a rule of two classes and an element whose
// `border` is built from a variable nobody defines, so it computes to none and wins over a plain `.bt-table`.
// The same holds for the rest of the table's frame (the grid is ours, not the theme's), so all four sides are checked.
const asEditor = (page: Page) => page.evaluate(() => {
	const host = document.querySelector('.markdown-preview-view') as HTMLElement;
	host.classList.add('markdown-source-view', 'mod-cm6');
});

const sides = (page: Page) => page.evaluate(() => {
	const cs = getComputedStyle(document.querySelector('table.bt-table') as HTMLElement);
	return { top: cs.borderTopWidth + ' ' + cs.borderTopStyle, left: cs.borderLeftWidth + ' ' + cs.borderLeftStyle, right: cs.borderRightWidth + ' ' + cs.borderRightStyle, bottom: cs.borderBottomWidth + ' ' + cs.borderBottomStyle };
});

test('a grid table keeps its outer border in the editor, whatever the theme says about tables', async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }], theme: 'grid' }));
	await asEditor(page);
	expect(await sides(page)).toEqual({ top: '2px solid', left: '2px solid', right: '2px solid', bottom: '2px solid' });
});

test('a table with no outer border in its theme has none, whatever the theme says about tables', async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }] }));
	await asEditor(page);
	const s = await sides(page);
	expect(Object.values(s).every(v => v.endsWith('none') || v.startsWith('0px'))).toBe(true);
});
