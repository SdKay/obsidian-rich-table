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

		await expect.poll(() => page.locator('.bt-td[data-row]').count(),
			{ message: 'the rebuild should show one data row' }).toBeGreaterThan(0);
		expect(await page.locator('[data-row="2"]').count(), 'row 2 is gone').toBe(0);
		expect(await page.locator('.bt-selected').count(),
			'a stale coordinate must not resurrect a highlight on an unrelated cell').toBe(0);
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
		await expect.poll(() => page.locator('.bt-td[data-row]').count()).toBeGreaterThan(0);

		for (const key of ['ArrowUp', 'ArrowDown', 'Tab', 'ArrowLeft']) {
			await page.keyboard.press(key);
			expect(await page.locator('.bt-selected').count(),
				`${key} navigated away from a row that no longer exists`).toBe(0);
		}
	});
});
