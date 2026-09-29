import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';
import type { Page } from '@playwright/test';

const SOURCE = tableSource({
	widths: [60, 60, 60, 60],
	rows: [0, 1, 2, 3].map(i => ({ 0: `a${i}`, 1: `b${i}`, 2: `c${i}`, 3: `d${i}` })),
});

async function hoverTable(page: Page) {
	const box = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page.locator('.bt-col-selector.bt-strip-visible')).toHaveCount(1);
}
const center = async (page: Page, sel: string) => {
	const b = (await page.locator(sel).boundingBox())!;
	return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const ops = (page: Page) => page.evaluate(() => (window as unknown as { __btOps: { type: string }[] }).__btOps);

async function selectCols(page: Page, from: number, to: number) {
	const a = await center(page, `.bt-col-selector [data-idx="${from}"]`);
	const b = await center(page, `.bt-col-selector [data-idx="${to}"]`);
	await page.mouse.move(a.x, a.y);
	await page.mouse.down();
	await page.mouse.move(b.x, b.y, { steps: 4 });
	await page.mouse.up();
	await expect(page.locator('.bt-cell-panel')).toBeVisible();
}

test.describe('long-press reorder', () => {
	test('long-pressing a selected column block and dragging it right dispatches one move-cols', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await hoverTable(page);
		await selectCols(page, 0, 1);

		const from = await center(page, '.bt-col-selector [data-idx="1"]');
		const to = await center(page, '.bt-col-selector [data-idx="3"]');
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.waitForTimeout(450);
		await expect(page.locator('.bt-table.bt-reordering-col')).toHaveCount(1);
		await page.mouse.move(to.x + 80, to.y, { steps: 6 });

		const lifted = page.locator('.bt-table .bt-reorder-lifted');
		expect(await lifted.count()).toBeGreaterThan(0);
		await page.mouse.up();

		expect(await ops(page)).toEqual([{ type: 'move-cols', colIds: ['c_0', 'c_1'], beforeColId: null }]);
	});

	test('the other columns slide aside while the block is dragged', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await hoverTable(page);
		await selectCols(page, 0, 0);

		const from = await center(page, '.bt-col-selector [data-idx="0"]');
		const to = await center(page, '.bt-col-selector [data-idx="2"]');
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.waitForTimeout(450);
		await page.mouse.move(to.x, to.y, { steps: 6 });
		await page.waitForTimeout(250);

		const cellB = page.locator('.bt-table th[data-col="1"]');
		const shift = await cellB.evaluate(el => getComputedStyle(el).transform);
		expect(shift).not.toBe('none');
		await page.mouse.up();
	});

	test('dragging rows down dispatches move-rows with the selected rows in order', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await hoverTable(page);
		const r1 = await center(page, '.bt-row-selector [data-idx="1"]');
		const r2 = await center(page, '.bt-row-selector [data-idx="2"]');
		await page.mouse.move(r1.x, r1.y);
		await page.mouse.down();
		await page.mouse.move(r2.x, r2.y, { steps: 4 });
		await page.mouse.up();
		await expect(page.locator('.bt-cell-panel')).toBeVisible();

		await page.mouse.move(r2.x, r2.y);
		await page.mouse.down();
		await page.waitForTimeout(450);
		const r4 = await center(page, '.bt-row-selector [data-idx="4"]');
		await page.mouse.move(r4.x, r4.y + 80, { steps: 6 });
		await page.mouse.up();

		expect(await ops(page)).toEqual([{ type: 'move-rows', rowIds: ['r_0', 'r_1'], beforeRowId: null }]);
	});

	test('a short press on a selected strip behaves like before: no reorder, panel reopens', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await hoverTable(page);
		await selectCols(page, 0, 1);
		const c = await center(page, '.bt-col-selector [data-idx="1"]');
		await page.mouse.move(c.x, c.y);
		await page.mouse.down();
		await page.mouse.up();
		await expect(page.locator('.bt-cell-panel')).toBeVisible();
		expect(await ops(page)).toEqual([]);
	});

	test('pressing on a selected strip then moving before the delay turns into a normal range select', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await hoverTable(page);
		await selectCols(page, 0, 0);
		const a = await center(page, '.bt-col-selector [data-idx="0"]');
		const b = await center(page, '.bt-col-selector [data-idx="2"]');
		await page.mouse.move(a.x, a.y);
		await page.mouse.down();
		await page.mouse.move(b.x, b.y, { steps: 5 });
		await page.mouse.up();
		await expect(page.locator('.bt-cell-panel')).toBeVisible();
		await expect(page.locator('.bt-table.bt-reordering')).toHaveCount(0);
		expect(await ops(page)).toEqual([]);
	});

	const GRID = (extra: object = {}) => tableSource({
		widths: [60, 60, 60, 60],
		rows: [0, 1, 2, 3].map(i => ({ 0: `a${i}`, 1: `b${i}`, 2: `c${i}`, 3: `d${i}` })),
		...extra,
	} as never);

	async function selectRows(page: Page, from: number, to: number) {
		const a = await center(page, `.bt-row-selector [data-idx="${from}"]`);
		const b = await center(page, `.bt-row-selector [data-idx="${to}"]`);
		await page.mouse.move(a.x, a.y);
		await page.mouse.down();
		await page.mouse.move(b.x, b.y, { steps: 4 });
		await page.mouse.up();
		await expect(page.locator('.bt-cell-panel')).toBeVisible();
	}
	async function longPressDrag(page: Page, strip: string, dx: number, dy: number) {
		const p = await center(page, strip);
		await page.mouse.move(p.x, p.y);
		await page.mouse.down();
		await page.waitForTimeout(450);
		await page.mouse.move(p.x + dx, p.y + dy, { steps: 8 });
		await page.mouse.up();
	}

	test('frozen columns do not stop rows from being reordered', async ({ page, renderFull }) => {
		await renderFull(GRID({ freezeCols: 1 }));
		await hoverTable(page);
		await selectRows(page, 1, 1);
		await longPressDrag(page, '.bt-row-selector [data-idx="1"]', 0, 90);
		expect(await ops(page)).toEqual([{ type: 'move-rows', rowIds: ['r_0'], beforeRowId: null }]);
	});

	test('frozen rows do not stop columns from being reordered', async ({ page, renderFull }) => {
		await renderFull(GRID({ freezeRows: 1 }));
		await hoverTable(page);
		await selectCols(page, 1, 1);
		await longPressDrag(page, '.bt-col-selector [data-idx="1"]', 100, 0);
		expect(await ops(page)).toEqual([{ type: 'move-cols', colIds: ['c_1'], beforeColId: null }]);
	});

	test('columns right of the frozen ones can be reordered among themselves', async ({ page, renderFull }) => {
		await renderFull(GRID({ freezeCols: 1 }));
		await hoverTable(page);
		await selectCols(page, 2, 2);
		await longPressDrag(page, '.bt-col-selector [data-idx="2"]', 90, 0);
		expect(await ops(page)).toEqual([{ type: 'move-cols', colIds: ['c_2'], beforeColId: null }]);
	});

	test('a block cannot be dragged into the frozen columns', async ({ page, renderFull }) => {
		await renderFull(GRID({ freezeCols: 1 }));
		await hoverTable(page);
		await selectCols(page, 2, 2);
		await longPressDrag(page, '.bt-col-selector [data-idx="2"]', -400, 0);
		expect(await ops(page)).toEqual([{ type: 'move-cols', colIds: ['c_2'], beforeColId: 'c_1' }]);
	});

	test('a frozen column itself does not lift, and says why', async ({ page, renderBlock }) => {
		const block = await renderBlock(GRID({ freezeCols: 1 }));
		await hoverTable(page);
		await selectCols(page, 0, 0);
		const p = await center(page, '.bt-col-selector [data-idx="0"]');
		await page.mouse.move(p.x, p.y);
		await page.mouse.down();
		await page.waitForTimeout(450);
		await expect(page.locator('.bt-table.bt-reordering')).toHaveCount(0);
		await expect.poll(async () => (await block.getNotices()).join('|')).toMatch(/frozen/i);
		await page.mouse.up();
	});

	test('a block covering a merged row span moves as a whole, and the merge rides along', async ({ page, renderFull }) => {
		await renderFull(GRID({ merges: [[1, 0, 2, 0]] }));
		await hoverTable(page);
		await selectRows(page, 2, 3);
		await longPressDrag(page, '.bt-row-selector [data-idx="3"]', 0, 90);
		expect(await ops(page)).toEqual([{ type: 'move-rows', rowIds: ['r_1', 'r_2'], beforeRowId: null }]);
	});

	test('a merged row span is never split by the drop position', async ({ page, renderFull }) => {
		await renderFull(GRID({ merges: [[2, 0, 3, 0]] }));
		await hoverTable(page);
		await selectRows(page, 1, 1);
		await longPressDrag(page, '.bt-row-selector [data-idx="1"]', 0, 75);
		const [op] = await ops(page) as { type: string; beforeRowId: string | null }[];
		expect(op!.type).toBe('move-rows');
		expect(['r_2', null]).toContain(op!.beforeRowId);
	});

	test('a merge in the other direction does not restrict this axis', async ({ page, renderFull }) => {
		await renderFull(GRID({ merges: [[0, 0, 0, 1]] }));
		await hoverTable(page);
		await selectRows(page, 2, 2);
		await longPressDrag(page, '.bt-row-selector [data-idx="2"]', 0, 60);
		expect((await ops(page)).map(o => o.type)).toEqual(['move-rows']);
	});

	for (const [name, axis, blockedSource, notice] of [
		['a selection that cuts a merged row span', 'row', GRID({ merges: [[0, 0, 1, 0]] }), /merged/i],
		['a selection that cuts a merged column span', 'col', GRID({ merges: [[0, 0, 0, 1]] }), /merged/i],
	] as const)
		test(`${name} does not lift and says why`, async ({ page, renderBlock }) => {
			const block = await renderBlock(blockedSource);
			await hoverTable(page);
			const sel = axis === 'row' ? '.bt-row-selector [data-idx="2"]' : '.bt-col-selector [data-idx="1"]';
			const r = await center(page, sel);
			await page.mouse.move(r.x, r.y);
			await page.mouse.down();
			await page.mouse.up();
			await expect(page.locator('.bt-cell-panel')).toBeVisible();
			await page.mouse.move(r.x, r.y);
			await page.mouse.down();
			await page.waitForTimeout(450);
			await expect(page.locator('.bt-table.bt-reordering')).toHaveCount(0);
			await expect.poll(async () => (await block.getNotices()).join('|')).toMatch(notice);
			await page.mouse.up();
		});

	test('the note is rewritten in the new order and the rebuilt table keeps it', async ({ page, renderBlock }) => {
		const block = await renderBlock(`---
version: 2
columns:
  - { id: c_0, name: A, width: 60 }
  - { id: c_1, name: B, width: 60 }
  - { id: c_2, name: C, width: 60 }
rows:
  - { id: r_0, cells: { c_0: a, c_1: b, c_2: c } }
---
`);
		await hoverTable(page);
		await selectCols(page, 0, 0);
		const from = await center(page, '.bt-col-selector [data-idx="0"]');
		const to = await center(page, '.bt-col-selector [data-idx="2"]');
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.waitForTimeout(450);
		await page.mouse.move(to.x + 40, to.y, { steps: 8 });
		await page.mouse.up();

		await expect.poll(() => block.noteText()).toMatch(/name: B[\s\S]*name: C[\s\S]*name: A/);
		const headers = () => page.locator('.bt-table th[data-col] .bt-th-text').allTextContents();
		const visualOrder = () => page.locator('.bt-table th[data-col]').evaluateAll(
			ths => ths.map(t => ({ n: t.textContent, x: t.getBoundingClientRect().left })).sort((a, b) => a.x - b.x).map(t => t.n));
		await expect.poll(visualOrder).toEqual(['B', 'C', 'A']);
		await block.reprocess();
		await expect.poll(headers).toEqual(['B', 'C', 'A']);
		await expect(page.locator('.bt-table.bt-reordering')).toHaveCount(0);
	});
});
