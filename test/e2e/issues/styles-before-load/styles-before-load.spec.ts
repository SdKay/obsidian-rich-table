import fs from 'node:fs';
import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Obsidian runs a plugin's onload and only then reads its styles.css: a note that is already open gets
// its tables drawn in between, with nothing styling them. Until the stylesheet is there, a table is
// not shown at all, rather than as a bare grid of cells that turns into the table a moment later.
const SOURCE = tableSource({ widths: [90, 120], rows: [{ 0: 'a', 1: 'b' }, { 0: 'c', 1: 'd' }] });

const visibility = (page: import('@playwright/test').Page) => page.locator('.bt-render-root-shell').first().evaluate(el => getComputedStyle(el).visibility);

test('a table drawn before the stylesheet is loaded is hidden until it is', async ({ page, renderFull }) => {
	// The plugin's own stylesheet is left out of the page, as it is while Obsidian has not read it yet.
	await page.route('**/styles.css', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
	await renderFull(SOURCE);
	expect(await visibility(page), 'the table showed without its stylesheet').toBe('hidden');

	await page.unroute('**/styles.css');
	await page.addStyleTag({ path: 'styles.css' });
	expect(await visibility(page), 'the table stayed hidden once its stylesheet was there').toBe('visible');
});

test('a table drawn with the stylesheet in place is shown at once', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	expect(await visibility(page)).toBe('visible');
});

test('the hover-only toolbar and scrollbar do not flash when the stylesheet arrives', async ({ page, renderFull }) => {
	await page.route('**/styles.css', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
	await renderFull(SOURCE);
	await page.mouse.move(2, 2);
	await page.unroute('**/styles.css');
	const css = fs.readFileSync('styles.css', 'utf8');
	const seen = await page.evaluate(async (css) => {
		const shell = document.querySelector('.bt-render-root-shell') as HTMLElement;
		const opacity = (sel: string) => { const e = document.querySelector(sel) as HTMLElement | null; return e ? Number(getComputedStyle(e).opacity) : 0; };
		const style = document.createElement('style');
		style.textContent = css;
		document.head.appendChild(style);
		const frames: string[] = [];
		for (let i = 0; i < 10; i++) {
			// What is on screen in this frame: anything in a hidden shell is not.
			if (getComputedStyle(shell).visibility === 'visible') {
				const ctrl = opacity('.bt-ctrl-col');
				const scroll = opacity('.bt-view-scroll');
				if (ctrl > 0 || scroll > 0) frames.push(`frame ${i}: toolbar ${ctrl.toFixed(2)}, scrollbar ${scroll.toFixed(2)}`);
			}
			await new Promise(r => requestAnimationFrame(r));
		}
		return frames;
	}, css);
	expect(seen, 'the toolbar or the scrollbar was visible without the pointer over the table').toEqual([]);
});

// An auto column is measured once the stylesheet styles it: measured before, with no padding and another
// font, it came out narrow and stayed so, wrapping text that fits on one line.
const AUTO = `---
version: 2
columns:
  - { id: c_a, name: A, width: 90 }
  - { id: c_b, name: B }
  - { id: c_c, name: C, width: 144 }
rows:
  - id: r_1
    cells: { c_a: a, c_b: "a cell of text that fits on one line", c_c: c }
---
`;
const autoWidth = (page: import('@playwright/test').Page) => page.locator('table.bt-table col[data-col="1"]').evaluate(c => Math.round(c.getBoundingClientRect().width));

test('an auto column comes out as wide when the stylesheet arrives after the table', { tag: '@geometry' }, async ({ page, renderBlock }) => {
	await renderBlock(AUTO);
	await page.waitForTimeout(300);
	const expected = await autoWidth(page);

	await page.route('**/styles.css', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
	await renderBlock(AUTO);
	await page.waitForTimeout(300);
	await page.unroute('**/styles.css');
	await page.addStyleTag({ path: 'styles.css' });
	await expect.poll(() => autoWidth(page), { timeout: 2000 }).toBe(expected);
});

// The frame was left at the height the table had while the stylesheet was still being applied, with
// empty space under the status bar.
test('the outer frame fits the table when the stylesheet arrives after it', { tag: '@geometry' }, async ({ page, renderBlock }) => {
	const frameFit = (p: typeof page) => p.evaluate(() => {
		const shell = document.querySelector('.bt-render-root-shell') as HTMLElement;
		const frame = shell.querySelector(':scope > .bt-outer-frame') as HTMLElement;
		const s = shell.getBoundingClientRect();
		const f = frame.getBoundingClientRect();
		return { top: Math.round(f.top - s.top), bottom: Math.round(f.bottom - s.bottom) };
	});
	await page.route('**/styles.css', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
	await renderBlock(SOURCE);
	await page.waitForTimeout(300);
	await page.unroute('**/styles.css');
	await page.addStyleTag({ path: 'styles.css' });
	await page.waitForTimeout(300);
	expect(await frameFit(page)).toEqual({ top: 0, bottom: 0 });
});
