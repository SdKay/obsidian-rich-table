import { test, expect } from '../common/test-base';
import { buildXlsxFixtureBytes } from '../common/build-xlsx-fixture';

/**
 * XlsxFileViewer: a whole .xlsx shown read-only in a container of its own (the body of the
 * .xlsx file tab). Runs the real viewer against an in-memory vault.
 */
const PATH = 'data/book.xlsx';

const one = (grid: string[][]) => buildXlsxFixtureBytes({ sheets: [{ name: 'Sheet1', grid }] });
const two = () => buildXlsxFixtureBytes({
	sheets: [
		{ name: 'First', grid: [['A'], ['alpha']] },
		{ name: 'Second', grid: [['B'], ['beta']] },
	],
});
const cell = (page: import('@playwright/test').Page, text: string) => page.locator('.bt-td', { hasText: text });

test.describe('xlsx file view', () => {
	test('shows the workbook content in a table', async ({ page, renderXlsxFile }) => {
		await renderXlsxFile({ [PATH]: await one([['Task', 'Status'], ['Design', 'Done']]) }, PATH);
		await expect(cell(page, 'Design')).toBeVisible();
		await expect(cell(page, 'Done')).toBeVisible();
		await expect(page.locator('.bt-th', { hasText: 'Task' })).toBeVisible();
	});

	test('is read-only: no editing affordance at all', async ({ page, renderXlsxFile }) => {
		await renderXlsxFile({ [PATH]: await one([['Task'], ['Design']]) }, PATH);
		const td = cell(page, 'Design');
		await td.dblclick();
		await expect(page.locator('.bt-cell-editor')).toHaveCount(0);
		await expect(page.locator('.bt-editing')).toHaveCount(0);
		await td.hover();
		for (const sel of ['.bt-edge-add-row', '.bt-edge-add-col', '.bt-row-selector', '.bt-col-selector', '.bt-ctrl-btn']) {
			await expect(page.locator(sel)).toHaveCount(0);
		}
		await page.keyboard.type('zzz');
		await expect(cell(page, 'Design')).toHaveText('Design');
	});

	test('a multi-sheet workbook shows sheet tabs and switching sheets changes the table', async ({ page, renderXlsxFile }) => {
		await renderXlsxFile({ [PATH]: await two() }, PATH);
		await expect(cell(page, 'alpha')).toBeVisible();
		await expect(page.locator('.bt-sheet-tab')).toHaveCount(2);
		await expect(page.locator('.bt-sheet-tab-active')).toHaveText('First');

		await page.locator('.bt-sheet-tab', { hasText: 'Second' }).click();
		await expect(cell(page, 'beta')).toBeVisible();
		await expect(cell(page, 'alpha')).toHaveCount(0);
		await expect(page.locator('.bt-sheet-tab-active')).toHaveText('Second');
	});

	test('sheet tabs cannot rename, reorder or add sheets', async ({ page, renderXlsxFile }) => {
		await renderXlsxFile({ [PATH]: await two() }, PATH);
		await page.locator('.bt-sheet-tab', { hasText: 'First' }).dblclick();
		await expect(page.locator('.bt-sheet-tab-input')).toHaveCount(0);
		await expect(page.locator('.bt-sheet-tab-add')).toHaveCount(0);
	});

	test('the chosen sheet survives a refresh from disk', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await two() }, PATH);
		await page.locator('.bt-sheet-tab', { hasText: 'Second' }).click();
		await expect(cell(page, 'beta')).toBeVisible();
		await view.modify(await buildXlsxFixtureBytes({
			sheets: [{ name: 'First', grid: [['A'], ['alpha']] }, { name: 'Second', grid: [['B'], ['gamma']] }],
		}));
		await expect(cell(page, 'gamma')).toBeVisible({ timeout: 3000 });
		await expect(page.locator('.bt-sheet-tab-active')).toHaveText('Second');
	});

	test('a table taller and wider than the tab scrolls inside its own frame', { tag: '@geometry' }, async ({ page, renderXlsxFile }) => {
		await page.setViewportSize({ width: 600, height: 400 });
		const grid = Array.from({ length: 80 }, (_, r) => Array.from({ length: 30 }, (_, c) => (r === 0 ? `H${c}` : `r${r}c${c}`)));
		await renderXlsxFile({ [PATH]: await one(grid) }, PATH);
		const wrapper = page.locator('.bt-table-wrapper:not(#wrapper)');
		const dims = await wrapper.evaluate(el => ({ sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth }));
		expect(dims.sh).toBeGreaterThan(dims.ch);
		expect(dims.sw).toBeGreaterThan(dims.cw);
		const box = (await wrapper.boundingBox())!;
		expect(box.width).toBeLessThanOrEqual(600);

		await wrapper.evaluate(el => { el.scrollTop = 500; el.scrollLeft = 300; });
		const moved = await wrapper.evaluate(el => ({ t: el.scrollTop, l: el.scrollLeft }));
		expect(moved.t).toBeGreaterThan(0);
		expect(moved.l).toBeGreaterThan(0);
	});

	test('a column without a width of its own is fitted to its content next to columns that have one', { tag: '@geometry' }, async ({ page, renderXlsxFile }) => {
		await page.setViewportSize({ width: 1400, height: 800 });
		const long = 'a rather long piece of text that needs a wide column';
		const bytes = await buildXlsxFixtureBytes({
			sheets: [{ name: 'S', grid: [['Fixed', 'Auto'], ['x', long]], colWidths: { 1: 10 } }],
		});
		await renderXlsxFile({ [PATH]: bytes }, PATH);
		const auto = page.locator('.bt-td', { hasText: 'rather long' });
		await expect(auto).toBeVisible();
		const cellBox = (await auto.boundingBox())!;
		const textWidth = await auto.evaluate(el => {
			const r = document.createRange();
			r.selectNodeContents(el);
			return r.getBoundingClientRect().width;
		});
		expect(cellBox.width).toBeGreaterThanOrEqual(textWidth - 1);
	});

	test('a small table keeps its natural size instead of stretching to the tab', { tag: '@geometry' }, async ({ page, renderXlsxFile }) => {
		await page.setViewportSize({ width: 1200, height: 800 });
		await renderXlsxFile({ [PATH]: await one([['A', 'B'], ['1', '2']]) }, PATH);
		const box = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
		expect(box.width).toBeLessThan(600);
		expect(box.height).toBeLessThan(300);
	});

	test('follows an external change, collapsing a burst into the last state', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await one([['A'], ['v1']]) }, PATH);
		await expect(cell(page, 'v1')).toBeVisible();
		await view.modify(await one([['A'], ['v2']]));
		await view.modify(await one([['A'], ['v3']]));
		await expect(cell(page, 'v3')).toBeVisible({ timeout: 3000 });
		await expect(cell(page, 'v1')).toHaveCount(0);
	});

	test('keeps following the file after it is renamed', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await one([['A'], ['v1']]) }, PATH);
		await view.rename('moved/new.xlsx');
		await view.modify(await one([['A'], ['after-rename']]));
		await expect(cell(page, 'after-rename')).toBeVisible({ timeout: 3000 });
	});

	test('shows an error naming the file when it is deleted', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await one([['A'], ['x']]) }, PATH);
		await view.remove();
		await expect(page.locator('.bt-error')).toBeVisible({ timeout: 3000 });
		await expect(page.locator('.bt-error')).toContainText(PATH);
	});

	test('shows an error, not a blank tab, for a file that is not a workbook', async ({ page, renderXlsxFile }) => {
		await renderXlsxFile({ [PATH]: [1, 2, 3, 4, 5, 6, 7, 8] }, PATH);
		await expect(page.locator('.bt-error')).toBeVisible();
	});

	test('says so for a workbook with nothing to show', async ({ page, renderXlsxFile }) => {
		await renderXlsxFile({ [PATH]: await buildXlsxFixtureBytes({ sheets: [{ name: 'Empty', grid: [] }] }) }, PATH);
		await expect(page.locator('.bt-empty-workbook')).toBeVisible();
	});

	test('opening another file replaces the content and stops watching the first', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({
			[PATH]: await one([['A'], ['first-file']]),
			'data/other.xlsx': await one([['A'], ['second-file']]),
		}, PATH);
		await expect(cell(page, 'first-file')).toBeVisible();
		await view.openOther('data/other.xlsx');
		await expect(cell(page, 'second-file')).toBeVisible();
		await expect(cell(page, 'first-file')).toHaveCount(0);
		expect(await view.listenerCount()).toBe(3);
	});

	test('closing the view removes every listener it added', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await one([['A'], ['x']]) }, PATH);
		expect(await view.listenerCount()).toBe(3);
		await view.closeView();
		expect(await view.listenerCount()).toBe(0);
	});

	test('unloading the view alone, without a file close, also removes every listener', async ({ renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await one([['A'], ['x']]) }, PATH);
		expect(await view.listenerCount()).toBe(3);
		await view.unloadView();
		expect(await view.listenerCount()).toBe(0);
	});

	test('a slow render that finishes after a newer one does not overwrite it', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await one([['A'], ['old']]) }, PATH);
		await page.evaluate(() => {
			const w = window as unknown as { __btViewer: { renderLoaded(...a: unknown[]): Promise<void> } };
			const real = w.__btViewer.renderLoaded.bind(w.__btViewer);
			let calls = 0;
			w.__btViewer.renderLoaded = async (...a) => {
				const mine = ++calls;
				await real(...a);
				if (mine === 1) await new Promise(r => setTimeout(r, 600));
			};
		});
		await view.modify(await one([['A'], ['slow-stale']]));
		await page.waitForTimeout(450);
		await view.modify(await one([['A'], ['fast-new']]));
		await expect(cell(page, 'fast-new')).toBeVisible({ timeout: 4000 });
		await page.waitForTimeout(1200);
		await expect(cell(page, 'fast-new')).toBeVisible();
		await expect(cell(page, 'slow-stale')).toHaveCount(0);
	});

	test('a slow read that finishes after a newer one does not overwrite it', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await one([['A'], ['old']]) }, PATH);
		await page.evaluate(() => {
			const w = window as unknown as { __btVault: { readBinary(f: unknown): Promise<ArrayBuffer> } };
			const real = w.__btVault.readBinary.bind(w.__btVault);
			let calls = 0;
			w.__btVault.readBinary = async (f) => {
				const mine = ++calls;
				const buf = await real(f);
				if (mine === 1) await new Promise(r => setTimeout(r, 600));
				return buf;
			};
		});
		await view.modify(await one([['A'], ['slow-stale']]));
		await page.waitForTimeout(450);
		await view.modify(await one([['A'], ['fast-new']]));
		await expect(cell(page, 'fast-new')).toBeVisible({ timeout: 4000 });
		await page.waitForTimeout(1200);
		await expect(cell(page, 'fast-new')).toBeVisible();
		await expect(cell(page, 'slow-stale')).toHaveCount(0);
	});
});
