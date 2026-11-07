import { test, expect } from '../../common/test-base';
import type { Page } from '@playwright/test';

// Dragging a column border changes the widths, and a narrower column wraps its text onto more lines, so its row
// grows (a wider one unwraps and the row shrinks). The row number strip on the left must follow the rows, however
// the drag changed them, while the strip itself is only redrawn for what moved.
const LONG = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';

function source(extra: string, rows = 12): string {
	const L = ['---', 'version: 2', 'columns:', '  - { id: c_0, name: A, width: 90 }', '  - { id: c_1, name: B, width: 260 }', '  - { id: c_2, name: C, width: 90 }', 'rows:'];
	for (let r = 0; r < rows; r++) L.push(`  - { id: r_${r}, cells: { c_0: r${r}, c_1: "${r % 3 === 1 ? LONG : 'short'}", c_2: x${r} } }`);
	if (extra) L.push(extra);
	L.push('---', '| A |', '| --- |', '');
	return L.join('\n');
}

/** Drags column B's right border by `dx` with pointer events from the page, and waits for the frames to settle. */
async function drag(page: Page, dx: number): Promise<void> {
	await page.evaluate(async (dx) => {
		const handle = document.querySelectorAll('.bt-col-selector .bt-sel-resize-col')[1] as HTMLElement;
		const rect = handle.getBoundingClientRect();
		const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
		const frame = () => new Promise<void>(res => requestAnimationFrame(() => res()));
		handle.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
		await frame();
		const steps = 8;
		for (let i = 1; i <= steps; i++) {
			handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: x + (dx * i) / steps, clientY: y, bubbles: true, cancelable: true }));
			await frame();
		}
		await frame(); await frame();
		// Held, not released: the strip is checked while the drag is on, as the user sees it.
		(window as unknown as { __release: () => void }).__release = () =>
			handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: x + dx, clientY: y, bubbles: true, cancelable: true }));
	}, dx);
}

/** For every data row: how far its number cell is from the row itself, in px (top and height both). */
async function rowStripError(page: Page): Promise<{ worstTop: number; worstHeight: number; rows: number }> {
	return page.evaluate(() => {
		const cells = Array.from(document.querySelectorAll<HTMLElement>('.bt-row-selector .bt-sel-cell[data-idx]'));
		let worstTop = 0, worstHeight = 0, rows = 0;
		for (const c of cells) {
			const idx = c.dataset.idx!;
			const td = document.querySelector<HTMLElement>(`table.bt-table td[data-row="${idx}"][data-col="0"], table.bt-table th[data-row="${idx}"][data-col="0"]`);
			if (!td) continue;
			const a = c.getBoundingClientRect(), b = td.closest('tr')!.getBoundingClientRect();
			worstTop = Math.max(worstTop, Math.abs(a.top - b.top));
			worstHeight = Math.max(worstHeight, Math.abs(a.height - b.height));
			rows++;
		}
		return { worstTop, worstHeight, rows };
	});
}

/**
 * A number cell and its row differ by a fixed border's worth of pixels (the row's box includes a collapsed
 * border), so the strip is checked to have kept that same distance from its row after the drag, not to be equal to it.
 * A strip left as it was built would be off by the whole change in the row's height, tens of pixels.
 */
function expectFollowed(before: { worstTop: number; worstHeight: number }, after: { worstTop: number; worstHeight: number }): void {
	expect(Math.abs(after.worstTop - before.worstTop), 'row strip tops follow the rows').toBeLessThanOrEqual(1);
	expect(Math.abs(after.worstHeight - before.worstHeight), 'row strip heights follow the rows').toBeLessThanOrEqual(1);
}

const hoverTable = async (page: Page) => {
	await page.locator('td[data-row="2"][data-col="0"]').hover();
	await page.locator('.bt-row-selector.bt-strip-visible').waitFor();
	await page.waitForTimeout(150);
};

for (const [name, extra] of [
	['a plain table', ''],
	['a table with merged cells', 'merges:\n  - { anchor: r_2.c_0, end: r_4.c_0 }\n  - { anchor: r_6.c_2, end: r_7.c_2 }'],
] as const) {
	test(`${name}: narrowing a column so its text wraps keeps the row strip on the rows @geometry`, { tag: '@geometry' }, async ({ page, renderBlock }) => {
		await page.setViewportSize({ width: 1200, height: 800 });
		await renderBlock(source(extra));
		await hoverTable(page);
		const before = await rowStripError(page);
		expect(before.rows, 'row strip cells before').toBeGreaterThan(5);

		const heightBefore = await page.evaluate(() => document.querySelector<HTMLElement>('table.bt-table td[data-row="2"][data-col="1"]')!.closest('tr')!.getBoundingClientRect().height);
		await drag(page, -200);
		const heightAfter = await page.evaluate(() => document.querySelector<HTMLElement>('table.bt-table td[data-row="2"][data-col="1"]')!.closest('tr')!.getBoundingClientRect().height);
		expect(heightAfter, 'the narrowed column made a row taller').toBeGreaterThan(heightBefore + 20);

		const during = await rowStripError(page);
		expectFollowed(before, during);
		await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
	});

	test(`${name}: widening a column so its text unwraps keeps the row strip on the rows @geometry`, { tag: '@geometry' }, async ({ page, renderBlock }) => {
		await page.setViewportSize({ width: 1200, height: 800 });
		await renderBlock(source(extra).replace('width: 260', 'width: 110'));
		await hoverTable(page);
		const before = await rowStripError(page);
		const heightBefore = await page.evaluate(() => document.querySelector<HTMLElement>('table.bt-table td[data-row="2"][data-col="1"]')!.closest('tr')!.getBoundingClientRect().height);
		await drag(page, 400);
		const heightAfter = await page.evaluate(() => document.querySelector<HTMLElement>('table.bt-table td[data-row="2"][data-col="1"]')!.closest('tr')!.getBoundingClientRect().height);
		expect(heightAfter, 'the widened column made a row shorter').toBeLessThan(heightBefore - 20);

		const during = await rowStripError(page);
		expectFollowed(before, during);
		await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
	});
}

// A column drag that moves no row leaves the row strip's cells alone: with hundreds of rows, redrawing them on every
// move made a drag run at a fraction of the frame rate.
test('a column drag that moves no row does not redraw the row strip', async ({ page, renderBlock }) => {
	await page.setViewportSize({ width: 1200, height: 800 });
	// Short text everywhere, so no width the drag reaches makes any row wrap.
	const short = ['---', 'version: 2', 'columns:', '  - { id: c_0, name: A, width: 90 }', '  - { id: c_1, name: B, width: 160 }', '  - { id: c_2, name: C, width: 90 }', 'rows:',
		...Array.from({ length: 40 }, (_, r) => `  - { id: r_${r}, cells: { c_0: r${r}, c_1: ok, c_2: x${r} } }`), '---', '| A |', '| --- |', ''].join('\n');
	await renderBlock(short);
	await hoverTable(page);
	await page.evaluate(() => {
		const w = window as unknown as { __removed: number };
		w.__removed = 0;
		new MutationObserver(list => { for (const m of list) w.__removed += Array.from(m.removedNodes).filter(n => (n as HTMLElement).classList?.contains('bt-sel-cell')).length; })
			.observe(document.querySelector('.bt-row-selector')!, { subtree: true, childList: true });
	});
	await drag(page, -50);
	const removedDuring = await page.evaluate(() => (window as unknown as { __removed: number }).__removed);
	await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
	expect(removedDuring, 'row strip cells removed while a column was dragged').toBe(0);
});
