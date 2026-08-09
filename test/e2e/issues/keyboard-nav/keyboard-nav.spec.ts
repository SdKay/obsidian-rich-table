import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

/**
 * Keyboard cell navigation — three states (Other / Selected / Editing), see the
 * design in the vault at 2-projects/active/rich-table/solutions/cell-navigation.md.
 *
 * Reaching Selected state is worth spelling out, because it is NOT "click a
 * cell": a click enters Editing (after the classic 200ms delay), and the tbody's
 * own mouseup clears the drag range behind it. Escape out of Editing is the
 * entry point, exactly as specified — so every test here starts click → wait for
 * the editor → Escape.
 */

const SOURCE = tableSource({
	widths: [80, 80, 80],
	rows: [
		{ 0: 'a1', 1: 'b1', 2: 'c1' },
		{ 0: 'a2', 1: 'b2', 2: 'c2' },
	],
});

/** Click a cell, let its editor open, then Escape into Selected state. */
async function selectViaEscape(page: import('@playwright/test').Page, row: number, col: number): Promise<void> {
	await page.locator(`[data-row="${row}"][data-col="${col}"]`).click();
	await expect.poll(() => page.locator(`[data-row="${row}"][data-col="${col}"].bt-editing`).count()).toBe(1);
	await page.keyboard.press('Escape');
	await expect.poll(() => page.locator(`[data-row="${row}"][data-col="${col}"].bt-selected`).count()).toBe(1);
}

test.describe('keyboard-nav — reaching Selected state', () => {
	test('Escape out of an editor leaves that cell Selected', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="0"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);

		await page.keyboard.press('Escape');
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(0);
		await expect.poll(() => page.locator('[data-row="1"][data-col="0"].bt-selected').count()).toBe(1);
	});

	test('Enter commits and leaves that cell Selected', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="0"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('committed');

		await page.keyboard.press('Enter');
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(0);
		await expect.poll(() => page.locator('[data-row="1"][data-col="0"].bt-selected').count()).toBe(1);
		// Unlike Escape, Enter persists.
		const ops = await page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps);
		expect(ops).toContainEqual(expect.objectContaining({ type: 'set-cell-content', value: 'committed' }));
	});

	test('Enter on an unchanged cell still lands in Selected, writing nothing', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="1"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);

		await page.keyboard.press('Enter');
		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-selected').count()).toBe(1);
		const ops = await page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps);
		expect(ops, 'an unchanged commit should not queue a write').toEqual([]);
	});

	test('Escape restores the cell\'s original content — it cancels, not commits', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="0"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('thrown away');
		await page.keyboard.press('Escape');

		await expect.poll(() => page.locator('[data-row="1"][data-col="0"]').innerText()).toContain('a1');
		const ops = await page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps);
		expect(ops, 'Escape must not persist anything').toEqual([]);
	});
});

test.describe('keyboard-nav — moving the Selected cell', () => {
	test('ArrowRight moves the selection one column over', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await selectViaEscape(page, 1, 0);

		await page.keyboard.press('ArrowRight');
		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-selected').count()).toBe(1);
		expect(await page.locator('[data-row="1"][data-col="0"].bt-selected').count()).toBe(0);
	});

	test('ArrowDown moves the selection one row down', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await selectViaEscape(page, 1, 1);

		await page.keyboard.press('ArrowDown');
		await expect.poll(() => page.locator('[data-row="2"][data-col="1"].bt-selected').count()).toBe(1);
	});

	test('Tab at the end of a row wraps to the next row\'s first column', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await selectViaEscape(page, 1, 2);

		await page.keyboard.press('Tab');
		await expect.poll(() => page.locator('[data-row="2"][data-col="0"].bt-selected').count()).toBe(1);
	});

	test('Shift+Tab at the start of a row wraps to the previous row\'s last column', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await selectViaEscape(page, 2, 0);

		await page.keyboard.press('Shift+Tab');
		await expect.poll(() => page.locator('[data-row="1"][data-col="2"].bt-selected').count()).toBe(1);
	});

	test('ArrowDown at the last row does nothing — clamps, never wraps around', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await selectViaEscape(page, 2, 0);

		await page.keyboard.press('ArrowDown');
		// Still on the same cell, and no other cell picked up the highlight.
		await expect.poll(() => page.locator('[data-row="2"][data-col="0"].bt-selected').count()).toBe(1);
		expect(await page.locator('.bt-selected').count()).toBe(1);
	});

	test('the selection stays a single cell — navigation never grows a range', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await selectViaEscape(page, 1, 0);

		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowDown');
		await expect.poll(() => page.locator('[data-row="2"][data-col="1"].bt-selected').count()).toBe(1);
		expect(await page.locator('.bt-selected').count()).toBe(1);
	});
});

