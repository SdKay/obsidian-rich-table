import { test, expect } from '../../common/test-base';
import { scrollableTable } from '../../common/fixtures';

// Right-clicking selected text inside a cell editor. The editor is a
// contenteditable nested in the note's own editor, so an unhandled right-click
// bubbles to the note's menu (and to plugins hooked onto it), which then reports
// "focus must be in editor". The cell editor owns its menu instead.
test.describe('editor-context-menu', () => {
	const SOURCE = scrollableTable({ theme: 'grid' });
	const CELL = '.bt-td[data-row="1"][data-col="0"]';
	type P = import('@playwright/test').Page;

	const ops = (page: P) =>
		page.evaluate(() => (window as unknown as { __btOps: { type: string; value?: string }[] }).__btOps);

	const startEditing = async (page: P) => {
		await page.locator(CELL).first().click();
		await expect.poll(() => page.locator(`${CELL}.bt-editing`).count()).toBe(1);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('hello world');
	};

	/** Selects `[from, to)` of the editor's text and right-clicks it; returns whether the event escaped the editor. */
	const rightClickSelection = (page: P, from: number, to: number) => page.evaluate(([a, b]) => {
		const editor = document.querySelector('.bt-cell-editor') as HTMLElement;
		const node = editor.firstChild!;
		const range = document.createRange();
		range.setStart(node, a!); range.setEnd(node, b!);
		const sel = window.getSelection()!;
		sel.removeAllRanges(); sel.addRange(range);
		let escaped = false;
		const spy = () => { escaped = true; };
		document.addEventListener('contextmenu', spy);
		editor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
		document.removeEventListener('contextmenu', spy);
		return escaped;
	}, [from, to] as const);

	const menuTitles = (page: P) =>
		page.evaluate(() => window.RichTableReal.ShimMenu.opened.at(-1)?.items.map(i => i.title) ?? []);

	const clickMenu = (page: P, title: string) =>
		page.evaluate((t) => window.RichTableReal.ShimMenu.opened.at(-1)?.clickItem(t), title);

	test('the right-click stays inside the cell and opens the editor menu', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		const escaped = await rightClickSelection(page, 0, 5);
		expect(escaped, 'the contextmenu event reached the note, so its menu and plugin hooks run against a selection that is not theirs').toBe(false);
		expect(await menuTitles(page)).toContain('Highlight');
	});

	test('opening the menu does not commit the edit', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await rightClickSelection(page, 0, 5);
		await page.evaluate(() => (document.querySelector('.bt-cell-editor') as HTMLElement).blur());
		await page.waitForTimeout(150);
		expect(await page.locator(`${CELL}.bt-editing`).count(), 'the menu taking focus ended the edit').toBe(1);
		expect(JSON.stringify(await ops(page))).not.toContain('hello');
	});

	test('Highlight wraps the selection in ==', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await rightClickSelection(page, 6, 11);
		await clickMenu(page, 'Highlight');
		expect(await page.locator('.bt-cell-editor').textContent()).toBe('hello ==world==');
		await page.keyboard.press('Enter');
		await expect.poll(async () => JSON.stringify(await ops(page))).toContain('hello ==world==');
	});

	test('a colored highlight carries the color marker, and the same color toggles it off', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await rightClickSelection(page, 0, 5);
		await clickMenu(page, 'Highlight · Red');
		expect(await page.locator('.bt-cell-editor').textContent()).toBe('==🔴hello== world');

		// The selection is restored to the body, so a second pick acts on it.
		const body = await page.evaluate(() => window.getSelection()!.toString());
		expect(body).toBe('hello');
		await page.evaluate(() => {
			(document.querySelector('.bt-cell-editor') as HTMLElement).dispatchEvent(
				new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		});
		await clickMenu(page, 'Highlight · Red');
		expect(await page.locator('.bt-cell-editor').textContent()).toBe('hello world');
	});

	test('without a selection the highlight entries are disabled', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await rightClickSelection(page, 3, 3);
		const disabled = await page.evaluate(() =>
			window.RichTableReal.ShimMenu.opened.at(-1)?.items.filter(i => i.title.startsWith('Highlight')).every(i => i.disabled));
		expect(disabled).toBe(true);
	});
});

// A cell that starts with `==` is a highlight, not a formula: the formula editor
// used to claim any leading `=`, which turned `==🔴test==` into #VALUE!.
test.describe('leading == is not a formula', () => {
	const SOURCE = scrollableTable({ theme: 'grid' });
	const CELL = '.bt-td[data-row="1"][data-col="0"]';
	type P = import('@playwright/test').Page;
	type Op = { type: string; formula?: string | null };

	const commit = async (page: P, text: string) => {
		await page.locator(CELL).first().click();
		await expect.poll(() => page.locator(`${CELL}.bt-editing`).count()).toBe(1);
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Delete');
		await page.keyboard.type(text);
		await page.keyboard.press('Enter');
		await expect.poll(() => page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps.length)).toBeGreaterThan(0);
		return page.evaluate(() => (window as unknown as { __btOps: Op[] }).__btOps);
	};

	test('==🔴test== is saved as text, never as a formula', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		const ops = await commit(page, '==🔴test==');
		expect(ops.some(o => o.type === 'set-cell-formula' && o.formula),
			'a leading == was treated as a formula, which is what produced #VALUE!').toBe(false);
		expect(JSON.stringify(ops)).toContain('==🔴test==');
	});

	test('a real formula is still saved as one', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		const ops = await commit(page, '=1+1');
		expect(ops.some(o => o.type === 'set-cell-formula' && o.formula === '=1+1')).toBe(true);
	});
});
