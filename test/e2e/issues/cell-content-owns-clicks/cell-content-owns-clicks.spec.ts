import { test, expect } from '../../common/test-base';

// Content a cell renders can carry its own controls (a task's checkbox, a link, a nested table). A press on one is the
// control's: the cell around it neither starts editing nor starts a drag selection from it.
const SOURCE = `---
version: 2
columns:
  - { id: c_0, name: A, width: 160 }
  - { id: c_1, name: B, width: 160 }
rows:
  - { id: r_0, cells: { c_0: "x", c_1: "y" } }
  - { id: r_1, cells: { c_0: "p", c_1: "q" } }
---
`;

const CELL = 'td[data-row="1"][data-col="0"]';

/** Puts one control into the cell and counts the presses that reach it. */
const put = (page: import('@playwright/test').Page, kind: 'checkbox' | 'button' | 'link' | 'nested') =>
	page.evaluate(([kind, cellSel]) => {
		const cell = document.querySelector<HTMLElement>(cellSel!)!;
		cell.innerHTML = '';
		const w = window as unknown as { __reached: number; __down: string };
		w.__reached = 0;
		w.__down = '';
		let el: HTMLElement;
		if (kind === 'checkbox') {
			el = document.createElement('input');
			(el as HTMLInputElement).type = 'checkbox';
			el.className = 'task-list-item-checkbox';
		} else if (kind === 'button') {
			el = document.createElement('button');
			el.textContent = 'go';
		} else if (kind === 'link') {
			el = document.createElement('a');
			el.className = 'external-link';
			el.setAttribute('href', '#x');
			el.textContent = 'link';
		} else {
			const root = document.createElement('div');
			root.className = 'bt-render-root';
			const t = document.createElement('table');
			const tb = document.createElement('tbody');
			const tr = document.createElement('tr');
			el = document.createElement('td');
			el.dataset.row = '1';
			el.dataset.col = '0';
			el.textContent = 'inner';
			tr.appendChild(el);
			tb.appendChild(tr);
			t.appendChild(tb);
			root.appendChild(t);
			cell.appendChild(root);
		}
		el.style.minWidth = '40px';
		el.style.minHeight = '20px';
		el.addEventListener('click', (e) => { w.__reached++; e.preventDefault(); });
		el.addEventListener('mousedown', (e) => { w.__down = e.defaultPrevented ? 'prevented' : 'free'; });
		document.addEventListener('mousedown', (e) => { w.__down = e.defaultPrevented ? 'prevented' : 'free'; }, { once: true });
		if (kind !== 'nested') cell.appendChild(el);
		return null;
	}, [kind, CELL] as const);

const press = (page: import('@playwright/test').Page) =>
	page.locator(`${CELL} :is(input, button, a, td)`).first().click();

const state = (page: import('@playwright/test').Page) => page.evaluate(() => ({
	reached: (window as unknown as { __reached: number }).__reached,
	down: (window as unknown as { __down: string }).__down,
	editing: document.querySelectorAll('.bt-editing').length,
}));

test.describe('a press on content a cell renders', () => {
	for (const kind of ['button', 'link', 'nested'] as const) {
		test(`on ${kind === 'nested' ? 'a nested table’s cell' : `a ${kind}`} is the content’s: the cell does not edit`, async ({ page, renderBlock }) => {
			await renderBlock(SOURCE);
			await put(page, kind);
			await press(page);
			await page.waitForTimeout(400); // past the delay that tells a click from a double click
			const s = await state(page);
			expect(s.reached, 'the content got its click').toBe(1);
			expect(s.editing, 'the cell did not start editing').toBe(0);
			expect(s.down, 'the press was not taken from it').toBe('free');
		});
	}

	test('on the cell’s own text still edits it', async ({ page, renderBlock }) => {
		await renderBlock(SOURCE);
		await page.locator(CELL).click();
		await expect(page.locator('.bt-editing')).toHaveCount(1);
	});

	test('on text beside a control in the same cell still edits it', async ({ page, renderBlock }) => {
		await renderBlock(SOURCE);
		await put(page, 'checkbox');
		const box = (await page.locator(CELL).boundingBox())!;
		// The cell’s right padding: inside the cell, clear of the checkbox.
		await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
		await expect(page.locator('.bt-editing')).toHaveCount(1);
	});

	test('on a nested table’s cell does not select the outer cell at the same row and column', async ({ page, renderBlock }) => {
		await renderBlock(SOURCE);
		await put(page, 'nested');
		await press(page);
		await expect(page.locator('.bt-selected')).toHaveCount(0);
	});

	test('on a control starts no selection, and a drag over other cells still selects them', async ({ page, renderBlock }) => {
		await renderBlock(SOURCE);
		await put(page, 'checkbox');
		await press(page);
		await expect(page.locator('.bt-selected')).toHaveCount(0);

		const from = (await page.locator('td[data-row="1"][data-col="1"]').boundingBox())!;
		const to = (await page.locator('td[data-row="2"][data-col="1"]').boundingBox())!;
		await page.mouse.move(from.x + 8, from.y + 8);
		await page.mouse.down();
		await page.mouse.move(to.x + 8, to.y + 8, { steps: 4 });
		await page.mouse.up();
		await expect(page.locator('.bt-selected')).toHaveCount(2);
	});
});