test.describe('keyboard-nav — Editing state, text columns', () => {
	test('Tab commits and moves to the next cell, landing Selected rather than Editing', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="0"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('tabbed');

		await page.keyboard.press('Tab');
		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-selected').count()).toBe(1);
		expect(await page.locator('.bt-editing').count(),
			'Tab must not chain straight into editing the next cell').toBe(0);
		const ops = await page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps);
		expect(ops).toContainEqual(expect.objectContaining({ type: 'set-cell-content', value: 'tabbed' }));
	});

	test('Shift+Tab commits and moves to the previous cell', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="1"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);

		await page.keyboard.press('Shift+Tab');
		await expect.poll(() => page.locator('[data-row="1"][data-col="0"].bt-selected').count()).toBe(1);
		expect(await page.locator('.bt-editing').count()).toBe(0);
	});

	test('Tab in the last column wraps onto the next row', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="2"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);

		await page.keyboard.press('Tab');
		await expect.poll(() => page.locator('[data-row="2"][data-col="0"].bt-selected').count()).toBe(1);
	});

	test('ArrowLeft/ArrowRight move the caret while there is text to move through', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="0"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);

		// Collapse the select-all, then walk the caret and type in the middle: proof
		// the arrows acted inside the text rather than leaving the cell.
		await page.keyboard.press('ArrowRight');   // caret to end ('a1|')
		await page.keyboard.press('ArrowLeft');    // between the two characters ('a|1')
		await page.keyboard.type('X');

		expect(await page.locator('[data-row="1"][data-col="0"].bt-editing').count(),
			'an arrow key mid-text must not end the edit').toBe(1);
		expect(await page.locator('[data-row="1"][data-col="0"] .bt-cell-editor').textContent()).toBe('aX1');
		expect(await page.locator('.bt-selected').count(), 'no other cell should have been selected').toBe(0);
	});

	test('ArrowRight at the end of the text commits and moves to the next cell', async ({ page, renderFull }) => {
		// Left to the browser, an arrow key at the edge of a contenteditable moves the
		// insertion point OUT of it — in Live Preview that means out of the CodeMirror
		// widget and into the surrounding note, taking the keyboard with it. Claiming
		// the key at the boundary keeps navigation inside the grid and makes the
		// behaviour the same in every view mode.
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="0"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('ArrowRight');   // collapse select-all to the end
		await page.keyboard.press('ArrowRight');   // already at the end → navigate

		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-selected').count()).toBe(1);
		expect(await page.locator('.bt-editing').count()).toBe(0);
	});

	test('ArrowLeft at the start of the text commits and moves to the previous cell', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="1"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('ArrowLeft');    // collapse select-all to the start
		await page.keyboard.press('ArrowLeft');    // already at the start → navigate

		await expect.poll(() => page.locator('[data-row="1"][data-col="0"].bt-selected').count()).toBe(1);
		expect(await page.locator('.bt-editing').count()).toBe(0);
	});

	test('an edit typed at the boundary is committed by the arrow, not lost', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="0"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('typed');        // caret ends up after the text

		await page.keyboard.press('ArrowRight');  // at the end → commit and move
		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-selected').count()).toBe(1);
		const ops = await page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps);
		expect(ops).toContainEqual(expect.objectContaining({ type: 'set-cell-content', value: 'typed' }));
	});

	test('an arrow with text selected collapses that selection instead of navigating', async ({ page, renderFull }) => {
		// A click opens with everything selected, which is not a caret at the edge —
		// the first press has to behave like ordinary text editing or the cell could
		// never be edited by keyboard at all.
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="1"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);

		await page.keyboard.press('ArrowLeft');
		expect(await page.locator('[data-row="1"][data-col="1"].bt-editing').count(),
			'the first arrow only collapsed the selection; it must not navigate').toBe(1);
	});

	test('a multi-character cell needs the caret walked all the way out before it navigates', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="0"]').click();  // 'a1'
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);

		await page.keyboard.press('ArrowLeft');   // collapse to start
		expect(await page.locator('.bt-editing').count(), 'collapse only').toBe(1);
		await page.keyboard.press('ArrowRight');  // between 'a' and '1'
		expect(await page.locator('.bt-editing').count(), 'mid-text').toBe(1);
		await page.keyboard.press('ArrowRight');  // after '1' — at the end
		expect(await page.locator('.bt-editing').count(), 'reached the end, still editing').toBe(1);
		await page.keyboard.press('ArrowRight');  // now it navigates
		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-selected').count()).toBe(1);
	});

	test('ArrowUp/ArrowDown jump to the start/end of the WHOLE content, not the previous/next line', async ({ page, renderFull }) => {
		// Multi-line content is what makes this assertion mean anything. With a
		// single line, the browser's own ArrowUp/ArrowDown already land on the start
		// and end of that line, so the test would pass with the handler removed
		// entirely — it did, until this was rewritten. Across three lines the two
		// behaviours diverge: native moves one visual line, this moves to the very
		// start/end of the cell.
		const editor = page.locator('[data-row="1"][data-col="0"] .bt-cell-editor');
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="0"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('one');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('two');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('three');   // caret at the end of the LAST line

		// Up from there: to the very beginning, so this prepends. Native would have
		// moved up one line and typed inside 'two'.
		await page.keyboard.press('ArrowUp');
		await page.keyboard.type('<');
		expect((await editor.innerText()).startsWith('<one'),
			`ArrowUp landed mid-content, not at the start: ${JSON.stringify(await editor.innerText())}`).toBe(true);

		// Down from the beginning: to the very end, so this appends. Native would
		// have moved down one line and typed inside 'two'.
		await page.keyboard.press('ArrowDown');
		await page.keyboard.type('>');
		expect((await editor.innerText()).endsWith('three>'),
			`ArrowDown landed mid-content, not at the end: ${JSON.stringify(await editor.innerText())}`).toBe(true);

		expect(await page.locator('[data-row="1"][data-col="0"].bt-editing').count(),
			'the FIRST press in each direction only moves the caret').toBe(1);
	});

	test('ArrowDown from the end of the text commits and moves to the cell below', async ({ page, renderFull }) => {
		// The vertical twin of the ←/→ rule: one press to reach the edge, another to
		// leave. Both presses are needed here because a click starts with the content
		// selected, which is not a caret at the edge.
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="0"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);

		await page.keyboard.press('ArrowDown');    // caret to the end
		expect(await page.locator('.bt-editing').count(), 'still editing after reaching the end').toBe(1);
		await page.keyboard.press('ArrowDown');    // at the end → navigate

		await expect.poll(() => page.locator('[data-row="2"][data-col="0"].bt-selected').count()).toBe(1);
		expect(await page.locator('.bt-editing').count()).toBe(0);
	});

	test('ArrowUp from the start of the text commits and moves to the cell above', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('[data-row="2"][data-col="1"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);

		await page.keyboard.press('ArrowUp');      // caret to the start
		await page.keyboard.press('ArrowUp');      // at the start → navigate

		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-selected').count()).toBe(1);
		expect(await page.locator('.bt-editing').count()).toBe(0);
	});

	test('an edit is committed by the vertical move, not lost', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="0"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('down');          // caret ends up after the text

		await page.keyboard.press('ArrowDown');    // already at the end → commit and move
		await expect.poll(() => page.locator('[data-row="2"][data-col="0"].bt-selected').count()).toBe(1);
		const ops = await page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps);
		expect(ops).toContainEqual(expect.objectContaining({ type: 'set-cell-content', value: 'down' }));
	});

	test('a move clamped at the table edge still leaves the cell selected', async ({ page, renderFull }) => {
		// The editor has already committed and closed by the time the move is
		// resolved, so a clamped direction must fall back to the cell it came from —
		// otherwise the cell ends up neither edited nor selected and the keyboard has
		// nothing to carry on from.
		await renderFull(SOURCE);
		await page.locator('[data-row="2"][data-col="0"]').click();   // last row
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);

		await page.keyboard.press('ArrowDown');    // to the end of the text
		await page.keyboard.press('ArrowDown');    // tries to leave; there is no row below

		await expect.poll(() => page.locator('[data-row="2"][data-col="0"].bt-selected').count()).toBe(1);
		expect(await page.locator('.bt-editing').count()).toBe(0);
		expect(await page.locator('.bt-selected').count()).toBe(1);
	});

	test('multi-line content keeps its own caret movement — Shift+Enter still adds a line', async ({ page, renderFull }) => {
		// The reason arrows stay in-cell: a cell can hold several lines, and the
		// arrows are how you move around them.
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="0"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('one');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('two');

		expect(await page.locator('[data-row="1"][data-col="0"] .bt-cell-editor').innerText()).toContain('one');
		expect(await page.locator('[data-row="1"][data-col="0"] .bt-cell-editor').innerText()).toContain('two');
		expect(await page.locator('[data-row="1"][data-col="0"].bt-editing').count()).toBe(1);
	});
});

