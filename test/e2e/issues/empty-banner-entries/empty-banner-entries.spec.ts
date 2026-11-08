import { test, expect } from '../../common/test-base';
import type { Page } from '@playwright/test';

// The guide shown in an empty block: one button per way to begin, each with a preview that follows the pointer.
const buttons = (page: Page) => page.locator('.bt-template-btn');
const activePreview = (page: Page) => page.evaluate(() => {
	const items = [...document.querySelectorAll('.bt-template-preview-item')];
	const on = items.map((e, i) => (e.classList.contains('is-active') ? i : -1)).filter(i => i >= 0);
	return { on, count: items.length };
});
/** What the active preview shows: the import's hint text, a table with nothing in its cells, or a table with content. */
const activeKind = (page: Page) => page.evaluate(() => {
	const el = document.querySelector('.bt-template-preview-item.is-active');
	if (!el) return 'none';
	if (el.classList.contains('bt-template-preview-text')) return 'hint';
	const cells = [...el.querySelectorAll('td.bt-td')];
	if (cells.length === 0) return 'empty-table-element';
	return cells.every(c => (c.textContent ?? '').trim() === '') ? 'blank' : 'content';
});
const note = (page: Page) => page.evaluate(() => {
	const w = window as unknown as { __btVault: { files: Map<string, string> }; __btNote: string };
	return w.__btVault.files.get(w.__btNote) ?? '';
});

test('lists the way to import a file first, then each template, then the blank table', async ({ page, renderBlock }) => {
	await renderBlock('');
	const labels = await buttons(page).allTextContents();
	expect(labels.length).toBeGreaterThanOrEqual(3);
	// The first button is the import (a file), the last is the blank table.
	await expect(buttons(page).first()).toHaveAttribute('data-preview-key', 'xlsx-import');
	await expect(buttons(page).last()).toHaveAttribute('data-preview-key', 'blank');
	const keys = await buttons(page).evaluateAll(els => els.map(e => (e as HTMLElement).dataset.previewKey));
	expect(new Set(keys).size, 'every button has its own preview').toBe(keys.length);
});

test('has one preview for each button', async ({ page, renderBlock }) => {
	await renderBlock('');
	const { count } = await activePreview(page);
	expect(count).toBe(await buttons(page).count());
});

test('shows the first template until a button is pointed at, then that button\'s preview, then the first again', async ({ page, renderBlock }) => {
	await renderBlock('');
	expect(await activeKind(page), 'the first template to begin with').toBe('content');
	// The import button's preview is its hint text, which no template's is.
	await buttons(page).first().hover();
	expect(await activeKind(page)).toBe('hint');
	await page.mouse.move(2, 2);
	expect(await activeKind(page), 'back to the first template').toBe('content');
});

test('clicking a template writes a table into the note', async ({ page, renderBlock }) => {
	await renderBlock('');
	expect(await note(page)).not.toContain('columns:');
	await buttons(page).nth(1).click();
	await expect.poll(() => note(page)).toContain('columns:');
});

// The entries a single click inserts. The import needs a file chosen and the blank table a size, so they cannot be clicked
// straight through; each of these writes the note, and choosing one twice must write it once.
for (const key of ['demo', 'tasks']) {
	test(`once the ${key} button has been clicked it does nothing more, so two writes cannot race`, async ({ page, renderBlock }) => {
		await renderBlock('');
		// What matters is how many times the note is written: a second write racing the first is what the lock prevents,
		// and the last one would hide it by overwriting the first.
		await page.evaluate((k) => {
			const w = window as unknown as { __btVault: { process: (f: unknown, fn: (d: string) => string) => Promise<string> }; __writes: number };
			w.__writes = 0;
			const original = w.__btVault.process.bind(w.__btVault);
			w.__btVault.process = (f, fn) => { w.__writes++; return original(f, fn); };
			const button = document.querySelector<HTMLElement>(`.bt-template-btn[data-preview-key="${k}"]`)!;
			button.click();
			button.click();
		}, key);
		await page.waitForTimeout(300);
		expect(await page.evaluate(() => (window as unknown as { __writes: number }).__writes), 'the note was written once').toBe(1);
		await expect(page.locator('.bt-template-banner')).toHaveClass(/is-inserting/);
	});
}

