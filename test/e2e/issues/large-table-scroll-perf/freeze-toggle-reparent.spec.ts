import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

/**
 * The perf fix in this same folder moved column-selector cells/grips/resize-
 * handles into a shared `.bt-sel-track` wrapper (transformed as a group to
 * track scroll), with a frozen column's own cell/grip/resize-handle parented
 * OUTSIDE the track instead — see large-table-scroll-perf.spec.ts and
 * styles.css's `.bt-sel-track` comment for the full reasoning.
 *
 * Resize handles are the one piece of that partition NOT rebuilt from
 * scratch every render (renderer.ts calls them "persistent... created once,
 * repositioned in rebuild()") — so a column that starts unfrozen and is
 * frozen LATER needs its handle actively MOVED from the track to colSel,
 * not just re-created in the right place like the label cells/drag grips
 * are. No other test exercises a freeze toggle after initial render (every
 * other freeze fixture sets it from the source), so this is the one case
 * that would silently miss a broken reparent.
 */
const SOURCE = tableSource({
	widths: [80, 80, 80],
	rows: [{ 0: 'a1', 1: 'b1', 2: 'c1' }],
});

test('freezing a column after initial render moves its resize handle out of the track', async ({ page, renderBlock }) => {
	const block = await renderBlock(SOURCE);
	await page.locator('table.bt-table').hover();
	await expect.poll(() => page.locator('.bt-strip-visible').count()).toBeGreaterThan(0);

	// Before freezing: the column-0 resize handle lives inside the track.
	const inTrackBefore = await page.evaluate(() => {
		const track = document.querySelector('.bt-col-selector .bt-sel-track');
		return !!track?.querySelector('.bt-sel-resize-col');
	});
	expect(inTrackBefore).toBe(true);

	await page.evaluate(() => {
		const w = window as unknown as { __btBlock: { handleStructuralOp(op: unknown): void } };
		w.__btBlock.handleStructuralOp({ type: 'set-freeze-cols', count: 1 });
	});
	await expect.poll(() => block.noteText()).toContain('freezeCols');
	await block.reprocess();
	await page.locator('table.bt-table').hover();
	await expect.poll(() => page.locator('.bt-strip-visible').count()).toBeGreaterThan(0);

	// After freezing column 0: its resize handle must have MOVED to be a
	// direct child of .bt-col-selector, not left behind inside the track
	// (which is now transformed to track scroll — leaving it there would
	// silently drag the frozen column's resize zone away from its boundary
	// the moment the table scrolls).
	const handleParentIsColSelector = await page.evaluate(() => {
		const handle = document.querySelector('.bt-sel-resize-col.bt-sel-cell-frozen');
		return handle?.parentElement?.classList.contains('bt-col-selector') ?? false;
	});
	expect(handleParentIsColSelector).toBe(true);

	const stillInTrack = await page.evaluate(() => {
		const track = document.querySelector('.bt-col-selector .bt-sel-track');
		return !!track?.querySelector('.bt-sel-resize-col.bt-sel-cell-frozen');
	});
	expect(stillInTrack).toBe(false);
});