// Obsidian draws a task's checkbox but only a note's own view writes a tick back; in a cell the table does. A theme or
// a plugin may hide that checkbox and draw a stand-in, so the press is read from the task item, not from the input.
test.describe('a task a cell renders', () => {
	const TASKS = `---
version: 2
columns:
  - { id: c_0, name: A, width: 200 }
  - { id: c_1, name: B, width: 200 }
rows:
  - id: r_0
    cells:
      c_0: |-
        - [ ] first
        - [x] second
        - [ ] third
      c_1: "- [ ] other cell"
---
`;
	type Page = import('@playwright/test').Page;
	const cell = (row: number, col: number) => `td[data-row="${row}"][data-col="${col}"]`;
	const box = (page: Page, row: number, col: number, n: number) => page.locator(`${cell(row, col)} input.task-list-item-checkbox`).nth(n);
	/** A task as a plugin that takes over the checkbox draws it: the input hidden, a state icon beside it. */
	const standIn = (page: Page, row: number, col: number) => page.evaluate((sel) => {
		for (const input of document.querySelectorAll<HTMLInputElement>(`${sel} input.task-list-item-checkbox`)) {
			input.style.display = 'none';
			const holder = document.createElement('span');
			holder.className = 'task-state-container';
			const mark = document.createElement('span');
			mark.className = 'task-state';
			mark.textContent = input.checked ? 'x' : ' ';
			mark.style.cssText = 'display:inline-block;min-width:14px;min-height:14px';
			holder.append(mark);
			input.after(holder);
		}
	}, cell(row, col));
	const icon = (page: Page, row: number, col: number, n: number) => page.locator(`${cell(row, col)} .task-state`).nth(n);

	test('is ticked by clicking its checkbox, and only that line of that cell changes', async ({ page, renderBlock }) => {
		const b = await renderBlock(TASKS);
		await box(page, 1, 0, 2).click();
		await expect.poll(() => b.noteText()).toMatch(/- \[ \] first\s+- \[x\] second\s+- \[x\] third/);
		expect(await b.noteText()).toContain('- [ ] other cell');
		await expect(page.locator('.bt-editing')).toHaveCount(0);
	});

	test('is unticked by clicking a ticked checkbox', async ({ page, renderBlock }) => {
		const b = await renderBlock(TASKS);
		await box(page, 1, 0, 1).click();
		await expect.poll(() => b.noteText()).toMatch(/- \[ \] first\s+- \[ \] second\s+- \[ \] third/);
	});

	test('is ticked by the stand-in a plugin draws over a hidden checkbox', async ({ page, renderBlock }) => {
		const b = await renderBlock(TASKS);
		await standIn(page, 1, 0);
		await icon(page, 1, 0, 2).click();
		await expect.poll(() => b.noteText()).toMatch(/- \[ \] first\s+- \[x\] second\s+- \[x\] third/);
		await expect(page.locator('.bt-editing')).toHaveCount(0);
	});

	test('is the one pressed that changes, whatever the order the stand-ins are pressed in', async ({ page, renderBlock }) => {
		const b = await renderBlock(TASKS);
		await standIn(page, 1, 0);
		await icon(page, 1, 0, 0).click();
		await expect.poll(() => b.noteText()).toMatch(/- \[x\] first\s+- \[x\] second\s+- \[ \] third/);
	});

	test('is not changed by a press on its text, which edits the cell as before', async ({ page, renderBlock }) => {
		const b = await renderBlock(TASKS);
		const before = await b.noteText();
		const list = (await page.locator(`${cell(1, 0)} .bt-list-block`).boundingBox())!;
		await page.mouse.click(list.x + list.width - 4, list.y + 6);
		await page.waitForTimeout(400);
		expect(await b.noteText()).toBe(before);
	});

	test('shows the tick after the rebuild that follows the write', async ({ page, renderBlock }) => {
		const b = await renderBlock(TASKS);
		await box(page, 1, 1, 0).click();
		await expect.poll(() => b.noteText()).toContain('- [x] other cell');
		await b.reprocess();
		await expect(box(page, 1, 1, 0)).toBeChecked();
	});

	test('in a table that cannot be changed is not ticked', async ({ page, renderBlock }) => {
		const b = await renderBlock(TASKS.replace('rows:', 'locked: true\nrows:'));
		const before = await b.noteText();
		await box(page, 1, 0, 0).click();
		await page.waitForTimeout(300);
		expect(await b.noteText()).toBe(before);
		await expect(box(page, 1, 0, 0)).not.toBeChecked();
	});
});
