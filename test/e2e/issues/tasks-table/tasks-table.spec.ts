import { test, expect } from '../../common/test-base';

// A block with `tasks` shows the tasks a query finds, one per row, and saves only the query and the columns.
// The notes below are what the vault holds; the fixture finds the tasks in them the way the plugin does.
const NOTES = {
	'proj/a.md': '# Plan\n- [ ] write the report 📅 2026-12-01 ⏫ #work\n- [x] old thing ✅ 2026-01-01\n- [ ] call back #q',
	'proj/b.md': '- [ ] book the room 📅 2026-11-20\n  - [ ] a sub task',
	'other/c.md': '- [ ] outside #q',
};

const COLUMNS = `columns:
  - { id: c_body, name: Task, field: body }
  - { id: c_due, name: Due, field: due, width: 100 }
  - { id: c_file, name: File, field: file }`;

const block = (query: string, extra = '', groups = false) => `---
version: 2
tasks:
  query: |
${query.split('\n').map(l => `    ${l}`).join('\n')}
${groups ? '  groups: true\n' : ''}${COLUMNS}
${extra}---
`;

// The shim does not draw menus; it records them, and an entry is picked by its title.
const pick = (page: import('@playwright/test').Page, title: string) =>
	page.evaluate(t => {
		const menus = window.RichTableReal.ShimMenu.opened;
		return menus[menus.length - 1]?.clickItem(t) ?? false;
	}, title);

const texts = (page: import('@playwright/test').Page, col: number) =>
	page.locator(`td.bt-td[data-col="${col}"]`).allInnerTexts().then(a => a.map(s => s.trim()));

test.describe('a tasks table', () => {
	test('shows one row per task the query finds, in the order the query gives', async ({ page, renderBlock }) => {
		await renderBlock(block('not done\nsort by due'), { tasksFrom: NOTES });
		await expect(page.locator('.bt-th-text')).toHaveText(['Task', 'Due', 'File']);
		// Dated tasks first, oldest first; the undated ones follow, by path (other/ before proj/).
		expect(await texts(page, 0)).toEqual(['book the room', 'write the report', 'outside', 'call back', 'a sub task']);
	});

	test('leaves out what the query leaves out', async ({ page, renderBlock }) => {
		await renderBlock(block('done'), { tasksFrom: NOTES });
		expect(await texts(page, 0)).toEqual(['old thing']);
	});

	test('fills each column from its field', async ({ page, renderBlock }) => {
		await renderBlock(block('tags include #work'), { tasksFrom: NOTES });
		expect(await texts(page, 0)).toEqual(['write the report']);
		expect(await texts(page, 1)).toEqual(['2026-12-01']);
		expect(await texts(page, 2)).toEqual(['a']);
	});

	test('a group is a heading row spanning the table when the table asks for headings', async ({ page, renderBlock }) => {
		await renderBlock(block('not done\ngroup by folder', '', true), { tasksFrom: NOTES });
		const heads = page.locator('td.bt-td[colspan="3"]');
		await expect(heads).toHaveCount(2);
		await expect(heads.first()).toContainText('other/ (1)');
		await expect(heads.nth(1)).toContainText('proj/ (4)');
	});

	test('a group has no heading row by default, yet its tasks stay together', async ({ page, renderBlock }) => {
		await renderBlock(block('not done\ngroup by folder'), { tasksFrom: NOTES });
		await expect(page.locator('td.bt-td[colspan="3"]')).toHaveCount(0);
		expect(await texts(page, 0)).toEqual(['outside', 'write the report', 'book the room', 'call back', 'a sub task']);
	});

	test('the view settings turn the headings on and off, and the choice is saved with the query', async ({ page, renderBlock }) => {
		const b = await renderBlock(block('not done\ngroup by folder'), { tasksFrom: NOTES });
		await page.locator('.bt-ctrl-btn[aria-label="View settings"]').click();
		expect(await pick(page, 'Show group headings')).toBe(true);
		await expect.poll(() => b.noteText()).toMatch(/query: \|[\s\S]*groups: true/);
		await b.reprocess();
		await expect(page.locator('td.bt-td[colspan="3"]')).toHaveCount(2);

		await page.locator('.bt-ctrl-btn[aria-label="View settings"]').click();
		expect(await pick(page, 'Show group headings')).toBe(true);
		await expect.poll(() => b.noteText()).not.toContain('groups:');
		await b.reprocess();
		await expect(page.locator('td.bt-td[colspan="3"]')).toHaveCount(0);
	});

	test('the query dialog keeps the choice when the query is rewritten', async ({ page, renderBlock }) => {
		const b = await renderBlock(block('not done\ngroup by folder', '', true), { tasksFrom: NOTES });
		await page.evaluate(async () => {
			const blk = (window as unknown as { __btBlock: { handleStructuralOp(op: unknown): Promise<void> } }).__btBlock;
			await blk.handleStructuralOp({ type: 'set-tasks-query', query: 'done' });
		});
		await expect.poll(() => b.noteText()).toContain('done');
		expect(await b.noteText()).toContain('groups: true');
	});

	test('a table written in the note has no such switch', async ({ page, renderBlock }) => {
		await renderBlock('---\nversion: 2\ncolumns:\n  - { id: c_a, name: A }\nrows:\n  - { id: r_a, cells: { c_a: x } }\n---\n');
		await page.locator('.bt-ctrl-btn[aria-label="View settings"]').click();
		const titles = await page.evaluate(() => window.RichTableReal.ShimMenu.opened.at(-1)?.items.map(i => i.title) ?? []);
		expect(titles.length).toBeGreaterThan(0);
		expect(titles).not.toContain('Show group headings');
	});
});

