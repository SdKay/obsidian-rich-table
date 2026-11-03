import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// What follows the layout is written on the elements that read it, not on an ancestor of the table: a
// custom property on an ancestor is inherited by every cell, and changing it makes all of them work out
// their style again, which while a column is dragged is the bulk of each frame.
const SOURCE = tableSource({ widths: [90, 90, 90], rows: Array.from({ length: 4 }, (_, r) => ({ 0: `a${r}`, 1: `b${r}`, 2: `c${r}` })) });

test('the frame\'s box is not set on an element that holds the table', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await page.locator('table.bt-table').hover();
	await page.waitForTimeout(200);
	const onAncestors = await page.evaluate(() => {
		const table = document.querySelector('table.bt-table') as HTMLElement;
		const found: string[] = [];
		for (let el: HTMLElement | null = table; el; el = el.parentElement) {
			for (const p of ['--of-l', '--of-t', '--of-w', '--of-h', '--bt-tbl-w', '--bt-tbl-h']) {
				if (el.style.getPropertyValue(p)) found.push(`${el.className || el.tagName}: ${p}`);
			}
		}
		return found;
	});
	expect(onAncestors).toEqual([]);
});

test('dragging a column edge does not rewrite the root\'s style on every move', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await page.locator('table.bt-table').hover();
	await page.waitForTimeout(300);
	const handle = page.locator('.bt-col-selector .bt-sel-resize-col').nth(1);
	const box = (await handle.boundingBox())!;
	await page.evaluate(() => {
		const root = document.querySelector('.bt-render-root') as HTMLElement;
		const w = window as unknown as { __writes: number };
		w.__writes = 0;
		// Counts the moves on which the root's style was changed at all: any change to it, whichever
		// property, makes every cell below it recompute its style.
		new MutationObserver(records => { if (records.length) w.__writes++; })
			.observe(root, { attributes: true, attributeFilter: ['style'] });
	});
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	for (let i = 1; i <= 15; i++) await page.mouse.move(box.x + box.width / 2 + i * 4, box.y + box.height / 2);
	await page.mouse.up();
	await page.waitForTimeout(200);
	const writes = await page.evaluate(() => (window as unknown as { __writes: number }).__writes);
	expect(writes, 'the root\'s style was rewritten on most moves').toBeLessThanOrEqual(1);
});
