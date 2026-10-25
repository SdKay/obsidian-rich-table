import { test, expect } from '../common/test-base';
import { createWorkbook, addWorksheet } from '@office-kit/xlsx/workbook';
import { setCell, freezePanes } from '@office-kit/xlsx/worksheet';
import { saveWorkbook, toArrayBuffer } from '@office-kit/xlsx/io';

/**
 * revealCell: scrolling a search hit into view in a table that has frozen rows and columns.
 * The browser's scrollIntoView leaves a cell reached from the bottom right "visible" but under the frozen band.
 */
const PATH = 'a.xlsx';

async function book(freezeRows: number, freezeCols: number): Promise<number[]> {
	const wb = createWorkbook();
	const ws = addWorksheet(wb, 'S');
	for (let r = 1; r <= 80; r++) for (let c = 1; c <= 30; c++) setCell(ws, r, c, `r${r}c${c}`);
	if (freezeRows || freezeCols) freezePanes(ws, freezeRows, freezeCols);
	const sink = toArrayBuffer();
	await saveWorkbook(wb, sink);
	return Array.from(new Uint8Array(sink.result()));
}

type Page = import('@playwright/test').Page;

/** Bottom-right of the cell's rect must be inside the part of the port that the frozen cells do not cover. */
async function hiddenUnderFrozen(page: Page, row: number, col: number): Promise<{ visible: boolean; box: unknown }> {
	return page.evaluate(({ row, col }) => {
		const w = document.querySelector('.bt-table-wrapper:not(#wrapper)') as HTMLElement;
		const cell = w.querySelector(`[data-row="${row}"][data-col="${col}"]`) as HTMLElement;
		const c = cell.getBoundingClientRect();
		const port = w.getBoundingClientRect();
		let fl = port.left, ft = port.top;
		w.querySelectorAll('.bt-frozen-col').forEach(e => { fl = Math.max(fl, e.getBoundingClientRect().right); });
		w.querySelectorAll('.bt-frozen-row').forEach(e => { ft = Math.max(ft, e.getBoundingClientRect().bottom); });
		const eps = 1;
		const visible = c.left >= fl - eps && c.top >= ft - eps && c.right <= port.right + eps && c.bottom <= port.bottom + eps;
		return { visible, box: { cell: [c.left, c.top, c.right, c.bottom].map(Math.round), freezeEdge: [Math.round(fl), Math.round(ft)], port: [port.left, port.top, port.right, port.bottom].map(Math.round) } };
	}, { row, col });
}

async function open(page: Page, renderXlsxFile: (f: Record<string, number[]>, o: string) => Promise<unknown>, rows: number, cols: number) {
	await page.setViewportSize({ width: 700, height: 400 });
	await renderXlsxFile({ [PATH]: await book(rows, cols) }, PATH);
	await page.locator('.bt-table-wrapper:not(#wrapper)').waitFor();
}

const scrollTo = (page: Page, left: number, top: number) => page.evaluate(({ left, top }) => {
	const w = document.querySelector('.bt-table-wrapper:not(#wrapper)') as HTMLElement;
	w.scrollLeft = left; w.scrollTop = top;
}, { left, top });

test.describe('revealCell with frozen rows and columns', () => {
	test('scrolling back from the bottom right to a top-left cell leaves it fully visible, not under the frozen band', { tag: '@geometry' }, async ({ page, renderXlsxFile }) => {
		await open(page, renderXlsxFile, 2, 2);
		await scrollTo(page, 100000, 100000);
		// Data cell sheet (r10, c5): data-row 9, data-col 4 -- not frozen.
		await page.evaluate(() => {
			const R = (window as any).RichTableReal;
			R.revealCell(R.findAnchorCell(document, { row: 10, col: 5 }));
		});
		const seen = await hiddenUnderFrozen(page, 9, 4);
		expect(seen.visible, JSON.stringify(seen.box)).toBe(true);
	});

	test('the browser\'s own scrollIntoView does leave that cell under the frozen band (why a function of our own is needed)', { tag: '@geometry' }, async ({ page, renderXlsxFile }) => {
		await open(page, renderXlsxFile, 2, 2);
		await scrollTo(page, 100000, 100000);
		await page.evaluate(() => {
			(document.querySelector('[data-row="9"][data-col="4"]') as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' });
		});
		expect((await hiddenUnderFrozen(page, 9, 4)).visible).toBe(false);
	});

	test('reaching a far cell from the top left scrolls forward until it is fully inside', { tag: '@geometry' }, async ({ page, renderXlsxFile }) => {
		await open(page, renderXlsxFile, 2, 2);
		await scrollTo(page, 0, 0);
		await page.evaluate(() => {
			const R = (window as any).RichTableReal;
			R.revealCell(R.findAnchorCell(document, { row: 70, col: 25 }));
		});
		expect((await hiddenUnderFrozen(page, 69, 24)).visible).toBe(true);
	});

	test('a cell inside the frozen band is left where it is', async ({ page, renderXlsxFile }) => {
		await open(page, renderXlsxFile, 2, 2);
		await scrollTo(page, 300, 400);
		const before = await page.evaluate(() => { const w = document.querySelector('.bt-table-wrapper:not(#wrapper)') as HTMLElement; return [w.scrollLeft, w.scrollTop]; });
		await page.evaluate(() => {
			const R = (window as any).RichTableReal;
			R.revealCell(R.findAnchorCell(document, { row: 1, col: 1 })); // header, first column: frozen on both axes
		});
		const after = await page.evaluate(() => { const w = document.querySelector('.bt-table-wrapper:not(#wrapper)') as HTMLElement; return [w.scrollLeft, w.scrollTop]; });
		expect(after).toEqual(before);
	});

	test('without a frozen band a cell is still brought into view', { tag: '@geometry' }, async ({ page, renderXlsxFile }) => {
		await open(page, renderXlsxFile, 0, 0);
		await scrollTo(page, 100000, 100000);
		await page.evaluate(() => {
			const R = (window as any).RichTableReal;
			R.revealCell(R.findAnchorCell(document, { row: 3, col: 2 }));
		});
		expect((await hiddenUnderFrozen(page, 2, 1)).visible).toBe(true);
	});

	test('maps sheet coordinates to the rendered cell: row 1 is the header, columns count from 1', async ({ page, renderXlsxFile }) => {
		await open(page, renderXlsxFile, 0, 0);
		const text = (row: number, col: number) => page.evaluate(({ row, col }) => {
			const R = (window as any).RichTableReal;
			return R.findAnchorCell(document, { row, col })?.textContent ?? null;
		}, { row, col });
		expect(await text(1, 1)).toBe('r1c1');
		expect(await text(4, 3)).toBe('r4c3');
		expect(await text(999, 1)).toBe(null);
	});
});