test.describe('keyboard-nav — Editing state, date columns', () => {
	// Column 1 is a date column, so clicking it opens a native <input type="date">
	// rather than the text editor — a different editor with different key handling.
	const DATED = tableSource({
		widths: [80, 110, 80],
		types: [undefined, 'date'],
		rows: [
			{ 0: 'a1', 1: '2026-01-15', 2: 'c1' },
			{ 0: 'a2', 1: '2026-02-20', 2: 'c2' },
		],
	});

	test('clicking a date cell opens the date input, not the text editor', async ({ page, renderFull }) => {
		await renderFull(DATED);
		await page.locator('[data-row="1"][data-col="1"]').click();
		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-editing').count()).toBe(1);

		expect(await page.locator('[data-row="1"][data-col="1"] .bt-date-input').count()).toBe(1);
		expect(await page.locator('.bt-cell-editor').count()).toBe(0);
	});

	test('Tab commits the date and moves on, landing Selected', async ({ page, renderFull }) => {
		await renderFull(DATED);
		await page.locator('[data-row="1"][data-col="1"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);

		await page.keyboard.press('Tab');
		await expect.poll(() => page.locator('[data-row="1"][data-col="2"].bt-selected').count()).toBe(1);
		expect(await page.locator('.bt-editing').count()).toBe(0);
	});

	test('Shift+Tab moves back to the previous cell', async ({ page, renderFull }) => {
		await renderFull(DATED);
		await page.locator('[data-row="1"][data-col="1"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);

		await page.keyboard.press('Shift+Tab');
		await expect.poll(() => page.locator('[data-row="1"][data-col="0"].bt-selected').count()).toBe(1);
	});

	test('Escape leaves the date cell Selected, keeping its original value', async ({ page, renderFull }) => {
		await renderFull(DATED);
		await page.locator('[data-row="1"][data-col="1"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);

		await page.keyboard.press('Escape');
		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-selected').count()).toBe(1);
		const ops = await page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps);
		expect(ops).toEqual([]);
	});

	test('arrow keys stay inside the date input — they step its segments, not the selection', async ({ page, renderFull }) => {
		// The native input's own ←/→ (segment) and ↑/↓ (step the focused segment) are
		// strictly more useful here than a jump-to-start/end would be, so this editor
		// deliberately doesn't intercept them. What matters is that no arrow key
		// leaks out and moves the cell selection instead.
		await renderFull(DATED);
		await page.locator('[data-row="1"][data-col="1"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);

		for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
			await page.keyboard.press(key);
		}
		expect(await page.locator('[data-row="1"][data-col="1"].bt-editing').count(),
			'an arrow key must not end the date edit').toBe(1);
		expect(await page.locator('.bt-selected').count(),
			'an arrow key must not move the cell selection while the picker is open').toBe(0);
	});

	test('navigating INTO a date cell selects it without opening the picker', async ({ page, renderFull }) => {
		await renderFull(DATED);
		await page.locator('[data-row="1"][data-col="0"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Escape');
		await expect.poll(() => page.locator('[data-row="1"][data-col="0"].bt-selected').count()).toBe(1);

		await page.keyboard.press('ArrowRight');
		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-selected').count()).toBe(1);
		expect(await page.locator('.bt-editing').count(),
			'arrowing onto a cell selects it; it does not start editing').toBe(0);

		// ...and Enter from there does open the picker.
		await page.keyboard.press('Enter');
		await expect.poll(() => page.locator('[data-row="1"][data-col="1"] .bt-date-input').count()).toBe(1);
	});
});

test.describe('keyboard-nav — Editing state, choice columns', () => {
	// A choice column's "editor" is an Obsidian Menu, which renders to document.body
	// rather than into the cell — so there is no `.bt-editing` cell to detect it by,
	// and it's tracked separately (renderHoverPin.ts).
	//
	// SCOPE OF THESE TESTS: the shim's Menu renders no chrome and adds no keyboard
	// handling, so what's asserted here is this plugin's own wiring — that the open
	// menu is attributed to the right cell, that Tab closes it and moves on, and
	// that arrowing onto such a cell doesn't open it. Whether the REAL Obsidian Menu
	// swallows Tab before it reaches the document listener cannot be reproduced
	// here; that is checked by hand in the app.
	const CHOICES = tableSource({
		widths: [80, 110, 80],
		types: [undefined, 'task-status'],
		rows: [
			{ 0: 'a1', 1: 'done', 2: 'c1' },
			{ 0: 'a2', 1: 'pending', 2: 'c2' },
		],
	});

	test('a choice cell renders a pill, and clicking it opens a menu attributed to that cell', async ({ page, renderFull }) => {
		await renderFull(CHOICES);
		expect(await page.locator('[data-row="1"][data-col="1"] .bt-choice').count()).toBe(1);

		await page.locator('[data-row="1"][data-col="1"]').click();
		await expect.poll(() => page.evaluate(() => {
			const m = window.RichTableReal.getActiveCellMenu();
			return m ? `${m.row},${m.col}` : null;
		})).toBe('1,1');
	});

	test('Tab closes the value menu without picking anything, and moves on', async ({ page, renderFull }) => {
		await renderFull(CHOICES);
		// Reach Selected on the choice cell first, then Enter to open its menu —
		// the keyboard path, not a click.
		await page.locator('[data-row="1"][data-col="0"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Escape');
		await page.keyboard.press('ArrowRight');
		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-selected').count()).toBe(1);
		await page.keyboard.press('Enter');
		await expect.poll(() => page.evaluate(() => !!window.RichTableReal.getActiveCellMenu())).toBe(true);

		await page.keyboard.press('Tab');
		await expect.poll(() => page.evaluate(() => !!window.RichTableReal.getActiveCellMenu()),
			{ message: 'the menu should have been closed' }).toBe(false);
		await expect.poll(() => page.locator('[data-row="1"][data-col="2"].bt-selected').count()).toBe(1);
		const ops = await page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps);
		expect(ops, 'Tab must not pick a value on the way out').toEqual([]);
	});

	test('arrowing onto a choice cell selects it without opening the menu', async ({ page, renderFull }) => {
		await renderFull(CHOICES);
		await page.locator('[data-row="1"][data-col="0"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Escape');

		await page.keyboard.press('ArrowRight');
		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-selected').count()).toBe(1);
		expect(await page.evaluate(() => !!window.RichTableReal.getActiveCellMenu()),
			'navigation alone must not open a value menu').toBe(false);
	});

	test('the menu is attributed to whichever cell opened it most recently', async ({ page, renderFull }) => {
		await renderFull(CHOICES);
		await page.locator('[data-row="1"][data-col="1"]').click();
		await expect.poll(() => page.evaluate(() => window.RichTableReal.getActiveCellMenu()?.row ?? null)).toBe(1);

		await page.locator('[data-row="2"][data-col="1"]').click();
		await expect.poll(() => page.evaluate(() => {
			const m = window.RichTableReal.getActiveCellMenu();
			return m ? `${m.row},${m.col}` : null;
		})).toBe('2,1');
	});

	test('an older menu closing afterwards does not clear the newer one\'s slot', async ({ page, renderFull }) => {
		// The tracker holds a single slot, and opening a second cell's menu takes it
		// over. In the real app, opening a menu also closes the previous one — and if
		// that close is processed AFTER the new menu registered, an unguarded "clear
		// the slot on hide" would strand the menu that's actually open as untracked,
		// leaving Tab unable to close it. The shim never auto-closes, so that order
		// is staged explicitly here: hide the FIRST menu once the second is open.
		await renderFull(CHOICES);
		await page.locator('[data-row="1"][data-col="1"]').click();
		await expect.poll(() => page.evaluate(() => window.RichTableReal.getActiveCellMenu()?.row ?? null)).toBe(1);
		await page.locator('[data-row="2"][data-col="1"]').click();
		await expect.poll(() => page.evaluate(() => window.RichTableReal.getActiveCellMenu()?.row ?? null)).toBe(2);

		const hidFirst = await page.evaluate(() => {
			const first = window.RichTableReal.ShimMenu.opened[0];
			if (!first) return false;
			first.hide();
			return true;
		});
		expect(hidFirst, 'both menus should still be tracked as open by the shim').toBe(true);

		const still = await page.evaluate(() => {
			const m = window.RichTableReal.getActiveCellMenu();
			return m ? `${m.row},${m.col}` : null;
		});
		expect(still, 'the open menu lost its tracking when an older one closed').toBe('2,1');
	});
});

test.describe('keyboard-nav — how a selected cell looks', () => {
	test('a selected cell with no colour of its own gets a neutral fill', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		const cell = page.locator('[data-row="1"][data-col="0"]');
		const before = await cell.evaluate((e: HTMLElement) => getComputedStyle(e).backgroundColor);

		await cell.click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Escape');
		await expect.poll(() => page.locator('[data-row="1"][data-col="0"].bt-selected').count()).toBe(1);

		const after = await cell.evaluate((e: HTMLElement) => getComputedStyle(e).backgroundColor);
		expect(after, 'selecting should change the fill of an unstyled cell').not.toBe(before);
	});

	test("a cell the user has coloured keeps its own colour when selected", async ({ page, renderFull }) => {
		// The rule this pins: user styles are written inline with !important
		// (renderCellStyle.ts), so the selection fill must NOT be !important or it
		// would paint over a colour the user deliberately chose. Stated as a test
		// because the two live in different files and nothing else would catch it.
		await renderFull(tableSource({
			widths: [80, 80],
			rows: [{ 0: 'a1', 1: 'b1' }],
			styles: [{ target: 'r_0.c_0', bg: '#ff0000' }],
		}));
		const cell = page.locator('[data-row="1"][data-col="0"]');
		expect(await cell.evaluate((e: HTMLElement) => getComputedStyle(e).backgroundColor)).toBe('rgb(255, 0, 0)');

		await cell.click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Escape');
		await expect.poll(() => page.locator('[data-row="1"][data-col="0"].bt-selected').count()).toBe(1);

		expect(await cell.evaluate((e: HTMLElement) => getComputedStyle(e).backgroundColor),
			"the selection fill overwrote the user's own cell colour").toBe('rgb(255, 0, 0)');
	});

	test('the cell being edited is outlined but not filled', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		const cell = page.locator('[data-row="1"][data-col="0"]');
		const resting = await cell.evaluate((e: HTMLElement) => getComputedStyle(e).backgroundColor);

		// Selected → filled.
		await cell.click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Escape');
		const selected = await cell.evaluate((e: HTMLElement) => getComputedStyle(e).backgroundColor);
		expect(selected).not.toBe(resting);

		// Editing → back to its normal fill. The cell carries both classes at this
		// point, so this is what the :not(.bt-editing) is for.
		await page.keyboard.press('Enter');
		await expect.poll(() => page.locator('[data-row="1"][data-col="0"].bt-editing').count()).toBe(1);
		expect(await cell.evaluate((e: HTMLElement) => getComputedStyle(e).backgroundColor),
			'an editing cell should not keep the selection fill').toBe(resting);
	});

	test('an open editor is outlined as heavily as a selected cell', async ({ page, renderFull }) => {
		// Reached by a plain click, which is the case where the cell has NO
		// `.bt-selected` at all — so the outline has to come from the editor's own
		// rule. Asserting the two weights match is what keeps them from drifting:
		// selected and editing are alternative states of one cell, and a thinner
		// line on one reads as it being less active.
		await renderFull(SOURCE);
		const cell = page.locator('[data-row="1"][data-col="0"]');

		await cell.click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		expect(await cell.evaluate((e: HTMLElement) => e.classList.contains('bt-selected')),
			'this path should reach Editing without going through Selected').toBe(false);

		const editorOutline = await page.locator('[data-row="1"][data-col="0"] .bt-cell-editor')
			.evaluate((e: HTMLElement) => getComputedStyle(e).outlineWidth);
		expect(parseFloat(editorOutline), 'the editor draws no outline of its own').toBeGreaterThan(0);

		// Now compare against a selected cell's outline in the same table.
		await page.keyboard.press('Escape');
		await expect.poll(() => page.locator('[data-row="1"][data-col="0"].bt-selected').count()).toBe(1);
		const selectedOutline = await cell.evaluate((e: HTMLElement) => getComputedStyle(e).outlineWidth);
		expect(editorOutline, 'editing and selected outlines drifted apart').toBe(selectedOutline);
	});
});

