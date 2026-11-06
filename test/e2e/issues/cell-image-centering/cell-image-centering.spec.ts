import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// An image in a cell sits in the middle of the cell, top to bottom. Obsidian renders it as an inline
// element inside the cell's paragraph, and an inline image rests on the text baseline, which leaves the
// strip below a line of text under it: the image then sat higher than the middle of its cell.
const SOURCE = tableSource({ widths: [120, 120], rows: [{ 0: 'x', 1: 'y' }, { 0: 'a', 1: 'b' }] });

// 20px is smaller than the row's text line, so the row is not made taller by the image and the difference
// shows; a tall image would fill the cell and hide it.
const IMAGE = '<span class="image-embed"><img width="20" height="20" alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></span>';

const gaps = (page: import('@playwright/test').Page) => page.evaluate((html) => {
	const cell = document.querySelector('td[data-row="1"][data-col="1"]') as HTMLElement;
	cell.querySelector('p')!.innerHTML = html;
	const cr = cell.getBoundingClientRect();
	const ir = cell.querySelector('img')!.getBoundingClientRect();
	const cs = getComputedStyle(cell);
	return {
		above: ir.top - cr.top - parseFloat(cs.paddingTop) - parseFloat(cs.borderTopWidth),
		below: cr.bottom - ir.bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth),
	};
}, IMAGE);

test('an image in a cell has the same room above and below it', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	const g = await gaps(page);
	expect(Math.abs(g.above - g.below)).toBeLessThanOrEqual(1);
});