test.describe('what a tasks table writes to the note', () => {
	test('a column width change saves the query and the columns, and no rows', async ({ page, renderBlock }) => {
		const b = await renderBlock(block('not done\nsort by due'), { tasksFrom: NOTES });
		await page.locator('table.bt-table').hover();
		const handle = page.locator('.bt-col-selector .bt-sel-resize-col').first();
		const box = (await handle.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
		await page.mouse.up();
		await expect.poll(() => b.noteText()).toContain('width:');
		const note = await b.noteText();
		expect(note).toContain('field: body');
		expect(note).toContain('sort by due');
		expect(note).not.toContain('rows:');
		for (const text of ['write the report', 'book the room', 'outside']) expect(note).not.toContain(text);
	});

	// The ops a row or a cell would send have nothing to act on in a table of found tasks: none may reach the note.
	test('an op that names a row or a cell is refused and the note is left as it was', async ({ page, renderBlock }) => {
		const b = await renderBlock(block('not done'), { tasksFrom: NOTES });
		const before = await b.noteText();
		const row = 't_proj/b.md:0';
		await page.evaluate(async (rowId) => {
			const blk = (window as unknown as { __btBlock: { handleStructuralOp(op: unknown): Promise<void> } }).__btBlock;
			await blk.handleStructuralOp({ type: 'set-cell-content', rowId, colId: 'c_body', content: 'overwritten' });
			await blk.handleStructuralOp({ type: 'insert-row', afterRowId: rowId });
			await blk.handleStructuralOp({ type: 'delete-row', rowId });
			await blk.handleStructuralOp({ type: 'set-cell-style', rowId, colId: 'c_body', bg: '#ff0000' });
		}, row);
		await page.waitForTimeout(250);
		expect(await b.noteText()).toBe(before);
	});

	test('an op on a column is applied', async ({ page, renderBlock }) => {
		const b = await renderBlock(block('not done'), { tasksFrom: NOTES });
		await page.evaluate(async () => {
			const blk = (window as unknown as { __btBlock: { handleStructuralOp(op: unknown): Promise<void> } }).__btBlock;
			await blk.handleStructuralOp({ type: 'set-col-name', colId: 'c_body', name: 'Renamed' });
		});
		await expect.poll(() => b.noteText()).toContain('Renamed');
	});
});

test.describe('sorting', () => {
	test('the header shows the sort the query asks for', async ({ page, renderBlock }) => {
		await renderBlock(block('not done\nsort by due reverse'), { tasksFrom: NOTES });
		await expect(page.locator('.bt-th').nth(1).locator('.bt-sort-active-btn')).toHaveCount(1);
		await expect(page.locator('.bt-th').first().locator('.bt-sort-active-btn')).toHaveCount(0);
	});

	test('shows no sort mark when the query has no sort line', async ({ page, renderBlock }) => {
		await renderBlock(block('not done'), { tasksFrom: NOTES });
		await expect(page.locator('.bt-sort-active-btn')).toHaveCount(0);
	});

	test('clearing the live sort takes the sort lines out of the query and keeps the others', async ({ page, renderBlock }) => {
		const b = await renderBlock(block('not done\nsort by due\ngroup by folder'), { tasksFrom: NOTES });
		await page.locator('.bt-th').nth(1).locator('.bt-sort-active-btn').click();
		expect(await pick(page, 'Clear live sort')).toBe(true);
		await expect.poll(() => b.noteText()).not.toContain('sort by');
		const note = await b.noteText();
		expect(note).toContain('not done');
		expect(note).toContain('group by folder');
	});

	test('switching the live sort to descending rewrites the query', async ({ page, renderBlock }) => {
		const b = await renderBlock(block('not done\nsort by due\nlimit 10'), { tasksFrom: NOTES });
		await page.locator('.bt-th').nth(1).locator('.bt-sort-active-btn').click();
		expect(await pick(page, 'Keep sorted descending')).toBe(true);
		await expect.poll(() => b.noteText()).toContain('sort by due reverse');
		const note = await b.noteText();
		expect(note.match(/sort by/g)).toHaveLength(1);
		expect(note).toContain('limit 10');
	});
});

// A table is drawn from the tasks the vault has now, and again whenever the vault says they changed.
test('redraws with the tasks the vault has once it says they changed', async ({ page, renderBlock }) => {
	await renderBlock(block('not done'), { tasksFrom: NOTES });
	await expect(page.locator('td.bt-td', { hasText: 'brand new task' })).toHaveCount(0);
	await page.evaluate(() => {
		const w = window as unknown as { __btTaskNotes: Record<string, string>; __btTaskListeners: Set<() => void> };
		w.__btTaskNotes['new.md'] = '- [ ] brand new task\n';
		for (const fn of [...w.__btTaskListeners]) fn();
	});
	await expect(page.locator('td.bt-td', { hasText: 'brand new task' })).toHaveCount(1);
});

test('stops listening to the vault when the table goes away', async ({ page, renderBlock }) => {
	await renderBlock(block('not done'), { tasksFrom: NOTES });
	const listening = () => page.evaluate(() => (window as unknown as { __btTaskListeners: Set<() => void> }).__btTaskListeners.size);
	expect(await listening(), 'a tasks table listens').toBe(1);
	await page.evaluate(() => (window as unknown as { __btBlock: { unload(): void } }).__btBlock.unload());
	expect(await listening(), 'and lets go when it is unloaded').toBe(0);
});

// A change that arrives while the table is drawing must still draw it again, so the table keeps one subscription
// across its draws rather than taking a new one each time.
test('keeps the same subscription to the vault across redraws', async ({ page, renderBlock }) => {
	await renderBlock(block('not done'), { tasksFrom: NOTES });
	const listeners = () => page.evaluate(() => [...(window as unknown as { __btTaskListeners: Set<() => void> }).__btTaskListeners]);
	const first = await page.evaluate(() => {
		const w = window as unknown as { __btTaskListeners: Set<() => void>; __btFirst?: () => void };
		w.__btFirst = [...w.__btTaskListeners][0];
		return w.__btTaskListeners.size;
	});
	expect(first).toBe(1);
	for (let i = 0; i < 3; i++) {
		await page.evaluate((n) => {
			const w = window as unknown as { __btTaskNotes: Record<string, string>; __btTaskListeners: Set<() => void> };
			w.__btTaskNotes[`n${n}.md`] = `- [ ] redraw ${n}\n`;
			for (const fn of [...w.__btTaskListeners]) fn();
		}, i);
		await expect(page.locator('td.bt-td', { hasText: `redraw ${i}` })).toHaveCount(1);
	}
	expect((await listeners()).length).toBe(1);
	expect(await page.evaluate(() => {
		const w = window as unknown as { __btTaskListeners: Set<() => void>; __btFirst?: () => void };
		return w.__btFirst !== undefined && w.__btTaskListeners.has(w.__btFirst);
	}), 'the subscription is the one taken on the first draw').toBe(true);
});

test('a table that is not a tasks table does not listen to the vault', async ({ page, renderBlock }) => {
	await renderBlock('---\nversion: 2\ncolumns:\n  - { id: c_a, name: A }\nrows:\n  - { id: r_a, cells: { c_a: x } }\n---\n');
	expect(await page.evaluate(() => (window as unknown as { __btTaskListeners: Set<() => void> }).__btTaskListeners.size)).toBe(0);
});

test.describe('the query', () => {
	const EMPTY = block('').replace(/query: \|\n\s+\n/, 'query: ""\n');
	const dialog = (page: import('@playwright/test').Page) => page.locator('.modal .bt-tasks-query-input');
	const save = (page: import('@playwright/test').Page) => page.locator('.modal button', { hasText: 'Save' }).click();

	test('a table without a query says so, offers to write one, and does not list every task in the vault', async ({ page, renderBlock }) => {
		expect(EMPTY).toContain('query: ""');
		await renderBlock(EMPTY, { tasksFrom: NOTES });
		await expect(page.locator('.bt-tasks-query-missing')).toContainText('no query yet');
		await expect(page.locator('td.bt-td')).toHaveCount(0);
		await expect(page.locator('.bt-tasks-query-missing button')).toHaveText('Write the query');
	});

	test('a query of only comments counts as none', async ({ page, renderBlock }) => {
		await renderBlock(block('# later'), { tasksFrom: NOTES });
		await expect(page.locator('.bt-tasks-query-missing')).toHaveCount(1);
	});

	test('the button asks for the query and saves it to the note', async ({ page, renderBlock }) => {
		const b = await renderBlock(EMPTY, { tasksFrom: NOTES });
		await page.locator('.bt-tasks-query-missing button').click();
		await dialog(page).fill('done');
		await save(page);
		await expect.poll(() => b.noteText()).toContain('done');
		await b.reprocess();
		await expect.poll(() => texts(page, 0)).toEqual(['old thing']);
	});

	test('closing the dialog without saving leaves the note as it was', async ({ page, renderBlock }) => {
		const b = await renderBlock(EMPTY, { tasksFrom: NOTES });
		const before = await b.noteText();
		await page.locator('.bt-tasks-query-missing button').click();
		await dialog(page).fill('done');
		await page.keyboard.press('Escape');
		await expect(page.locator('.modal')).toHaveCount(0);
		await page.waitForTimeout(200);
		expect(await b.noteText()).toBe(before);
	});

	test('the toolbar button opens the dialog with the query the table has, and saving rewrites it', async ({ page, renderBlock }) => {
		const b = await renderBlock(block('not done\nsort by due'), { tasksFrom: NOTES });
		await page.locator('table.bt-table').hover();
		await page.locator('.bt-ctrl-btn[aria-label="Edit tasks query"]').click();
		await expect(dialog(page)).toHaveValue('not done\nsort by due\n');
		await dialog(page).fill('done');
		await save(page);
		await expect.poll(() => b.noteText()).not.toContain('sort by due');
		expect(await b.noteText()).toContain('done');
	});

	test('a locked tasks table has no such button: its query cannot be changed', async ({ page, renderBlock }) => {
		await renderBlock(block('not done', 'locked: true\n'), { tasksFrom: NOTES });
		await expect(page.locator('.bt-ctrl-col')).toHaveCount(1);
		await expect(page.locator('.bt-ctrl-btn[aria-label="Edit tasks query"]')).toHaveCount(0);
	});

	test('a table that is not a tasks table has no such button', async ({ page, renderBlock }) => {
		await renderBlock('---\nversion: 2\ncolumns:\n  - { id: c_a, name: A }\nrows:\n  - { id: r_a, cells: { c_a: x } }\n---\n');
		await page.locator('table.bt-table').hover();
		await expect(page.locator('.bt-ctrl-btn[aria-label="Edit tasks query"]')).toHaveCount(0);
	});
});

// A tasks table's column shows a property of each task. The header menu's row that gives a column a type in other
// tables chooses that property here, so a column is added and set up without writing the block by hand.
test.describe('choosing what a column shows', () => {
	const openHeader = (page: import('@playwright/test').Page, col: number) =>
		page.locator(`th[data-row="0"][data-col="${col}"]`).dblclick();

	test('a column inserted from the header menu, given a field, shows it for every task', async ({ page, renderBlock }) => {
		const b = await renderBlock(block('tags include #work'), { tasksFrom: NOTES });
		await openHeader(page, 2);
		await page.locator('.bt-cell-panel .bt-cp-item', { hasText: 'Insert column after' }).click();
		await expect.poll(async () => (await b.noteText()).match(/- id: c_/g)?.length).toBe(4);
		await b.reprocess();
		await expect(page.locator('th.bt-th')).toHaveCount(4);

		await openHeader(page, 3);
		const row = page.locator('.bt-cell-panel .bt-cp-type-row');
		await expect(row).toHaveText(/Choose field/);
		await row.click();
		expect(await pick(page, 'Priority (priority)')).toBe(true);

		await expect.poll(() => b.noteText()).toMatch(/name: Priority\s+field: priority/);
		await b.reprocess();
		await expect(page.locator('.bt-th-text').nth(3)).toHaveText('Priority');
		await expect.poll(() => texts(page, 3)).toEqual(['⏫']);
	});

	test('changing a column’s field changes what it shows and the name it was given for it', async ({ page, renderBlock }) => {
		const b = await renderBlock(block('tags include #work'), { tasksFrom: NOTES });
		await openHeader(page, 1);
		const row = page.locator('.bt-cell-panel .bt-cp-type-row');
		await expect(row).toHaveText(/Field: Due/);
		await row.click();
		const menu = await page.evaluate(() => window.RichTableReal.ShimMenu.opened.at(-1)?.items.map(i => ({ title: i.title, checked: i.checked })));
		expect(menu?.find(i => i.checked)?.title).toBe('Due (due)');
		expect(menu?.some(i => i.title === 'date')).toBe(false);
		expect(await pick(page, 'Path (path)')).toBe(true);

		// The column keeps its width; its name and its alignment follow the new field.
		await expect.poll(() => b.noteText()).toMatch(/id: c_due\s+name: Path\s+width: 100\s+align: left\s+field: path/);
		await b.reprocess();
		await expect.poll(() => texts(page, 1)).toEqual(['proj/a.md']);
	});

	test('a table in the note still offers column types there', async ({ page, renderBlock }) => {
		await renderBlock('---\nversion: 2\ncolumns:\n  - { id: c_a, name: A }\nrows:\n  - { id: r_a, cells: { c_a: x } }\n---\n');
		await openHeader(page, 0);
		const row = page.locator('.bt-cell-panel .bt-cp-type-row');
		await expect(row).toHaveText(/Set type/);
		await row.click();
		const titles = await page.evaluate(() => window.RichTableReal.ShimMenu.opened.at(-1)?.items.map(i => i.title));
		expect(titles).toContain('No type');
		expect(titles).toContain('date');
		expect(titles?.some(t => t.includes('(due)'))).toBe(false);
	});
});

// Where the cells cannot be edited, a drag selects the text under it, as in a note; with Alt it selects a range of cells,
// whose panel can still copy them. Where they can, a drag selects the range.
test.describe('dragging over cells that cannot be edited', () => {
	type Page = import('@playwright/test').Page;
	const drag = async (page: Page, alt: boolean) => {
		const a = (await page.locator('td[data-row="1"][data-col="0"]').boundingBox())!;
		const b = (await page.locator('td[data-row="1"][data-col="1"]').boundingBox())!;
		await page.mouse.move(a.x + 6, a.y + a.height / 2);
		if (alt) await page.keyboard.down('Alt');
		await page.mouse.down();
		await page.mouse.move(b.x + 8, b.y + b.height / 2, { steps: 6 });
		await page.mouse.up();
		if (alt) await page.keyboard.up('Alt');
	};
	const text = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? '');
	const PLAIN = (extra = '') => `---\nversion: 2\n${extra}columns:\n  - { id: c_a, name: A, width: 200 }\n  - { id: c_b, name: B, width: 200 }\nrows:\n  - { id: r_a, cells: { c_a: "write the report", c_b: y } }\n---\n`;

	test('a tasks table: a drag selects the text', async ({ page, renderBlock }) => {
		await renderBlock(block('tags include #work'), { tasksFrom: NOTES });
		await drag(page, false);
		expect(await text(page)).toContain('write the report');
		await expect(page.locator('.bt-selected')).toHaveCount(0);
	});

	test('a tasks table: Alt selects the cells and the panel can copy them', async ({ page, renderBlock }) => {
		await renderBlock(block('tags include #work'), { tasksFrom: NOTES });
		await drag(page, true);
		await expect(page.locator('.bt-selected')).toHaveCount(2);
		await expect(page.locator('.bt-cell-panel .bt-cp-item', { hasText: 'Copy as Excel' })).toBeVisible();
	});

	test('a locked table: a drag selects the text, Alt the cells', async ({ page, renderBlock }) => {
		await renderBlock(PLAIN('locked: true\n'));
		await drag(page, false);
		expect(await text(page)).toContain('write the report');
		await expect(page.locator('.bt-selected')).toHaveCount(0);
		await page.mouse.click(5, 5);
		await drag(page, true);
		await expect(page.locator('.bt-selected')).toHaveCount(2);
		await expect(page.locator('.bt-cell-panel .bt-cp-item', { hasText: 'Copy as Excel' })).toBeVisible();
	});

	test('a table whose cells can be edited: a drag selects the cells', async ({ page, renderBlock }) => {
		await renderBlock(PLAIN());
		await drag(page, false);
		await expect(page.locator('.bt-selected')).toHaveCount(2);
		expect(await text(page)).toBe('');
	});
});