test.describe('keyboard-nav — the header row participates', () => {
	// Header cells go through the same bindCellActivation/enterEditMode path as data
	// cells, and cellNav treats row 0 as one position above row 1 — so this is
	// verification that the header genuinely got threaded, not separate behaviour.
	test('ArrowUp from the first data row reaches the header, same column', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="1"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Escape');
		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-selected').count()).toBe(1);

		await page.keyboard.press('ArrowUp');
		await expect.poll(() => page.locator('[data-row="0"][data-col="1"].bt-selected').count()).toBe(1);
	});

	test('ArrowUp from the header does nothing — there is nothing above it', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="0"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Escape');
		await page.keyboard.press('ArrowUp');
		await expect.poll(() => page.locator('[data-row="0"][data-col="0"].bt-selected').count()).toBe(1);

		await page.keyboard.press('ArrowUp');
		await expect.poll(() => page.locator('[data-row="0"][data-col="0"].bt-selected').count()).toBe(1);
		expect(await page.locator('.bt-selected').count()).toBe(1);
	});

	test('typing while a header cell is Selected renames the column', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="0"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Escape');
		await page.keyboard.press('ArrowUp');
		await expect.poll(() => page.locator('[data-row="0"][data-col="0"].bt-selected').count()).toBe(1);

		await page.keyboard.press('N');
		await expect.poll(() => page.locator('[data-row="0"][data-col="0"].bt-editing').count()).toBe(1);
		expect(await page.locator('[data-row="0"][data-col="0"] .bt-cell-editor').textContent()).toBe('N');

		// Committing a header edit renames the column, not a cell.
		await page.keyboard.press('Enter');
		const ops = await page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps);
		expect(ops).toContainEqual(expect.objectContaining({ type: 'set-col-name', name: 'N' }));
	});

	test('Tab at the header\'s last column wraps into the first data row', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="2"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Escape');
		await page.keyboard.press('ArrowUp');
		await expect.poll(() => page.locator('[data-row="0"][data-col="2"].bt-selected').count()).toBe(1);

		await page.keyboard.press('Tab');
		await expect.poll(() => page.locator('[data-row="1"][data-col="0"].bt-selected').count()).toBe(1);
	});
});

