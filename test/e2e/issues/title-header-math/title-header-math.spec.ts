import { test, expect } from '../../common/test-base';

// A formula in a title or a column name is drawn as one, as in a cell; the text stays what is saved, and what editing
// shows. A name without a formula is drawn as it always was.
const SOURCE = `---
version: 2
title: "Waves ($H_s$ and $\\\\lambda_H$)"
columns:
  - { id: c_a, name: "Wave type", width: 120 }
  - { id: c_b, name: "$H_s$ (m)", width: 120 }
  - { id: c_c, name: "Price in $", width: 120, type: date }
rows:
  - { id: r_a, cells: { c_a: x, c_b: "1", c_c: "2026-01-01" } }
---
`;

test.describe('a formula in a title or a column name', () => {
	test('is drawn as a formula in the title', async ({ page, renderBlock }) => {
		await renderBlock(SOURCE);
		await expect(page.locator('.bt-table-title > span span.math')).toHaveCount(2);
		await expect(page.locator('.bt-table-title')).toContainText('Waves (');
	});

	test('is drawn as a formula in the column name, beside the type icon the column has', async ({ page, renderBlock }) => {
		await renderBlock(SOURCE.replace('{ id: c_b, name: "$H_s$ (m)", width: 120 }', '{ id: c_b, name: "$H_s$ (m)", width: 120, type: date }'));
		const head = page.locator('th[data-row="0"][data-col="1"] .bt-th-text');
		await expect(head.locator('span.math')).toHaveCount(1);
		await expect(head.locator('.bt-th-type-icon')).toHaveCount(1);
		await expect(head).toContainText('(m)');
	});

	test('the name is as wide as its text, not as wide as the cell, so its alignment still places it', { tag: '@geometry' }, async ({ page, renderBlock }) => {
		await renderBlock(SOURCE);
		const cell = page.locator('th[data-row="0"][data-col="0"]');
		const [name, room] = await Promise.all([
			cell.locator('.bt-th-name > p').evaluate(e => e.getBoundingClientRect().width),
			cell.evaluate(e => { const s = getComputedStyle(e); return e.getBoundingClientRect().width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth); }),
		]);
		expect(name, 'a short name leaves room beside it').toBeLessThan(room - 10);
	});

	test('a name with a single dollar sign, or none, is drawn as plain text', async ({ page, renderBlock }) => {
		await renderBlock(SOURCE);
		await expect(page.locator('th[data-row="0"][data-col="2"] span.math')).toHaveCount(0);
		await expect(page.locator('th[data-row="0"][data-col="2"] .bt-th-text')).toContainText('Price in $');
		await expect(page.locator('th[data-row="0"][data-col="0"] span.math')).toHaveCount(0);
	});

	test('editing shows the text that is saved, not the formula as drawn', async ({ page, renderBlock }) => {
		await renderBlock(SOURCE);
		await page.locator('th[data-row="0"][data-col="1"]').click();
		const editor = page.locator('th[data-row="0"][data-col="1"] .bt-cell-editor');
		await expect(editor).toHaveText('$H_s$ (m)');
	});

	test('the note keeps the text as written', async ({ page, renderBlock }) => {
		const b = await renderBlock(SOURCE);
		await page.locator('.bt-table-title').click();
		await page.keyboard.press('Escape');
		const note = await b.noteText();
		expect(note).toContain('$H_s$ (m)');
	});
});
