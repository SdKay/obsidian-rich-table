import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Editing a table rewrites the note, and Obsidian responds by tearing the table's
// DOM down and running the code-block processor again over a blank container. That
// rebuild takes a couple of hundred milliseconds — one markdown render per cell —
// and everything that went wrong in this feature went wrong inside that window:
// the table flickered, the page scrolled away from it because the empty container
// had no height, and an edit in progress somewhere else was lost.
//
// None of it was reachable by a test, because reproducing it needs the processor to
// run twice over the same table with a real write in between. That's what these
// tests do.
test.describe('write-back-rebuild', () => {
	// Built through the shared helper rather than hand-written: the front-matter
	// delimiters are load-bearing, and without the leading one the block parses as
	// the legacy format and renders an upgrade banner instead of a table.
	const SOURCE = tableSource({
		widths: [80, 80],
		rows: [{ 0: 'one', 1: 'x' }, { 0: 'two', 1: 'y' }, { 0: 'three', 1: 'z' }],
	});

	test('editing a cell rewrites the note in place', async ({ page, renderBlock }) => {
		const block = await renderBlock(SOURCE);
		const before = await block.noteText();
		expect(before, 'the surrounding note must be present, or the line splice below proves nothing').toContain('# note');

		await page.locator('.bt-td[data-row="1"][data-col="0"]').first().click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('edited');
		await page.keyboard.press('Enter');

		await expect.poll(() => block.noteText()).toContain('edited');
		const after = await block.noteText();
		// Only the block's contents may change — everything around it is someone
		// else's note, and the write is a line splice into it.
		expect(after.startsWith('# note\n\n```rich-table\n'), `note prologue was disturbed:\n${after.slice(0, 60)}`).toBe(true);
		expect(after.trimEnd().endsWith('```')).toBe(true);
		expect(after).not.toContain('one'); // the old value is gone, not duplicated
	});

	test('the table never goes blank across the rebuild', async ({ page, renderBlock }) => {
		const block = await renderBlock(SOURCE);

		// The placeholder that covers the rebuild is a snapshot the OUTGOING instance
		// takes when it writes — so it only exists for a rebuild that follows a write,
		// which is the only kind Obsidian performs here. Committing an edit first is
		// therefore part of the setup, not incidental.
		await page.locator('.bt-td[data-row="1"][data-col="1"]').first().click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('written');
		await page.keyboard.press('Enter');
		await expect.poll(() => block.noteText()).toContain('written');

		// Measured at the instant the rebuild begins, before the async render can have
		// filled anything in. An empty container here is what collapses the document's
		// height and scrolls the table out of view.
		const heightDuring = await page.evaluate(() => {
			const w = window as unknown as { __btBlock: { unload(): void }; __btMount: () => void };
			const host = document.getElementById('root') as HTMLElement;
			w.__btBlock.unload();
			host.replaceChildren();
			w.__btMount();
			return host.getBoundingClientRect().height;
		});
		expect(heightDuring,
			'the container was empty at the instant the rebuild began — this is what collapses the document height and scrolls the table out of view')
			.toBeGreaterThan(0);

		// And it ends up with a real table again, not just the placeholder.
		await expect.poll(() => page.locator('.bt-table .bt-td').count()).toBeGreaterThan(0);
	});

	test('the placeholder is inert — it cannot be typed into', async ({ page, renderBlock }) => {
		// The placeholder is a copy of the previous DOM, so it carries no event
		// wiring at all. If it kept an editable region, a user typing during the
		// rebuild would watch their keystrokes disappear — worse than a blank moment.
		//
		// The setup has to leave a cell mid-edit AT THE MOMENT OF THE WRITE, since
		// that's when the snapshot is taken; an earlier version of this test closed
		// the editor first, so there was no editable region in the snapshot to
		// neutralise and the assertion held no matter what.
		await renderBlock(SOURCE);
		await page.locator('.bt-td[data-row="1"][data-col="0"]').first().click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.type('mid-edit');

		const editableInPlaceholder = await page.evaluate(() => {
			const w = window as unknown as {
				__btBlock: { unload(): void; handleStructuralOp(op: unknown): void };
				__btMount: () => void;
			};
			// A write while the editor is open — the snapshot captures it as it stands.
			w.__btBlock.handleStructuralOp({ type: 'set-row-height', rowId: 'r_0', height: 40 });
			const host = document.getElementById('root') as HTMLElement;
			w.__btBlock.unload();
			host.replaceChildren();
			w.__btMount();
			// Read synchronously: only the placeholder is on screen at this point, the
			// real render is still a few frames away.
			return document.querySelectorAll('[contenteditable="true"]').length;
		});
		expect(editableInPlaceholder,
			'the rebuild placeholder kept an editable region, so keystrokes during the rebuild would be swallowed').toBe(0);
	});

	test('an edit in progress survives the rebuild', async ({ page, renderBlock }) => {
		// Committing one cell rewrites the note, which rebuilds the whole table —
		// including a DIFFERENT cell the user had already started editing. That edit
		// used to be destroyed by the rebuild; it is now resumed, with the draft text
		// intact.
		const block = await renderBlock(SOURCE);
		await page.locator('.bt-td[data-row="2"][data-col="0"]').first().click();
		await expect.poll(() => page.locator('.bt-td[data-row="2"][data-col="0"].bt-editing').count()).toBe(1);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('half typed');

		await block.reprocess();

		await expect.poll(() => page.locator('.bt-td[data-row="2"][data-col="0"].bt-editing').count(),
			{ message: 'the in-progress edit was dropped by the rebuild' }).toBe(1);
		expect(await page.locator('.bt-td[data-row="2"][data-col="0"] .bt-cell-editor').first().textContent(),
			'the edit resumed but lost what had been typed').toContain('half typed');
	});

	test('the hover strips come back after the rebuild without waiting for a mouse move', async ({ page, renderBlock }) => {
		// The strips are driven by the root's own mouseenter, and a rebuild hands over
		// an element that has never received one — so without an explicit handoff they
		// stayed hidden until the user happened to move the pointer, which reads as a
		// flicker since the pointer is usually still sitting on the table.
		await renderBlock(SOURCE);
		const box = (await page.locator('.bt-table').boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await expect.poll(() => page.locator('.bt-strip-visible').count()).toBeGreaterThan(0);

		await page.evaluate(() => {
			const w = window as unknown as { __btBlock: { unload(): void }; __btMount: () => void };
			w.__btBlock.unload();
			(document.getElementById('root') as HTMLElement).replaceChildren();
			w.__btMount();
		});

		// No pointer movement at all between the rebuild and this assertion.
		await expect.poll(() => page.locator('.bt-strip-visible').count(),
			{ message: 'the strips did not come back until the pointer moved' }).toBeGreaterThan(0);
	});
});
