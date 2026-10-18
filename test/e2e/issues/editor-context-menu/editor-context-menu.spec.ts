import { test, expect } from '../../common/test-base';
import { scrollableTable } from '../../common/fixtures';

// Right-clicking text in a cell editor: Obsidian's own menu is left alone (so Paste behaves as
// everywhere else) and the plugin appends highlight items that act on the cell's text, which the
// native Highlight cannot reach.
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

	/** Right-clicks `[from, to)` of the editor's text, then builds the menu the way `editor-menu` does. Returns whether the browser's default was prevented. */
	const rightClick = (page: P, from: number, to: number, inCell = true) => page.evaluate(([a, b, cell]) => {
		const R = window.RichTableReal;
		const editor = document.querySelector('.bt-cell-editor') as HTMLElement;
		const node = editor.firstChild!;
		const range = document.createRange();
		range.setStart(node, a!); range.setEnd(node, b!);
		const sel = window.getSelection()!;
		sel.removeAllRanges(); sel.addRange(range);
		const outside = (e: Event) => R.clearCellPickOutside(e as MouseEvent);
		document.addEventListener('contextmenu', outside, true);
		const target: Element = cell ? editor : document.body;
		const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
		target.dispatchEvent(evt);
		document.removeEventListener('contextmenu', outside, true);
		const menu = new R.ShimMenu();
		R.addCellHighlightItems(menu);
		return evt.defaultPrevented;
	}, [from, to, inCell] as const);

	const clickItem = (page: P, title: string) => page.evaluate((t) => {
		const R = window.RichTableReal;
		const menu = new R.ShimMenu();
		R.addCellHighlightItems(menu);
		menu.clickItem(t);
	}, title);

	const titles = (page: P) => page.evaluate(() => {
		const R = window.RichTableReal;
		const menu = new R.ShimMenu();
		R.addCellHighlightItems(menu);
		return menu.items.map(i => i.title);
	});

	/** Titles of the Format submenu and of the Highlight submenu inside it. */
	const formatTree = (page: P) => page.evaluate(() => {
		const R = window.RichTableReal;
		const menu = new R.ShimMenu();
		R.addCellHighlightItems(menu);
		const format = menu.items.find(i => i.title === 'Format')?.submenu;
		const highlight = format?.items.find(i => i.title === 'Highlight')?.submenu;
		return { format: format?.items.map(i => i.title) ?? [], highlight: highlight?.items.map(i => i.title) ?? [] };
	});

	test('the right-click is not intercepted and cell highlight items are appended', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		expect(await rightClick(page, 0, 5), 'the plugin took over the native menu').toBe(false);
		expect(await titles(page)).toContain('Format');
	});

	test('the Format submenu mirrors Obsidian: bold, italic, strikethrough, highlight > colors, code, math, comment, clear', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await rightClick(page, 0, 5);
		const tree = await formatTree(page);
		expect(tree.format).toEqual(['Bold', 'Italic', 'Strikethrough', 'Highlight', 'Code', 'Math', 'Comment', 'Clear formatting']);
		expect(tree.highlight).toEqual(['Default', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple']);
	});

	test('native items that edit the note are dropped, the clipboard items stay', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await rightClick(page, 0, 5);
		const left = await page.evaluate(() => {
			const R = window.RichTableReal;
			const menu = new R.ShimMenu();
			for (const [section, title] of [['clipboard', 'Paste'], ['selection.format', 'Text format'], ['selection.paragraph.list', 'Bullet list']] as const) {
				menu.addItem(i => i.setSection(section).setTitle(title));
			}
			R.addCellHighlightItems(menu);
			return menu.items.map(i => i.title);
		});
		expect(left).toContain('Paste');
		expect(left).not.toContain('Text format');
		expect(left).not.toContain('Bullet list');
	});

	test('a right-click outside the cell offers no cell highlight', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await rightClick(page, 0, 5);
		expect(await titles(page)).toContain('Format');
		await rightClick(page, 0, 5, false);
		expect(await titles(page), 'a stale cell pick leaked into another right-click').toEqual([]);
	});

	test('without a selection only the line-based items can be used', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await rightClick(page, 3, 3);
		const state = await page.evaluate(() => {
			const R = window.RichTableReal;
			const menu = new R.ShimMenu();
			R.addCellHighlightItems(menu);
			const by = (title: string) => menu.items.find(i => i.title === title)!;
			return {
				link: by('Add link').disabled, format: by('Format').disabled,
				paragraph: by('Paragraph').disabled, insert: by('Insert').disabled,
			};
		});
		expect(state).toEqual({ link: true, format: true, paragraph: false, insert: false });
	});

	test('the top level follows Obsidian: links, then the Format, Paragraph and Insert submenus', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await rightClick(page, 0, 5);
		const tree = await page.evaluate(() => {
			const R = window.RichTableReal;
			const menu = new R.ShimMenu();
			R.addCellHighlightItems(menu);
			const sub = (title: string) => menu.items.find(i => i.title === title)!.submenu!.items.map(i => i.title);
			return { top: menu.items.map(i => i.title), paragraph: sub('Paragraph'), insert: sub('Insert') };
		});
		expect(tree.top).toEqual(['Add link', 'Add external link', 'Format', 'Paragraph', 'Insert']);
		expect(tree.paragraph).toEqual(['Bullet list', 'Numbered list', 'Task list', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6', 'Body', 'Quote']);
		expect(tree.insert).toEqual(['Callout', 'Horizontal rule', 'Code block', 'Math block']);
	});

	/** Types `text` (with real line breaks) into the editor, selects `[from, to)` and right-clicks. */
	const multiline = async (page: P, text: string, from: number, to: number) => {
		await startEditing(page);
		await page.evaluate((t) => {
			const editor = document.querySelector('.bt-cell-editor') as HTMLElement;
			editor.focus();
			document.execCommand('selectAll');
			window.RichTableReal.insertPlainText(editor, t);
		}, text);
		await rightClick(page, from, to);
	};

	for (const [title, expected] of [
		['Bullet list', '- one\n- two'], ['Numbered list', '1. one\n2. two'], ['Task list', '- [ ] one\n- [ ] two'],
		['Quote', '> one\n> two'], ['Heading 2', '## one\n## two'],
	] as const) {
		test(`${title} applies to every selected line`, async ({ page, renderFull }) => {
			await renderFull(SOURCE);
			await multiline(page, 'one\ntwo', 0, 7);
			await clickItem(page, title);
			expect(await page.locator('.bt-cell-editor').textContent()).toBe(expected);
		});
	}

	test('a list can be taken off again and Heading shows its check', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await multiline(page, '## one\n## two', 0, 13);
		const checked = await page.evaluate(() => {
			const R = window.RichTableReal;
			const menu = new R.ShimMenu();
			R.addCellHighlightItems(menu);
			return menu.items.find(i => i.title === 'Paragraph')!.submenu!.items.filter(i => i.checked).map(i => i.title);
		});
		expect(checked).toEqual(['Heading 2']);
		await clickItem(page, 'Body');
		expect(await page.locator('.bt-cell-editor').textContent()).toBe('one\ntwo');
	});

	test('Bullet list on an empty cell starts the list', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Delete');
		await page.evaluate(() => (document.querySelector('.bt-cell-editor') as HTMLElement).dispatchEvent(
			new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
		await clickItem(page, 'Bullet list');
		expect(await page.locator('.bt-cell-editor').textContent()).toBe('- ');
		await page.keyboard.type('x');
		expect(await page.locator('.bt-cell-editor').textContent()).toBe('- x');
	});

	test('Code block fences the selected lines', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await multiline(page, 'one\ntwo', 0, 7);
		await clickItem(page, 'Code block');
		expect(await page.locator('.bt-cell-editor').textContent()).toBe('```\none\ntwo\n```');
	});

	test('Add link wraps the selection as a wikilink', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await rightClick(page, 6, 11);
		await clickItem(page, 'Add link');
		expect(await page.locator('.bt-cell-editor').textContent()).toBe('hello [[world]]');
	});

	test('opening the menu does not commit the edit', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await rightClick(page, 0, 5);
		await page.evaluate(() => (document.querySelector('.bt-cell-editor') as HTMLElement).blur());
		await page.waitForTimeout(150);
		expect(await page.locator(`${CELL}.bt-editing`).count(), 'the menu taking focus ended the edit').toBe(1);
		expect(JSON.stringify(await ops(page))).not.toContain('hello');
	});

	test('clicking elsewhere after the menu ends the edit', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await rightClick(page, 0, 5);
		await page.mouse.click(5, 5);
		await expect.poll(() => page.locator(`${CELL}.bt-editing`).count()).toBe(0);
	});

	for (const [title, wrapped] of [['Bold', '**hello** world'], ['Italic', '*hello* world'], ['Strikethrough', '~~hello~~ world'], ['Code', '`hello` world'], ['Math', '$hello$ world'], ['Comment', '%%hello%% world']] as const) {
		test(`${title} wraps the selection and a second pick unwraps it`, async ({ page, renderFull }) => {
			await renderFull(SOURCE);
			await startEditing(page);
			await rightClick(page, 0, 5);
			await clickItem(page, title);
			expect(await page.locator('.bt-cell-editor').textContent()).toBe(wrapped);
			await page.evaluate(() => (document.querySelector('.bt-cell-editor') as HTMLElement).dispatchEvent(
				new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
			await clickItem(page, title);
			expect(await page.locator('.bt-cell-editor').textContent()).toBe('hello world');
		});
	}

	test('Clear format removes the marks again', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await rightClick(page, 0, 5);
		await clickItem(page, 'Bold');
		await page.evaluate(() => (document.querySelector('.bt-cell-editor') as HTMLElement).dispatchEvent(
			new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
		await clickItem(page, 'Clear formatting');
		expect(await page.locator('.bt-cell-editor').textContent()).toBe('hello world');
	});

	test('Highlight wraps the selection in ==', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await rightClick(page, 6, 11);
		await clickItem(page, 'Default');
		expect(await page.locator('.bt-cell-editor').textContent()).toBe('hello ==world==');
		await page.keyboard.press('Enter');
		await expect.poll(async () => JSON.stringify(await ops(page))).toContain('hello ==world==');
	});

	test('the Highlight submenu checks the color the selection is in, with Obsidian\'s swatch for each color', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await rightClick(page, 0, 5);
		await clickItem(page, 'Blue');
		await page.evaluate(() => (document.querySelector('.bt-cell-editor') as HTMLElement).dispatchEvent(
			new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
		const sub = await page.evaluate(() => {
			const R = window.RichTableReal;
			const menu = new R.ShimMenu();
			R.addCellHighlightItems(menu);
			const colors = menu.items.find(i => i.title === 'Format')!.submenu!.items.find(i => i.title === 'Highlight')!.submenu!;
			return colors.items.map(i => ({ title: i.title, checked: i.checked, swatch: i.iconEl.querySelector('.highlight-swatch')?.getAttribute('data-highlight') ?? null }));
		});
		expect(sub.filter(i => i.checked).map(i => i.title)).toEqual(['Blue']);
		expect(sub.find(i => i.title === 'Default')!.swatch).toBeNull();
		expect(sub.find(i => i.title === 'Red')!.swatch).toBe('red');
	});

	// Both nesting orders, each selected as the text only and as the whole thing.
	for (const [text, ranges] of [
		['==🔴**hello**==', [[6, 11], [4, 13], [0, 15], [7, 10]]],
		['**==🔴hello==**', [[6, 11], [4, 11], [0, 15], [7, 10]]],
	] as const) {
		test(`bold and highlight both stay checked in ${text}`, async ({ page, renderFull }) => {
			await renderFull(SOURCE);
			await startEditing(page);
			await page.keyboard.press('Control+a');
			await page.keyboard.type(text);
			const states = await page.evaluate((rs) => {
				const R = window.RichTableReal;
				const editor = document.querySelector('.bt-cell-editor') as HTMLElement;
				const node = editor.firstChild!;
				return rs.map(([a, b]) => {
					const range = document.createRange(); range.setStart(node, a!); range.setEnd(node, b!);
					const sel = window.getSelection()!; sel.removeAllRanges(); sel.addRange(range);
					editor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
					const menu = new R.ShimMenu();
					R.addCellHighlightItems(menu);
					const fmt = menu.items.find(i => i.title === 'Format')!.submenu!;
					return { bold: fmt.items.find(i => i.title === 'Bold')!.checked, highlight: fmt.items.find(i => i.title === 'Highlight')!.checked };
				});
			}, ranges.map(r => [...r]));
			for (const state of states) expect(state).toEqual({ bold: true, highlight: true });
		});
	}

	test('part of a highlight\'s text, inside italics, still reads as that highlight', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('*==🔵3    32    aaa==*');
		const len = '*==🔵3    32    aaa==*'.length;
		const checked = await page.evaluate((from) => {
			const R = window.RichTableReal;
			const editor = document.querySelector('.bt-cell-editor') as HTMLElement;
			const node = editor.firstChild!;
			const range = document.createRange(); range.setStart(node, from); range.setEnd(node, from + 3);
			const sel = window.getSelection()!; sel.removeAllRanges(); sel.addRange(range);
			editor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
			const menu = new R.ShimMenu();
			R.addCellHighlightItems(menu);
			const fmt = menu.items.find(i => i.title === 'Format')!.submenu!;
			const colors = fmt.items.find(i => i.title === 'Highlight')!.submenu!;
			return { italic: fmt.items.find(i => i.title === 'Italic')!.checked, highlight: fmt.items.find(i => i.title === 'Highlight')!.checked, colors: colors.items.filter(i => i.checked).map(i => i.title) };
		}, len - 6);
		expect(checked).toEqual({ italic: true, highlight: true, colors: ['Blue'] });
	});

	test('a colored highlight carries the color marker, and the same color toggles it off', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await rightClick(page, 0, 5);
		await clickItem(page, 'Red');
		expect(await page.locator('.bt-cell-editor').textContent()).toBe('==🔴hello== world');
		expect(await page.evaluate(() => window.getSelection()!.toString())).toBe('hello');
		await page.evaluate(() => (document.querySelector('.bt-cell-editor') as HTMLElement).dispatchEvent(
			new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
		await clickItem(page, 'Red');
		expect(await page.locator('.bt-cell-editor').textContent()).toBe('hello world');
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