test('choosing one entry locks the others, whichever it was', async ({ page, renderBlock }) => {
	await renderBlock('');
	await page.evaluate(() => {
		const w = window as unknown as { __btVault: { process: (f: unknown, fn: (d: string) => string) => Promise<string> }; __writes: number };
		w.__writes = 0;
		const original = w.__btVault.process.bind(w.__btVault);
		w.__btVault.process = (f, fn) => { w.__writes++; return original(f, fn); };
		document.querySelector<HTMLElement>('.bt-template-btn[data-preview-key="tasks"]')!.click();
		document.querySelector<HTMLElement>('.bt-template-btn[data-preview-key="demo"]')!.click();
	});
	await page.waitForTimeout(300);
	expect(await page.evaluate(() => (window as unknown as { __writes: number }).__writes)).toBe(1);
});

test('pointing at a button shows the preview that is its own: the hint, a table with content, or a blank one', async ({ page, renderBlock }) => {
	await renderBlock('');
	const keys = await buttons(page).evaluateAll(els => els.map(e => (e as HTMLElement).dataset.previewKey));
	const kinds: Record<string, string> = {};
	for (let i = 0; i < keys.length; i++) {
		if (keys[i] === 'blank') continue; // pointing at it opens the picker, covered below
		await buttons(page).nth(i).hover();
		kinds[keys[i]!] = await activeKind(page);
	}
	// The entries that begin another kind of table have no table to show yet, only a hint; a template shows its own.
	for (const [k, v] of Object.entries(kinds)) expect(v, k).toBe(k === 'xlsx-import' || k === 'tasks' ? 'hint' : 'content');
});

test('pointing at the blank table opens the size picker, and its preview holds while the pointer moves into the picker', async ({ page, renderBlock }) => {
	await renderBlock('');
	await buttons(page).last().hover();
	await expect(page.locator('.bt-grid-picker')).toBeVisible();
	expect(await activeKind(page)).toBe('blank');
	// Moving from the button into the picker leaves the button, which must not send the preview back.
	await page.locator('.bt-gp-cell').nth(5).hover();
	expect(await activeKind(page)).toBe('blank');
	await expect(page.locator('.bt-grid-picker')).toBeVisible();
});

test('while the picker is open the preview stays the blank table even if the pointer passes over another button', async ({ page, renderBlock }) => {
	await renderBlock('');
	await buttons(page).last().hover();
	await expect(page.locator('.bt-grid-picker')).toBeVisible();
	// A mouseover on a neighbouring button, as the pointer crosses the gap on its way to the picker.
	await page.evaluate(() => {
		const other = document.querySelectorAll<HTMLElement>('.bt-template-btn')[1]!;
		other.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
	});
	expect(await activeKind(page)).toBe('blank');
});

test('the picker closes when the pointer goes away, and the preview returns to the first template', async ({ page, renderBlock }) => {
	await renderBlock('');
	await buttons(page).last().hover();
	await expect(page.locator('.bt-grid-picker')).toBeVisible();
	await page.mouse.move(2, 2);
	await expect(page.locator('.bt-grid-picker')).toHaveCount(0);
	expect(await activeKind(page)).toBe('content');
});

test('choosing a size in the picker writes a table of that size into the note', async ({ page, renderBlock }) => {
	await renderBlock('');
	await buttons(page).last().hover();
	await expect(page.locator('.bt-grid-picker')).toBeVisible();
	// The cell at row 2, column 3 (zero-based 1, 2) is a table of 2 rows by 3 columns.
	await page.locator('.bt-gp-cell[data-r="1"][data-c="2"]').hover();
	await page.locator('.bt-gp-cell[data-r="1"][data-c="2"]').click();
	await expect.poll(() => note(page)).toContain('columns:');
	const text = await note(page);
	expect((text.match(/^\s+- id: c_/gm) ?? []).length, 'three columns').toBe(3);
});

