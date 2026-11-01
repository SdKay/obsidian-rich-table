import { test, expect } from '../common/test-base';
import { buildXlsxFixtureBytes } from '../common/build-xlsx-fixture';

// The .xlsx tab is read-only, but what it shows can be selected with the mouse and copied.
const PATH = 'data/book.xlsx';
const GRID = [['Task', 'Status', 'Owner'], ['Design', 'Done', 'Ann'], ['Build', 'Open', 'Bob']];

type P = import('@playwright/test').Page;
const dragFrom = async (page: P, from: string, to: string) => {
	const a = (await page.locator('.bt-th, .bt-td', { hasText: from }).first().boundingBox())!;
	const b = (await page.locator('.bt-th, .bt-td', { hasText: to }).first().boundingBox())!;
	await page.mouse.move(a.x + 4, a.y + a.height / 2);
	await page.mouse.down();
	await page.mouse.move(b.x + b.width - 4, b.y + b.height / 2, { steps: 8 });
	await page.mouse.up();
};

test.describe('xlsx file view: select and copy', () => {
	test('dragging over cells selects their text', async ({ page, renderXlsxFile }) => {
		await renderXlsxFile({ [PATH]: await buildXlsxFixtureBytes({ sheets: [{ name: 'S', grid: GRID }] }) }, PATH);
		await dragFrom(page, 'Design', 'Done');
		const selected = await page.evaluate(() => getSelection()!.toString());
		expect(selected).toContain('Design');
		expect(selected).toContain('Done');
	});

	test('Ctrl+C puts the selected text on the clipboard', async ({ page, context, renderXlsxFile }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await renderXlsxFile({ [PATH]: await buildXlsxFixtureBytes({ sheets: [{ name: 'S', grid: GRID }] }) }, PATH);
		await dragFrom(page, 'Design', 'Done');
		await page.keyboard.press('Control+c');
		const clip = await page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('Design');
		expect(clip).toContain('Done');
	});
});
