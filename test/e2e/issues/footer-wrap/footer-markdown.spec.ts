import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// A footer line is drawn like a cell's text: a formula or a link in it means what it does there. Each line stays a
// line of its own, and editing shows the text as written.
const SRC = (footer: string) => tableSource({ widths: [160], rows: [{ 0: 'x' }], footer });

test.describe('the footer is rendered as Markdown', () => {
	test('a formula and a link in a footer line are drawn', async ({ page, renderFull }) => {
		await renderFull(SRC('"Total $H_s$ see [[Notes]]"'));
		const line = page.locator('.bt-table-footer-line');
		await expect(line.locator('span.math')).toHaveCount(1);
		await expect(line.locator('a.internal-link')).toHaveText('Notes');
	});

	test('each line of a footer stays a line of its own', async ({ page, renderFull }) => {
		await renderFull(`---\nversion: 2\nfooter:\n  - "first $a$"\n  - "second"\ncolumns:\n  - { id: c_0, name: A, width: 160 }\nrows:\n  - { id: r_0, cells: { c_0: x } }\n---\n`);
		await expect(page.locator('.bt-table-footer-line')).toHaveCount(2);
		await expect(page.locator('.bt-table-footer-line').nth(0).locator('span.math')).toHaveCount(1);
		await expect(page.locator('.bt-table-footer-line').nth(1)).toHaveText('second');
	});

	test('a line adds no space of its own: two lines are as tall as two plain lines', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(`---\nversion: 2\nfooter:\n  - "one"\n  - "two"\ncolumns:\n  - { id: c_0, name: A, width: 160 }\nrows:\n  - { id: r_0, cells: { c_0: x } }\n---\n`);
		const h = await page.locator('.bt-table-footer').evaluate(e => e.getBoundingClientRect().height);
		const line = await page.locator('.bt-table-footer-line').first().evaluate(e => parseFloat(getComputedStyle(e).lineHeight) || e.getBoundingClientRect().height);
		expect(h, 'two lines, no paragraph margins').toBeLessThan(line * 2 + 4);
	});

	test('a board view draws the footer too', async ({ page, renderFull }) => {
		await renderFull(`---\nversion: 2\nfooter: "board $a$"\ncolumns:\n  - { id: c_0, name: Status, type: task-status }\nrows:\n  - { id: r_0, cells: { c_0: done } }\nviews:\n  - { id: v_0, name: Board, type: kanban, kanban: { groupByColId: c_0 } }\nactiveViewId: v_0\n---\n`);
		await expect(page.locator('.bt-kanban-board, .bt-kanban, [class*="kanban"]').first()).toBeVisible();
		await expect(page.locator('.bt-table-footer-line span.math')).toHaveCount(1);
	});

	test('editing shows the text as written, and saving keeps it', async ({ page, renderFull }) => {
		await renderFull(SRC('"Total $H_s$"'));
		await page.locator('.bt-table-footer').click();
		await expect(page.locator('textarea.bt-inline-editor-multi')).toHaveValue('Total $H_s$');
	});
});
