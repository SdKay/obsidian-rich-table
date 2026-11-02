import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Rebuilding the column and row strips reads the table's geometry, then draws. A read that comes after a
// write makes the browser lay the table out again, and when that happens once per column and row the
// rebuild grows with the size of the table: it took a quarter of a second after every key typed.
const COLS = 12;
const ROWS = 30;
const SOURCE = tableSource({
	widths: Array.from({ length: COLS }, () => 0),
	rows: Array.from({ length: ROWS }, (_, r) => Object.fromEntries(Array.from({ length: COLS }, (_, c) => [c, `r${r}c${c}`]))),
});

test('building the strips lays the table out a handful of times, however large it is', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	const layouts = await page.evaluate(async () => {
		const table = document.querySelector('table.bt-table') as HTMLElement;
		// A read counts as a layout when something was written to the page since the previous read.
		let dirty = false;
		let layouts = 0;
		const mark = () => { dirty = true; };
		const observer = new MutationObserver(mark);
		const root = table.closest('.bt-render-root') as HTMLElement;
		observer.observe(root, { subtree: true, childList: true, attributes: true });
		const proto = Element.prototype;
		const read = proto.getBoundingClientRect;
		proto.getBoundingClientRect = function (this: Element) {
			// Records are delivered after the callback, so look at them now.
			if (observer.takeRecords().length > 0) dirty = true;
			if (dirty) { layouts++; dirty = false; }
			return read.call(this);
		};
		// Hovering shows the strips and builds them.
		table.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
		table.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
		proto.getBoundingClientRect = read;
		observer.disconnect();
		return layouts;
	});
	// One per column and row would be at least COLS + ROWS; the strips take a few however large the table is.
	expect(layouts, 'layouts forced while the strips were built').toBeLessThan((COLS + ROWS) / 2);
});