// A task's file and path are links to the note it is in. A click opens that note at the task's line; the modifier keys
// choose where, as for any link.
test.describe('jumping to a task', () => {
	const link = (page: import('@playwright/test').Page, row: number) =>
		page.locator(`td[data-row="${row}"][data-col="2"] a.internal-link`);

	test('the file column links to the note, and a click opens it at the task’s line', async ({ page, renderBlock }) => {
		const b = await renderBlock(block('tags include #work'), { tasksFrom: NOTES });
		await expect(link(page, 1)).toHaveText('a');
		await expect(link(page, 1)).toHaveAttribute('data-href', 'proj/a.md');
		await link(page, 1).click();
		const opened = await b.linkOpenings();
		expect(opened).toEqual([{ kind: 'internal', href: 'proj/a.md', sourcePath: 'note.md', where: false, state: { eState: { line: 1 } } }]);
		await expect(page.locator('.bt-editing')).toHaveCount(0);
	});

	test('each task opens its own note and its own line', async ({ page, renderBlock }) => {
		const b = await renderBlock(block('not done\nsort by due'), { tasksFrom: NOTES });
		const files = await page.locator('td[data-col="2"] a.internal-link').allInnerTexts();
		expect(files).toEqual(['b', 'a', 'c', 'a', 'b']);
		await link(page, 1).click();
		await link(page, 3).click();
		const opened = await b.linkOpenings();
		expect(opened.map(o => [o.href, (o.state as { eState: { line: number } }).eState.line])).toEqual([['proj/b.md', 0], ['other/c.md', 0]]);
	});

	test('Ctrl asks for a new tab', async ({ page, renderBlock }) => {
		const b = await renderBlock(block('tags include #work'), { tasksFrom: NOTES });
		await link(page, 1).click({ modifiers: ['Control'] });
		expect((await b.linkOpenings())[0]?.where).toBe('tab');
	});

	test('a table with no file or path column has nothing to jump from', async ({ page, renderBlock }) => {
		await renderBlock(block('tags include #work').replace(COLUMNS, '').replace('\n---\n', '\ncolumns:\n  - { id: c_body, name: Task, field: body }\n---\n'), { tasksFrom: NOTES });
		await expect(page.locator('td a.internal-link')).toHaveCount(0);
	});

	test('a link a person wrote in an ordinary table is not taken over', async ({ page, renderBlock }) => {
		const b = await renderBlock('---\nversion: 2\ncolumns:\n  - { id: c_a, name: A, width: 200 }\nrows:\n  - { id: r_a, cells: { c_a: "[[Some note]]" } }\n---\n');
		await expect(page.locator('td a.internal-link')).toHaveText('Some note');
		await page.locator('td a.internal-link').click();
		expect(await b.linkOpenings()).toEqual([]);
	});
});