test.describe('keyboard-nav — under the single-click-edit setting', () => {
	// With that setting on, a click opens the editor with no delay and Ctrl/Cmd+click
	// becomes the style-panel gesture (the double-click's job in classic mode). Both
	// modes still land in Editing, so Escape remains the way into Selected — but the
	// path through bindCellActivation is different enough to assert separately.
	test('a click opens the editor immediately, and Escape still yields Selected', async ({ page, renderFull }) => {
		await renderFull(SOURCE, { singleClickEdit: true });
		await page.locator('[data-row="1"][data-col="1"]').click();
		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-editing').count()).toBe(1);

		await page.keyboard.press('Escape');
		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-selected').count()).toBe(1);
	});

	test('navigation and typing behave the same as in classic mode', async ({ page, renderFull }) => {
		await renderFull(SOURCE, { singleClickEdit: true });
		await page.locator('[data-row="1"][data-col="0"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Escape');
		await expect.poll(() => page.locator('[data-row="1"][data-col="0"].bt-selected').count()).toBe(1);

		await page.keyboard.press('ArrowRight');
		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-selected').count()).toBe(1);
		await page.keyboard.press('z');
		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-editing').count()).toBe(1);
		expect(await page.locator('[data-row="1"][data-col="1"] .bt-cell-editor').textContent()).toBe('z');
	});
});

