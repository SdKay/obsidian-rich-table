import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

const rows = Array.from({ length: 4 }, (_, i) => ({ 0: `a${i}`, 1: `b${i}`, 2: `c${i}` }));

test.describe('a table without a header', () => {
	test('draws no header row and starts with the first data row', async ({ page, renderBlock }) => {
		await renderBlock(tableSource({ widths: [100, 100, 100], rows, header: false }));
		expect(await page.locator('thead tr').count()).toBe(0);
		expect(await page.locator('th').count()).toBe(0);
		expect(await page.locator('tbody tr').count()).toBe(4);
		expect(await page.locator('tbody tr').first().innerText()).toContain('a0');
	});

	test('a table with a header is unchanged', async ({ page, renderBlock }) => {
		await renderBlock(tableSource({ widths: [100, 100, 100], rows }));
		expect(await page.locator('thead tr').count()).toBe(1);
		expect(await page.locator('thead th').count()).toBe(3);
	});

	test('a merge and a style that still name the header stay in the note, drawn nowhere', async ({ page, renderBlock }) => {
		const base = tableSource({ widths: [100, 100, 100], rows, header: false, styles: [{ target: 'header', bg: '#eee' }] });
		const block = await renderBlock(base.replace('styles:', 'merges:\n  - { anchor: header.c_0, end: r_1.c_1 }\nstyles:'));
		// the merge would have joined c_0 and c_1 over two rows; nothing is joined
		expect(await page.locator('tbody td[colspan], tbody td[rowspan]').count()).toBe(0);
		expect(await page.locator('tbody tr').first().locator('td').count()).toBe(3);

		await page.locator('.bt-td[data-row="2"][data-col="1"]').first().click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('edited');
		await page.keyboard.press('Enter');
		await expect.poll(() => block.noteText()).toContain('edited');
		const note = await block.noteText();
		expect(note).toContain('header.c_0');
		expect(note).toContain('target: header');
		expect(note).toContain('header: false');
	});

	test('selecting, hovering and moving by keyboard raise no error', async ({ page, renderBlock }) => {
		const errors: string[] = [];
		page.on('pageerror', e => errors.push(e.message));
		await renderBlock(tableSource({ widths: [100, 100, 100], rows, header: false, freezeRows: 1, freezeCols: 1, viewHeight: 140 }));
		await page.locator('tbody tr').nth(1).locator('td').nth(1).hover();
		await page.locator('tbody tr').nth(1).locator('td').nth(1).click();
		for (const k of ['ArrowDown', 'ArrowUp', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) await page.keyboard.press(k);
		const a = page.locator('tbody tr').nth(0).locator('td').nth(0);
		const b = page.locator('tbody tr').nth(2).locator('td').nth(2);
		await a.hover(); await page.mouse.down(); await b.hover(); await page.mouse.up();
		expect(errors).toEqual([]);
	});

	test('freezeRows counts the rows there are: the first N rows of the body are frozen', async ({ page, renderBlock }) => {
		await renderBlock(tableSource({ widths: [100, 100, 100], rows, header: false, freezeRows: 2, viewHeight: 140 }));
		const frozen = await page.locator('tbody tr:has(.bt-frozen-row)').evaluateAll(trs => trs.map(tr => tr.textContent?.slice(0, 2)));
		expect(frozen).toEqual(['a0', 'a1']);
	});

	test('with a header the same freezeRows is the header and then that many rows of the body', async ({ page, renderBlock }) => {
		await renderBlock(tableSource({ widths: [100, 100, 100], rows, freezeRows: 2, viewHeight: 140 }));
		const frozen = await page.locator('tr:has(.bt-frozen-row)').evaluateAll(trs => trs.map(tr => tr.textContent?.slice(0, 2)));
		expect(frozen).toEqual(['AB', 'a0', 'a1']);
	});

	test('the view settings switch the header row off and on, and the note records only the off state', async ({ page, renderBlock }) => {
		const block = await renderBlock(tableSource({ widths: [100, 100, 100], rows }));
		const item = () => page.evaluate(() => window.RichTableReal.ShimMenu.opened.at(-1)!.items.find(i => i.title === 'Show header row'));
		const pick = () => page.evaluate(() => window.RichTableReal.ShimMenu.opened.at(-1)!.clickItem('Show header row'));

		await page.locator('.bt-ctrl-btn[aria-label="View settings"]').click();
		expect((await item())?.checked).toBe(true);
		await pick();
		await expect.poll(() => block.noteText()).toContain('header: false');
		await block.reprocess();
		await expect.poll(() => page.locator('thead tr').count()).toBe(0);

		await page.locator('.bt-ctrl-btn[aria-label="View settings"]').click();
		expect((await item())?.checked).toBe(false);
		await pick();
		await expect.poll(() => block.noteText()).not.toContain('header: false');
		await block.reprocess();
		await expect.poll(() => page.locator('thead tr').count()).toBe(1);
	});

	test('a locked table keeps its header as it is, like its title and theme', async ({ page, renderBlock }) => {
		await renderBlock(tableSource({ widths: [100, 100, 100], rows, locked: true }));
		await expect(page.locator('.bt-ctrl-btn[aria-label="View settings"]')).toHaveCount(0);
	});

	test('the academic theme keeps its top rule, drawn on the first row of the body', async ({ page, renderBlock }) => {
		const shadowOfFirstCell = async (header: false | undefined) => {
			await renderBlock(tableSource({ widths: [100, 100], rows, header, theme: 'academic' }));
			return page.evaluate(() => getComputedStyle((document.querySelector('thead tr') ?? document.querySelector('tbody tr'))!.firstElementChild!).boxShadow);
		};
		expect(await shadowOfFirstCell(undefined)).toContain('1.5px');
		expect(await shadowOfFirstCell(false)).toContain('1.5px');
	});
});
