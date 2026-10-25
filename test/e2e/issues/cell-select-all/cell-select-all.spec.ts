import { test, expect } from '../../common/test-base';
import { scrollableTable } from '../../common/fixtures';

// Ctrl+A while a cell is being edited selects everything in that cell only.
// The editor opens with its text already selected, so the case that proves
// anything is pressing it with the caret inside the text.
test.describe('cell-select-all', () => {
	const SOURCE = scrollableTable({ theme: 'grid' });
	const CELL = '.bt-td[data-row="1"][data-col="0"]';

	const selected = (page: import('@playwright/test').Page) =>
		page.evaluate(() => window.getSelection()?.toString() ?? '');

	test('Ctrl+A with the caret inside the text selects the whole cell content', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator(CELL).first().click();
		await expect.poll(() => page.locator(`${CELL}.bt-editing`).count()).toBe(1);
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowLeft');
		expect(await selected(page), 'the caret should be collapsed before the shortcut').toBe('');

		await page.keyboard.press('Control+a');

		expect(await selected(page)).toBe('a1');
		await expect(page.locator(`${CELL}.bt-editing`)).toHaveCount(1);
	});

	test('it selects only the edited cell, not the table or the page', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator(CELL).first().click();
		await expect.poll(() => page.locator(`${CELL}.bt-editing`).count()).toBe(1);
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('Control+a');
		expect(await selected(page)).not.toContain('a2');
	});
});