test('the blank table\'s preview follows the size under the pointer in the picker', async ({ page, renderBlock }) => {
	await renderBlock('');
	await buttons(page).last().hover();
	await expect(page.locator('.bt-grid-picker')).toBeVisible();
	const columns = () => page.evaluate(() => document.querySelector('.bt-template-preview-item.is-active')?.querySelectorAll('thead th.bt-th').length ?? -1);
	await page.locator('.bt-gp-cell[data-r="1"][data-c="4"]').hover();
	expect(await columns(), 'five columns under the cell in the fifth column').toBe(5);
	await page.locator('.bt-gp-cell[data-r="1"][data-c="1"]').hover();
	expect(await columns(), 'two columns under the cell in the second column').toBe(2);
});

test('a sheet emptied of its columns offers the templates and the blank table, but not to import a file', async ({ page, renderBlock }) => {
	// A workbook whose only sheet has no columns: the guide is shown for the sheet, not for the whole block.
	await renderBlock('---\nversion: 3\nactive_sheet: s_a\nsheets:\n  - id: s_a\n    name: A\n    columns: []\n    rows: []\n---\n');
	await expect(page.locator('.bt-template-banner')).toBeVisible();
	const keys = await buttons(page).evaluateAll(els => els.map(e => (e as HTMLElement).dataset.previewKey));
	expect(keys).not.toContain('xlsx-import');
	expect(keys).toContain('blank');
	expect(keys.length, 'the templates are offered').toBeGreaterThanOrEqual(2);
});

test('an empty block offers a table of tasks, whose preview is a hint since the tasks are in the vault', async ({ page, renderBlock }) => {
	await renderBlock('');
	const tasks = page.locator('.bt-template-btn[data-preview-key="tasks"]');
	await expect(tasks).toHaveCount(1);
	await tasks.hover();
	expect(await activeKind(page)).toBe('hint');
});

test('choosing the tasks table writes a block with the default columns, no rows and no query yet, and asks for one', async ({ page, renderBlock }) => {
	await renderBlock('');
	await page.locator('.bt-template-btn[data-preview-key="tasks"]').click();
	await expect.poll(() => note(page)).toContain('tasks:');
	const text = await note(page);
	expect(text).toContain('query: ""');
	expect(text).toContain('field: status');
	expect(text).toContain('field: body');
	expect(text).not.toContain('rows:');
	await expect(page.locator('.modal .bt-tasks-query-input')).toBeVisible();
});

test('a sheet emptied of its columns does not offer the tasks table, which is a kind of block and not of sheet', async ({ page, renderBlock }) => {
	await renderBlock('---\nversion: 3\nactive_sheet: s_a\nsheets:\n  - id: s_a\n    name: A\n    columns: []\n    rows: []\n---\n');
	await expect(page.locator('.bt-template-banner')).toBeVisible();
	const keys = await buttons(page).evaluateAll(els => els.map(e => (e as HTMLElement).dataset.previewKey));
	expect(keys).not.toContain('tasks');
});

test('the query written when the tasks table is inserted is saved, and the table draws the tasks it finds', async ({ page, renderBlock }) => {
	const b = await renderBlock('', { tasksFrom: { 'a.md': '- [ ] write the report \u{1F4C5} 2026-11-12\n- [x] already done\n' } });
	await page.locator('.bt-template-btn[data-preview-key="tasks"]').click();
	const input = page.locator('.modal .bt-tasks-query-input');
	await expect(input).toBeVisible();
	await input.fill('not done');
	await page.locator('.modal button', { hasText: 'Save' }).click();
	await expect(page.locator('.modal')).toHaveCount(0);
	await expect.poll(() => b.noteText()).toMatch(/query: \|?-?\s*\n?\s*not done/);
	// The block is now a tasks table with a query; draw it again as Obsidian does after the write.
	await b.reprocess();
	await expect(page.locator('td.bt-td', { hasText: 'write the report' })).toHaveCount(1);
	await expect(page.locator('td.bt-td', { hasText: 'already done' })).toHaveCount(0);
});
