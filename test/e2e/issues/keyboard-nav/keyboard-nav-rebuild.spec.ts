import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

/**
 * Keyboard selection has to survive a write-back rebuild, because committing with
 * Tab is BOTH the thing that moves the selection and the thing that triggers the
 * rebuild. A rebuilt table renders with an empty `sel`, so without the handoff
 * (renderSelectionHandoff.ts) the highlight would vanish moments after the user
 * deliberately navigated there.
 *
 * `renderBlock` is the only fixture that reaches the real write-back path (see
 * CLAUDE.md's "Testing the renderer") — but note it does NOT rebuild on its own:
 * `reprocess()` is what stands in for Obsidian noticing the file changed and
 * running the code-block processor again. Every test here calls it explicitly.
 * Without that call these tests pass on the ORIGINAL instance, where the
 * selection was set synchronously and no handoff was involved at all — which is
 * how a first draft of this file passed while checking nothing.
 *
 * `reprocess()` itself only waits for the SYNCHRONOUS half of the rebuild — the
 * write-back-time placeholder (a `cloneNode` of the outgoing DOM, injected before
 * the real async render even starts, see tableBlock.ts) is up by the time it
 * returns, but the real render (with real listeners, and the model's actual
 * post-op content) lands a little later. A test that polls on a condition the
 * placeholder ALSO satisfies (e.g. "some row exists", or a `.bt-selected` class
 * that already moved synchronously pre-snapshot) races that gap and flakes
 * under load; one that polls on something only the real, post-op render can
 * produce (a row that's genuinely gone, a cell showing the newly-committed
 * text) does not. Every wait below was chosen with that in mind — see the
 * inline comments on the row-deletion and ArrowRight-after-rebuild tests for
 * the two cases that actually depended on it.
 */
const SOURCE = tableSource({
	widths: [80, 80, 80],
	rows: [
		{ 0: 'a1', 1: 'b1', 2: 'c1' },
		{ 0: 'a2', 1: 'b2', 2: 'c2' },
	],
});

