import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported ("我们的table能不能也有一个外框，然后所有table的东西都在这个外框里"):
// obsidian-rich-view's fully-enclosed look (one border around everything —
// grid, toolbar, status bar, hover strips) as the bar to match, instead of
// this plugin's various overlay strips floating loose outside any visible
// boundary. `.bt-outer-frame` (renderer.ts's updateOuterFrame /
// renderGeometry.ts's applyOuterFrame) is a `shell` child, sized in JS to
// always cover `root`'s own box, extended down to include a status bar only
// when the status bar actually contributes visible content (PINNED: always;
// HOVER: only while showing) — see those functions' own doc comments for why
// a hover-mode status bar needs this special-casing instead of the frame
// just hugging `shell`'s own layout box.
test.describe('outer frame', () => {
	test('at rest, the frame covers exactly the root+status-bar area, pinned mode', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }] }));
		const shell = page.locator('.bt-render-root-shell');
		const frame = page.locator('.bt-outer-frame');
		const shellBox = (await shell.boundingBox())!;
		const frameBox = (await frame.boundingBox())!;
		expect(frameBox.x).toBeCloseTo(shellBox.x, 0);
		expect(frameBox.y).toBeCloseTo(shellBox.y, 0);
		expect(frameBox.width).toBeCloseTo(shellBox.width, 0);
		expect(frameBox.height).toBeCloseTo(shellBox.height, 0);
	});

	test('on hover, the frame grows to cover the row/col selector strips and left toolbar, none of which spill outside it', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }] }));
		const root = page.locator('.bt-render-root');
		const rootBox = (await root.boundingBox())!;
		await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2);
		await expect(page.locator('.bt-ctrl-col')).toHaveCSS('opacity', '1');

		const frameBox = (await page.locator('.bt-outer-frame').boundingBox())!;
		for (const sel of ['.bt-ctrl-col', '.bt-col-selector', '.bt-row-selector']) {
			const box = (await page.locator(sel).boundingBox())!;
			expect(box.x, `${sel} left edge inside frame`).toBeGreaterThanOrEqual(frameBox.x - 1);
			expect(box.y, `${sel} top edge inside frame`).toBeGreaterThanOrEqual(frameBox.y - 1);
			expect(box.x + box.width, `${sel} right edge inside frame`).toBeLessThanOrEqual(frameBox.x + frameBox.width + 1);
			expect(box.y + box.height, `${sel} bottom edge inside frame`).toBeLessThanOrEqual(frameBox.y + frameBox.height + 1);
		}
	});

	test('a PINNED status bar is always inside the frame, before and after hover', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }] }));
		const statusBar = page.locator('.bt-status-bar');
		const frame = page.locator('.bt-outer-frame');

		const before = (await frame.boundingBox())!;
		const barBefore = (await statusBar.boundingBox())!;
		expect(barBefore.y + barBefore.height).toBeLessThanOrEqual(before.y + before.height + 1);

		const root = page.locator('.bt-render-root');
		const rootBox = (await root.boundingBox())!;
		await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2);
		await page.waitForTimeout(50);

		const after = (await frame.boundingBox())!;
		const barAfter = (await statusBar.boundingBox())!;
		expect(barAfter.y + barAfter.height).toBeLessThanOrEqual(after.y + after.height + 1);
	});

	// A HOVER-mode status bar now overlays root's own last row instead of
	// extending past root's box (see positionStatusBar's own comment,
	// renderer.ts, for why: anything extending past root's flow-box gets
	// clipped by Obsidian's real code-block container — a bug the previous
	// "grow the frame downward" design silently hit, undetectable in this
	// harness since it has no such wrapper). So the frame must track root's
	// OWN bottom edge exactly at every point in the hover show/hide cycle
	// (never past it, to make room for the bar) — root's own height can
	// still legitimately change on hover for an unrelated reason (permanent
	// top-padding reservation for the selector strips, see reserveLeftPad),
	// so this checks the frame stays glued to root, not that root itself is
	// a fixed size.
	test('a HOVER-mode status bar never pushes the frame past root\'s own bottom edge, at any point in the hover cycle', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }], statusBarMode: 'hover' }));
		const root = page.locator('.bt-render-root');
		const frame = page.locator('.bt-outer-frame');
		const statusBar = page.locator('.bt-status-bar');
		const rootBoxInitial = (await root.boundingBox())!;

		const frameBefore = (await frame.boundingBox())!;
		expect(frameBefore.y + frameBefore.height).toBeCloseTo(rootBoxInitial.y + rootBoxInitial.height, 0);

		await page.mouse.move(rootBoxInitial.x + rootBoxInitial.width / 2, rootBoxInitial.y + rootBoxInitial.height / 2);
		await expect(statusBar).toHaveClass(/bt-strip-visible/);
		await page.waitForTimeout(50);
		const rootBoxDuring = (await root.boundingBox())!;
		const frameDuring = (await frame.boundingBox())!;
		const barDuring = (await statusBar.boundingBox())!;
		// The frame still matches root's own (possibly now-taller, from the
		// permanent hover-padding reservation) bottom edge exactly...
		expect(frameDuring.y + frameDuring.height).toBeCloseTo(rootBoxDuring.y + rootBoxDuring.height, 0);
		// ...yet the now-visible bar is still fully contained within it.
		expect(barDuring.y).toBeGreaterThanOrEqual(frameDuring.y - 1);
		expect(barDuring.y + barDuring.height).toBeLessThanOrEqual(frameDuring.y + frameDuring.height + 1);

		await page.mouse.move(rootBoxInitial.x - 100, rootBoxInitial.y - 100);
		await page.waitForTimeout(50);
		const rootBoxAfter = (await root.boundingBox())!;
		const frameAfter = (await frame.boundingBox())!;
		expect(frameAfter.y + frameAfter.height).toBeCloseTo(rootBoxAfter.y + rootBoxAfter.height, 0);
	});

	test('the frame element never intercepts clicks meant for the table underneath', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }] }));
		await expect(page.locator('.bt-outer-frame')).toHaveCSS('pointer-events', 'none');
	});

	// Reported ("之前调整view宽度后，会产生四个直角用于标记实际宽度位置，现在既然
	// 有了外边框，那么让外边框的宽度和view宽度保持视觉上的一致即可"): the frame
	// used to always hug root's own (full-available) width regardless of a
	// manually narrower viewWidth, leaving a separate corner-bracket marker
	// (since removed) to show the real edge instead. Now the frame itself
	// narrows to the wrapper's own box whenever a manual width is actually
	// narrower than what's available.
	test('the frame narrows to a manually-set viewWidth instead of hugging root\'s full available width', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }], viewWidth: 400 }));
		const root = page.locator('.bt-render-root');
		const wrapper = page.locator('.bt-table-wrapper');
		const frame = page.locator('.bt-outer-frame');
		const rootBox = (await root.boundingBox())!;
		const wrapperBox = (await wrapper.boundingBox())!;
		const frameBox = (await frame.boundingBox())!;
		expect(frameBox.width).toBeCloseTo(wrapperBox.width, 0);
		expect(frameBox.x).toBeCloseTo(wrapperBox.x, 0);
		expect(frameBox.width).toBeLessThan(rootBox.width - 10);
	});

	// A manually-narrower frame should read as one consistent box — the
	// PINNED status bar (sheet tabs/stats/zoom) shares its left/width, not
	// spanning the full available space while the grid above it narrows
	// ("让外边框的宽度和view宽度保持视觉上的一致"). The width AND height
	// drag-resize handles get the exact same symmetric treatment (matching
	// how the height handle already behaves, by living inside the now-
	// narrowed status bar) — both hug the frame's real right/bottom edge, not
	// root's full-available one, and their discoverability dashes ride along.
	test('a manually-narrowed frame keeps the PINNED status bar and both resize handles aligned to its own edge, not root\'s', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }], viewWidth: 400 }));
		const root = page.locator('.bt-render-root');
		const rootBox = (await root.boundingBox())!;
		await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2);
		await page.waitForTimeout(50);

		const frameBox = (await page.locator('.bt-outer-frame').boundingBox())!;
		const statusBarBox = (await page.locator('.bt-status-bar').boundingBox())!;
		expect(statusBarBox.x).toBeCloseTo(frameBox.x, 0);
		expect(statusBarBox.width).toBeCloseTo(frameBox.width, 0);

		const handleRBox = (await page.locator('.bt-view-resize-r').boundingBox())!;
		expect(handleRBox.x + handleRBox.width).toBeCloseTo(frameBox.x + frameBox.width, 0);
		const handleBrBox = (await page.locator('.bt-view-resize-br').boundingBox())!;
		expect(handleBrBox.x + handleBrBox.width).toBeCloseTo(frameBox.x + frameBox.width, 0);

		await expect.poll(() => page.locator('.bt-view-resize-r').evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('1');
	});

	// A write-back rebuild tears down and recreates root/shell/frame from
	// scratch (tableBlock.ts) — the frame's first sizing on that fresh tree
	// comes from renderGeometry.ts's standalone applyOuterFrame(), a genuinely
	// separate code path from renderer.ts's own closure-local updateOuterFrame
	// exercised by every test above. Drives a real insert-row op (clicking the
	// "+" add-row button) to force that rebuild.
	test('after a write-back rebuild, the frame is resized to the new (taller) table by applyOuterFrame', async ({ page, renderBlock }) => {
		const SOURCE = `---
version: 2
columns:
  - { id: c_0, name: A, width: 100 }
rows:
  - { id: r_0, cells: { c_0: "1" } }
---
`;
		const block = await renderBlock(SOURCE);
		const frameBefore = (await page.locator('.bt-outer-frame').boundingBox())!;

		const wrapper = page.locator('.bt-table-wrapper:not(#wrapper)');
		const wb = (await wrapper.boundingBox())!;
		await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2);
		await page.locator('.bt-edge-add-row').click();
		await expect.poll(async () => (await block.noteText()).match(/id: r_/g)?.length ?? 0).toBe(2);
		await block.reprocess();

		const rowCount = () => page.locator('tbody tr').count();
		await expect.poll(rowCount).toBeGreaterThan(1);

		const frameAfter = (await page.locator('.bt-outer-frame').boundingBox())!;
		expect(frameAfter.height).toBeGreaterThan(frameBefore.height);
		// A self-healing renderer.ts observer (updateOuterFrame, unrelated to
		// applyOuterFrame's own post-swap call) can still be converging this by
		// a couple px right after the swap — poll rather than read once.
		await expect.poll(async () => {
			const f = (await page.locator('.bt-outer-frame').boundingBox())!;
			const s = (await page.locator('.bt-render-root-shell').boundingBox())!;
			return Math.round(f.height - s.height);
		}).toBe(0);
	});

	// Same manual-viewWidth narrowing renderer.ts's own updateOuterFrame does
	// (see that function's own comment), exercised through applyOuterFrame's
	// separate post-swap code path via renderBlock.
	test('a manually-narrowed frame stays narrow through a write-back rebuild too (applyOuterFrame)', async ({ page, renderBlock }) => {
		const SOURCE = `---
version: 2
columns:
  - { id: c_0, name: A, width: 100 }
  - { id: c_1, name: B, width: 100 }
rows:
  - { id: r_0, cells: { c_0: "1" } }
viewWidth: 400
---
`;
		await renderBlock(SOURCE);
		const wrapper = page.locator('.bt-table-wrapper:not(#wrapper)');
		const wrapperBox = (await wrapper.boundingBox())!;
		const frameBox = (await page.locator('.bt-outer-frame').boundingBox())!;
		expect(frameBox.width).toBeCloseTo(wrapperBox.width, 0);
		expect(frameBox.x).toBeCloseTo(wrapperBox.x, 0);
	});
});
