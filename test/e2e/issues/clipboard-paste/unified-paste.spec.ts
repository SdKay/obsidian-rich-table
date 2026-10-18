import { test, expect } from '../../common/test-base';
import { scrollableTable } from '../../common/fixtures';

// One paste design for the cell editor, all through the `paste` event: a copied table spreads
// over cells, anything else is plain text with its line breaks.
test.describe('unified paste', () => {
	const SOURCE = scrollableTable({ theme: 'grid' });
	const A = '.bt-td[data-row="1"][data-col="0"]';
	type P = import('@playwright/test').Page;
	type Op = { type: string; value?: string; values?: string[][] };

	const edit = async (page: P) => {
		await page.locator(A).first().click();
		await expect.poll(() => page.locator(`${A}.bt-editing`).count()).toBe(1);
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Delete');
	};
	const ops = (page: P) => page.evaluate(() => (window as unknown as { __btOps: Op[] }).__btOps);
	const editorText = (page: P) => page.evaluate(() => (document.querySelector('.bt-cell-editor') as HTMLElement | null)?.textContent ?? null);
	const clip = (page: P, text: string, html?: string) => page.evaluate(async ({ text, html }) => {
		const items: Record<string, Blob> = { 'text/plain': new Blob([text], { type: 'text/plain' }) };
		if (html) items['text/html'] = new Blob([html], { type: 'text/html' });
		await navigator.clipboard.write([new ClipboardItem(items)]);
	}, { text, html });

	/** How a user pastes; the native menu's Paste fires the same `paste` event. */
	const how = {
		'Ctrl+V': async (page: P) => { await page.keyboard.press('Control+v'); },
	};
	const WHEN_RICH = ['Ctrl+V'] as const;
	const ALL = [...WHEN_RICH] as const;

	for (const name of ALL) {
		test(`${name}: multi-line text keeps its line breaks`, async ({ page, renderFull, context }) => {
			await context.grantPermissions(['clipboard-read', 'clipboard-write']);
			await renderFull(SOURCE);
			await edit(page);
			await clip(page, 'line one\nline two\nline three');
			await how[name](page);
			await expect.poll(() => editorText(page)).toBe('line one\nline two\nline three');
			await page.keyboard.press('Enter');
			await expect.poll(async () => (await ops(page)).filter(o => o.type === 'set-cell-content').at(-1)?.value).toBe('line one\nline two\nline three');
		});

		test(`${name}: an image wikilink stays a wikilink`, async ({ page, renderFull, context }) => {
			await context.grantPermissions(['clipboard-read', 'clipboard-write']);
			await renderFull(SOURCE);
			await edit(page);
			await clip(page, '![[a.png]]', '<p><img src="x.png" alt="a.png"></p>');
			await how[name](page);
			await expect.poll(() => editorText(page)).toBe('![[a.png]]');
		});

		test(`${name}: pasted text lands at the caret, not over the whole cell`, async ({ page, renderFull, context }) => {
			await context.grantPermissions(['clipboard-read', 'clipboard-write']);
			await renderFull(SOURCE);
			await edit(page);
			await page.keyboard.type('ab');
			await page.keyboard.press('ArrowLeft');
			await clip(page, 'X\nY');
			await how[name](page);
			await expect.poll(() => editorText(page)).toBe('aX\nYb');
		});

		test(`${name}: Ctrl+Z takes the paste back`, async ({ page, renderFull, context }) => {
			await context.grantPermissions(['clipboard-read', 'clipboard-write']);
			await renderFull(SOURCE);
			await edit(page);
			await page.keyboard.type('keep');
			await clip(page, 'a\nb');
			await how[name](page);
			await expect.poll(() => editorText(page)).toBe('keepa\nb');
			await page.keyboard.press('Control+z');
			await expect.poll(() => editorText(page)).toBe('keep');
		});

		test(`${name}: afterwards a click elsewhere ends the edit and saves`, async ({ page, renderFull, context }) => {
			await context.grantPermissions(['clipboard-read', 'clipboard-write']);
			await renderFull(SOURCE);
			await edit(page);
			await clip(page, 'pasted');
			await how[name](page);
			await page.mouse.click(5, 5);
			await expect.poll(() => page.locator(`${A}.bt-editing`).count()).toBe(0);
			await expect.poll(async () => (await ops(page)).filter(o => o.type === 'set-cell-content').at(-1)?.value).toBe('pasted');
		});
	}

	const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |';
	for (const name of WHEN_RICH) {
		test(`${name}: a copied table spreads over cells`, async ({ page, renderFull, context }) => {
			await context.grantPermissions(['clipboard-read', 'clipboard-write']);
			await renderFull(SOURCE);
			await edit(page);
			await clip(page, TABLE);
			await how[name](page);
			await expect.poll(async () => (await ops(page)).filter(o => o.type === 'paste-values').length).toBe(1);
			expect((await ops(page)).find(o => o.type === 'paste-values')?.values).toEqual([['a', 'b'], ['1', '2']]);
		});
		test(`${name}: an Excel-style HTML table spreads over cells`, async ({ page, renderFull, context }) => {
			await context.grantPermissions(['clipboard-read', 'clipboard-write']);
			await renderFull(SOURCE);
			await edit(page);
			await clip(page, '1\t2\n3\t4', '<table><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>');
			await how[name](page);
			await expect.poll(async () => (await ops(page)).filter(o => o.type === 'paste-values').length).toBe(1);
			expect((await ops(page)).find(o => o.type === 'paste-values')?.values).toEqual([['1', '2'], ['3', '4']]);
		});
	}

	// "Paste as plain text" is an ordinary paste event to the page; the click on the menu item is what says "as it is".
	const clickNativePlainPaste = (page: P) => page.evaluate(() => {
		const R = window.RichTableReal;
		const editor = document.querySelector('.bt-cell-editor') as HTMLElement;
		editor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		const menu = new R.ShimMenu();
		for (const title of ['Cut', 'Copy', 'Paste', 'Paste as plain text', 'Select all']) menu.addItem(i => i.setSection('clipboard').setTitle(title));
		R.addCellHighlightItems(menu);
		menu.items[3]!.dom.dispatchEvent(new MouseEvent('click', { bubbles: true }));
	});

	test('Paste as plain text puts a copied table into the cell as it is', async ({ page, renderFull, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await renderFull(SOURCE);
		await edit(page);
		await clip(page, TABLE, '<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>');
		await clickNativePlainPaste(page);
		await page.keyboard.press('Control+v');
		await expect.poll(() => editorText(page)).toBe(TABLE);
		expect((await ops(page)).filter(o => o.type === 'paste-values')).toEqual([]);
	});

	test('the plain request covers one paste: the next Ctrl+V spreads the table again', async ({ page, renderFull, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await renderFull(SOURCE);
		await edit(page);
		await clip(page, TABLE, '<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>');
		await clickNativePlainPaste(page);
		await page.keyboard.press('Control+v');
		await expect.poll(() => editorText(page)).toBe(TABLE);
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Delete');
		await page.keyboard.press('Control+v');
		await expect.poll(async () => (await ops(page)).filter(o => o.type === 'paste-values').length).toBe(1);
	});
});
