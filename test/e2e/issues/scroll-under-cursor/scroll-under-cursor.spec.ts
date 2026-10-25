import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';
import type { Page } from '@playwright/test';

// The note scrolling a table under a resting cursor is not the user pointing at
// it. In a long note every hover reads layout, and each read re-lays out the
// whole note, so hover work during the scroll made scrolling stutter. The table
// gets its hover once the note comes to rest, if the cursor is still on it.
const SOURCE = tableSource({
	widths: [80, 80, 80],
	rows: Array.from({ length: 6 }, (_, i) => ({ 0: `a${i}`, 1: `b${i}`, 2: `c${i}` })),
});

type Win = { RichTableReal: { watchNoteScroll(doc: Document): () => void } };

/** Puts the rendered table in the middle of a tall, scrolling note pane. */
async function placeInScrollingNote(page: Page): Promise<void> {
	await page.setViewportSize({ width: 900, height: 600 });
	await page.evaluate(() => {
		const pane = document.querySelector<HTMLElement>('.markdown-preview-view')!;
		pane.style.cssText = 'height:600px; overflow-y:auto;';
		const spacer = () => { const d = document.createElement('div'); d.style.height = '1500px'; return d; };
		pane.prepend(spacer());
		pane.append(spacer());
		(window as unknown as Win).RichTableReal.watchNoteScroll(document);
	});
}

/** Scrolls the pane in frame-sized steps, the way a wheel does. */
const scrollBy = (page: Page, dy: number, steps: number) => page.evaluate(async ({ dy, steps }) => {
	const pane = document.querySelector<HTMLElement>('.markdown-preview-view')!;
	for (let i = 0; i < steps; i++) {
		pane.scrollTop += dy;
		await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
	}
}, { dy, steps });

const stripsVisible = (page: Page) => page.locator('.bt-col-selector.bt-strip-visible').count();
const hoveredCells = (page: Page) => page.evaluate(() =>
	[...document.querySelectorAll<HTMLElement>('.bt-td, .bt-th')].filter(c => c.style.boxShadow.includes('999px')).length);
const scrollTo = (page: Page, top: number) => page.evaluate(t => {
	document.querySelector<HTMLElement>('.markdown-preview-view')!.scrollTop = t;
}, top);
/** Scroll position that puts the table's middle under the viewport's centre. */
const tableCentreTop = (page: Page) => page.evaluate(() => {
	const pane = document.querySelector<HTMLElement>('.markdown-preview-view')!;
	const r = document.querySelector('table.bt-table')!.getBoundingClientRect();
	return Math.round(pane.scrollTop + r.top + r.height / 2 - 300);
});

test('a table scrolling under a resting cursor shows no hover while the note scrolls', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await placeInScrollingNote(page);
	const centre = await tableCentreTop(page);
	await scrollTo(page, centre - 400);
	await page.mouse.move(450, 300);
	await page.waitForTimeout(300);

	await scrollBy(page, 40, 10); // the table is now under the cursor, the note still moving
	expect(await stripsVisible(page), 'hover strips appeared while the note was still scrolling').toBe(0);
	expect(await hoveredCells(page), 'cells were tinted while the note was still scrolling').toBe(0);
});

test('when the note comes to rest on the table, its hover appears', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await placeInScrollingNote(page);
	const centre = await tableCentreTop(page);
	await scrollTo(page, centre - 400);
	await page.mouse.move(450, 300);
	await page.waitForTimeout(300);

	await scrollBy(page, 40, 10);
	await expect.poll(() => stripsVisible(page), { timeout: 2000 }).toBeGreaterThan(0);
});

test('a table that only passed under the cursor has no hover once the note rests elsewhere', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await placeInScrollingNote(page);
	const centre = await tableCentreTop(page);
	await scrollTo(page, centre - 600);
	await page.mouse.move(450, 300);
	await page.waitForTimeout(300);

	await scrollBy(page, 60, 20); // past the table and beyond
	await page.waitForTimeout(400);
	expect(await stripsVisible(page)).toBe(0);
});

test('a table hovered before the note scrolls keeps working once it stops', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await placeInScrollingNote(page);
	await scrollTo(page, await tableCentreTop(page));
	await page.mouse.move(450, 300);
	await expect.poll(() => stripsVisible(page)).toBeGreaterThan(0);

	await scrollBy(page, 2, 3); // a small scroll that keeps the table under the cursor
	await page.waitForTimeout(400);
	expect(await stripsVisible(page)).toBeGreaterThan(0);
	await page.mouse.move(452, 320);
	await expect.poll(() => hoveredCells(page)).toBeGreaterThan(0);
});