test.describe('keyboard-nav — entering Editing from Selected', () => {
	test('typing a character clears the cell and starts editing with that character', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await selectViaEscape(page, 1, 0);

		await page.keyboard.press('x');
		await expect.poll(() => page.locator('[data-row="1"][data-col="0"].bt-editing').count()).toBe(1);
		expect(await page.locator('[data-row="1"][data-col="0"] .bt-cell-editor').textContent()).toBe('x');
	});

	test('the seeded character leaves the caret after it, with nothing selected', async ({ page, renderFull }) => {
		// The point of seeding is that you keep typing and characters accumulate. If
		// the editor opened with its content SELECTED — which is the right gesture for
		// a click, where the stored value is meant to be replaceable — the second
		// keystroke would replace the first and this would read 'z', not 'xyz'.
		await renderFull(SOURCE);
		await selectViaEscape(page, 1, 0);

		await page.keyboard.press('x');
		await expect.poll(() => page.locator('[data-row="1"][data-col="0"].bt-editing').count()).toBe(1);
		await page.keyboard.type('yz');

		expect(await page.locator('[data-row="1"][data-col="0"] .bt-cell-editor').textContent()).toBe('xyz');
		expect(await page.evaluate(() => window.getSelection()?.toString() ?? ''),
			'nothing should be selected — the caret sits after the seeded text').toBe('');
	});

	test('a click, by contrast, opens the editor with the stored value fully selected', async ({ page, renderFull }) => {
		// The counterpart rule: no typing has happened yet, so the whole existing
		// value is selected and a single keystroke replaces all of it.
		await renderFull(SOURCE);
		await page.locator('[data-row="1"][data-col="0"]').click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);

		expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('a1');
		await page.keyboard.type('Q');
		expect(await page.locator('[data-row="1"][data-col="0"] .bt-cell-editor').textContent()).toBe('Q');
	});

	test('Enter opens the editor keeping the existing content', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await selectViaEscape(page, 1, 0);

		await page.keyboard.press('Enter');
		await expect.poll(() => page.locator('[data-row="1"][data-col="0"].bt-editing').count()).toBe(1);
		expect(await page.locator('[data-row="1"][data-col="0"] .bt-cell-editor').textContent()).toBe('a1');
	});

	test('Backspace clears the cell without opening an editor', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await selectViaEscape(page, 1, 0);

		await page.keyboard.press('Backspace');
		const ops = await page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps);
		expect(ops).toContainEqual(expect.objectContaining({ type: 'set-cell-content', value: '' }));
		expect(await page.locator('.bt-editing').count()).toBe(0);
	});

	test('Backspace on an ALREADY-empty cell writes nothing', async ({ page, renderFull }) => {
		// Column 2 of row 2 has content; column 1 of row 1 does too. Use a source
		// with a genuinely empty cell so the no-op guard is what's under test.
		await renderFull(tableSource({
			widths: [80, 80],
			rows: [{ 0: 'only' }],   // (1, 1) is empty
		}));
		await selectViaEscape(page, 1, 1);

		await page.keyboard.press('Backspace');
		const ops = await page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps);
		expect(ops, 'clearing an empty cell should not queue a write').toEqual([]);
	});
});