test.describe('keyboard-nav — surviving a write-back rebuild', () => {
	test('Tab-committing a changed value leaves the NEXT cell Selected after the rebuild', async ({ page, renderBlock }) => {
		const block = await renderBlock(SOURCE);
		await page.locator('[data-row="1"][data-col="0"]').first().click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('edited');

		await page.keyboard.press('Tab');
		await expect.poll(() => block.noteText()).toContain('edited');
		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-selected').count()).toBe(1);

		// The rebuild Obsidian performs once it sees the rewritten note.
		await block.reprocess();

		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-selected').count(),
			{ message: 'the selection did not survive the rebuild' }).toBe(1);
		expect(await page.locator('.bt-selected').count(), 'exactly one cell should be selected').toBe(1);
		// And it is the rebuilt table being asserted on, not stale DOM.
		expect(await page.locator('.bt-table').count()).toBe(1);
	});

	test('Enter-committing a changed value leaves the SAME cell Selected after the rebuild', async ({ page, renderBlock }) => {
		const block = await renderBlock(SOURCE);
		await page.locator('[data-row="2"][data-col="1"]').first().click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('kept');

		await page.keyboard.press('Enter');
		await expect.poll(() => block.noteText()).toContain('kept');
		await block.reprocess();

		await expect.poll(() => page.locator('[data-row="2"][data-col="1"].bt-selected').count()).toBe(1);
	});

	test('the restored selection is still navigable — the new instance owns it', async ({ page, renderBlock }) => {
		// Restoring the highlight is only half of it: the rebuilt table's own
		// listeners have to be driving that selection, or the user is left looking at
		// a cell the keyboard can no longer move.
		const block = await renderBlock(SOURCE);
		await page.locator('[data-row="1"][data-col="0"]').first().click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('moved');
		await page.keyboard.press('Tab');
		await expect.poll(() => block.noteText()).toContain('moved');
		await block.reprocess();

		// `reprocess()` returns as soon as the placeholder (a clone of the PRE-op DOM,
		// see tableBlock.ts's write-back-time snapshot) is injected — the real render,
		// with real listeners, still lands a little later. The placeholder still shows
		// the OLD cell text ("a1"), so waiting on the committed value ("moved") is a
		// signal only the real render can satisfy, unlike waiting on `.bt-selected`
		// (which the placeholder already carries too, since the Selected class moves
		// synchronously on Tab, before the snapshot is even taken). Without this, a
		// key sent to the still-inert placeholder is lost for good — placeholder nodes
		// are `cloneNode`s with no event wiring — and the poll below times out.
		await expect.poll(() => page.locator('[data-row="1"][data-col="0"]').textContent()).toBe('moved');
		await expect.poll(() => page.locator('[data-row="1"][data-col="1"].bt-selected').count()).toBe(1);

		await page.keyboard.press('ArrowRight');
		await expect.poll(() => page.locator('[data-row="1"][data-col="2"].bt-selected').count(),
			{ message: 'the rebuilt table is not driving the restored selection' }).toBe(1);
	});

	test('an unchanged Tab-commit moves the selection without rewriting the note', async ({ page, renderBlock }) => {
		const block = await renderBlock(SOURCE);
		const before = await block.noteText();
		await page.locator('[data-row="1"][data-col="0"]').first().click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		// No typing: committed unchanged, which the editor's own
		// `newValue !== rawValue` guard turns into a no-op.

		await page.keyboard.press('Tab');
		await expect(page.locator('[data-row="1"][data-col="1"].bt-selected')).toHaveCount(1, { timeout: 1000 });
		expect(await block.noteText(), 'an unchanged commit must not rewrite the note').toBe(before);
	});

	test('a selection whose row is deleted is dropped, not moved onto whatever took its place', async ({ page, renderBlock }) => {
		// The handoff carries a coordinate, and the operation triggering the rebuild
		// may be the one that removed it — hence clampToValidCell. Selecting the LAST
		// row and then deleting it is the case where a naive restore would silently
		// land on a different row's cell.
		const block = await renderBlock(SOURCE);
		await page.locator('[data-row="2"][data-col="0"]').first().click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Escape');
		await expect.poll(() => page.locator('[data-row="2"][data-col="0"].bt-selected').count()).toBe(1);

		await page.evaluate(() => {
			const w = window as unknown as { __btBlock: { handleStructuralOp(op: unknown): void } };
			w.__btBlock.handleStructuralOp({ type: 'delete-row', rowId: 'r_1' });
		});
		await expect.poll(() => block.noteText()).not.toContain('a2');
		await block.reprocess();

		// `.bt-td[data-row]` count > 0 is NOT a "the rebuild is done" signal — the
		// write-back-time placeholder (a clone of the table as it looked BEFORE this
		// delete-row op, see tableBlock.ts) already satisfies it, since it still has
		// its own (pre-delete) data-row cells. Poll for row 2 being GONE instead —
		// true only once the real, post-delete render has replaced the placeholder.
		await expect.poll(() => page.locator('[data-row="2"]').count(),
			{ message: 'row 2 is gone', timeout: 10000 }).toBe(0);
		await expect.poll(() => page.locator('.bt-selected').count(),
			{ message: 'a stale coordinate must not resurrect a highlight on an unrelated cell' }).toBe(0);
	});

	test('a deleted selection is not merely invisible — the keyboard cannot resume from it', async ({ page, renderBlock }) => {
		// The observable consequence of re-validating the remembered coordinate. Kept
		// as its own test because the highlight alone can't show the difference: an
		// unvalidated phantom coordinate paints nothing either (no cell carries that
		// row any more), so it looks identical at rest — until an arrow key walks
		// from the cell that no longer exists and lights up its neighbour.
		const block = await renderBlock(SOURCE);
		await page.locator('[data-row="2"][data-col="0"]').first().click();
		await expect.poll(() => page.locator('.bt-editing').count()).toBe(1);
		await page.keyboard.press('Escape');
		await expect.poll(() => page.locator('[data-row="2"][data-col="0"].bt-selected').count()).toBe(1);

		await page.evaluate(() => {
			const w = window as unknown as { __btBlock: { handleStructuralOp(op: unknown): void } };
			w.__btBlock.handleStructuralOp({ type: 'delete-row', rowId: 'r_1' });
		});
		await expect.poll(() => block.noteText()).not.toContain('a2');
		await block.reprocess();
		// Same reasoning as the previous test: wait for row 2 to actually be gone
		// (the real render), not just "some row exists" (the placeholder already
		// has that). Sending a key before the real, listener-bearing DOM is up would
		// be lost — the placeholder is an inert `cloneNode` — and falsely "pass" by
		// never moving the selection at all.
		await expect.poll(() => page.locator('[data-row="2"]').count(), { timeout: 10000 }).toBe(0);

		for (const key of ['ArrowUp', 'ArrowDown', 'Tab', 'ArrowLeft']) {
			await page.keyboard.press(key);
			expect(await page.locator('.bt-selected').count(),
				`${key} navigated away from a row that no longer exists`).toBe(0);
		}
	});
});
