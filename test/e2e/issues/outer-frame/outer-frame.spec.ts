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
	// An auto-width table's frame hugs the table (via wrapper's own box), not
	// the full page — same narrowing a manual viewWidth already gets (below),
	// now unconditional. Never narrower than wrapper's own box — the status
	// bar's own content (sheet tabs/stats/zoom) can need more room than a
	// small table does, in which case the frame widens to fit the BAR
	// instead, still well short of the full page.
	test('at rest, an auto-width table\'s frame hugs the table (or the status bar, whichever is wider), not the full page', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }] }));
		const shell = page.locator('.bt-render-root-shell');
		const wrapper = page.locator('.bt-table-wrapper');
		const frame = page.locator('.bt-outer-frame');
		const shellBox = (await shell.boundingBox())!;
		const wrapperBox = (await wrapper.boundingBox())!;
		const frameBox = (await frame.boundingBox())!;
		expect(frameBox.width).toBeGreaterThanOrEqual(wrapperBox.width - 0.5);
		expect(frameBox.width).toBeLessThan(shellBox.width - 10);
		expect(frameBox.y).toBeCloseTo(shellBox.y, 0);
	});

	// Reported ("一个注脚比table宽的图标，外侧view宽度适配了注脚宽度...列宽把手没有
	// 贴着view右边界...它跑到列增加按钮左侧...状态栏也没有移动到view框内，穿出去
	// 了"): a footer (.bt-table-footer, a plain sibling of contentRow INSIDE
	// wrapper — see renderer.ts's renderFooter) wider than <table>+addColBtn
	// combined used to push wrapper (and therefore the frame) wider than the
	// table alone; the handle and the status bar didn't follow that widened
	// edge. Superseded by a follow-up report ("脚注的最大宽度应该不超过表格本身
	// 的宽度，超过之后应该自动换行") asking for the OPPOSITE: the footer should
	// now be capped to contentRow's own width (renderer.ts's positionFooter,
	// --bt-footer-max-width) and wrap onto more lines instead of widening
	// wrapper at all — so this scenario no longer arises from a wide footer.
	// Kept as a manually-set viewWidth instead, which still legitimately makes
	// wrapper wider than <table>+addColBtn — the handle/frame/status-bar
	// consistency this test actually checks is unrelated to which of the two
	// causes it.
	test('a view wider than the table pulls the handle and the status bar out to wrapper\'s new edge, not just the frame', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [50], rows: [{ 0: 'x' }], viewWidth: 400 }));
		const root = page.locator('.bt-render-root');
		const rootBox = (await root.boundingBox())!;
		await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2);
		await page.waitForTimeout(50);

		const wrapperBox = (await page.locator('.bt-table-wrapper').boundingBox())!;
		const addColBtn = page.locator('.bt-edge-add-col');
		if (await addColBtn.count() > 0) {
			const addColBox = (await addColBtn.boundingBox())!;
			// wrapper must actually be the widest thing here, or this test isn't
			// exercising the reported scenario at all.
			expect(wrapperBox.x + wrapperBox.width).toBeGreaterThan(addColBox.x + addColBox.width + 20);
		}

		const frameBox = (await page.locator('.bt-outer-frame').boundingBox())!;
		const handleBox = (await page.locator('.bt-view-resize-r').boundingBox())!;
		const statusBarBox = (await page.locator('.bt-status-bar').boundingBox())!;
		expect(frameBox.x + frameBox.width).toBeCloseTo(wrapperBox.x + wrapperBox.width, 0);
		expect(handleBox.x + handleBox.width).toBeCloseTo(wrapperBox.x + wrapperBox.width, 0);
		expect(statusBarBox.x + statusBarBox.width).toBeCloseTo(wrapperBox.x + wrapperBox.width, 0);
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

	// A manually-narrower frame should read as one consistent box on its
	// RIGHT edge — the PINNED status bar (sheet tabs/stats/zoom) shares the
	// frame's own right edge, not spanning the full available space while the
	// grid above it narrows ("让外边框的宽度和view宽度保持视觉上的一致"). The
	// width AND height drag-resize handles get the exact same symmetric
	// treatment (matching how the height handle already behaves, by living
	// inside the now-narrowed status bar) — both hug the frame's real
	// right/bottom edge, not root's full-available one, and their
	// discoverability dashes ride along.
	//
	// The LEFT edge is deliberately NOT asserted to match here: on hover, the
	// frame widens further left to keep covering the ctrl column/row
	// selector (see the "on hover, the frame grows to cover..." test above),
	// while the status bar's own left intentionally does NOT follow — see
	// updateOuterFrame's own comment on why sharing that hover-widened edge
	// would shift the status bar's own layout sideways purely from
	// hover/unhover.
	test('a manually-narrowed frame keeps the PINNED status bar and both resize handles aligned to its own right edge, not root\'s', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }], viewWidth: 400 }));
		const root = page.locator('.bt-render-root');
		const rootBox = (await root.boundingBox())!;
		await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2);
		await page.waitForTimeout(50);

		const frameBox = (await page.locator('.bt-outer-frame').boundingBox())!;
		const statusBarBox = (await page.locator('.bt-status-bar').boundingBox())!;
		expect(statusBarBox.x + statusBarBox.width).toBeCloseTo(frameBox.x + frameBox.width, 0);

		const handleRBox = (await page.locator('.bt-view-resize-r').boundingBox())!;
		expect(handleRBox.x + handleRBox.width).toBeCloseTo(frameBox.x + frameBox.width, 0);
		const handleBrBox = (await page.locator('.bt-view-resize-br').boundingBox())!;
		expect(handleBrBox.x + handleBrBox.width).toBeCloseTo(frameBox.x + frameBox.width, 0);

		await expect.poll(() => page.locator('.bt-view-resize-r').evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('1');
	});

	// Reported ("宽度auto状态下，首次拖动调整宽度的时候，外边框没有跟着移动，松开
	// 鼠标后宽度发生变后，之后再调整宽度的时候外边框就跟着移动了"): updateOuterFrame
	// used to gate its narrowing on `typeof model.viewWidth === 'number'` — the
	// MODEL value, which only gets written back on pointerup (see the drag
	// handler's own onUp) — instead of `wrapper.hasClass('bt-view-fixed-w')`,
	// the class the SAME drag handler sets live on every pointermove. So a
	// table with no prior manual width read `model.viewWidth === undefined`
	// throughout its very first drag and never narrowed until the resulting
	// re-render gave it a real model value to read on the SECOND drag.
	// applyOuterFrame (renderGeometry.ts) already used the class correctly —
	// this only needed updateOuterFrame to match it.
	test('the frame narrows live during the FIRST width drag, before any release/re-render', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }] }));
		const root = page.locator('.bt-render-root');
		const rootBox = (await root.boundingBox())!;
		await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2);
		await page.waitForTimeout(50);

		const handle = page.locator('.bt-view-resize-r');
		const handleBox = (await handle.boundingBox())!;
		await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
		await page.mouse.down();
		// Drag INWARD (narrower) so the frame's post-drag box is unambiguously
		// distinguishable from its full-width resting state.
		await page.mouse.move(handleBox.x + handleBox.width / 2 - 400, handleBox.y + handleBox.height / 2, { steps: 10 });
		await page.waitForTimeout(50);

		const wrapperDuring = (await page.locator('.bt-table-wrapper').boundingBox())!;
		const frameDuring = (await page.locator('.bt-outer-frame').boundingBox())!;
		const rootDuring = (await root.boundingBox())!;
		// Still mid-drag — no pointerup, no op dispatched, no re-render — yet
		// the frame must already be narrower than root's full width, hugging
		// wrapper's own right edge (or wider still, if the status bar's own
		// content needs more room than the now-narrow table does — see the
		// "at rest, an auto-width table's frame hugs..." test's own comment;
		// never narrower than wrapper's edge, only possibly wider).
		expect(frameDuring.x + frameDuring.width).toBeGreaterThanOrEqual(wrapperDuring.x + wrapperDuring.width - 0.5);
		expect(frameDuring.width).toBeLessThan(rootDuring.width - 10);
		await page.mouse.up();
	});

	// In auto mode the handle sits at the frame's own real right edge (which
	// is also wrapper's, UNLESS the status bar's own content needs more room
	// than the table does — see the "at rest, an auto-width table's frame
	// hugs..." test above), not root's (the full page width). The handle, the
	// frame, and the status bar all read the exact same edge — see
	// updateOuterFrame's own comment on why.
	test('the width handle sits at the auto-width table\'s real edge at rest, not root\'s wide page edge', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }] }));
		const root = page.locator('.bt-render-root');
		const rootBox = (await root.boundingBox())!;
		await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2);
		await page.waitForTimeout(50);

		const frameBox = (await page.locator('.bt-outer-frame').boundingBox())!;
		const handleBox = (await page.locator('.bt-view-resize-r').boundingBox())!;
		expect(handleBox.x + handleBox.width).toBeCloseTo(frameBox.x + frameBox.width, 0);
		// The auto-width table is genuinely narrower than the page here — this
		// assertion is only meaningful if root's own edge is somewhere else.
		expect(frameBox.width).toBeLessThan(rootBox.width - 10);
	});

	// Dragging from that resting position must move continuously, no snap.
	test('dragging the width handle from its auto-width resting position moves it continuously, no jump', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }] }));
		const root = page.locator('.bt-render-root');
		const rootBox = (await root.boundingBox())!;
		await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2);
		await page.waitForTimeout(50);

		const handle = page.locator('.bt-view-resize-r');
		const handleBoxBefore = (await handle.boundingBox())!;

		await page.mouse.move(handleBoxBefore.x + handleBoxBefore.width / 2, handleBoxBefore.y + handleBoxBefore.height / 2);
		await page.mouse.down();
		await page.mouse.move(handleBoxBefore.x + handleBoxBefore.width / 2 - 1, handleBoxBefore.y + handleBoxBefore.height / 2, { steps: 1 });

		const handleBoxDuring = (await handle.boundingBox())!;
		// A single 1px move must produce a small, continuous shift — not a jump
		// across the (previously page-width-sized) gap to root's edge.
		expect(Math.abs(handleBoxDuring.x - handleBoxBefore.x)).toBeLessThan(30);
		await page.mouse.up();
	});

	// Reported ("宽度移动比鼠标移动慢，不是一比一，高度调整不存在以上两个问题"):
	// .bt-table-wrapper stays horizontally centered while dragging
	// (margin-inline:auto — height uses margin-block:0, hence no equivalent
	// slowdown there), so growing its WIDTH by ∆ only moved its visible RIGHT
	// edge — where this handle sits — by ∆/2, the other ∆/2 going to the left
	// edge. Fixed by doubling the mouse delta fed into the width itself
	// (pointerdown handler's own comment, renderer.ts), so the width grows at
	// 2x the cursor's movement and the visible right edge — getting exactly
	// half of that — ends up tracking the cursor 1:1.
	test('dragging the width handle moves the wrapper\'s visible right edge at exactly 1:1 with the mouse, despite wrapper staying centered', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }] }));
		const root = page.locator('.bt-render-root');
		const rootBox = (await root.boundingBox())!;
		await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2);
		await page.waitForTimeout(50);

		const handle = page.locator('.bt-view-resize-r');
		const handleBox = (await handle.boundingBox())!;
		const wrapperBefore = (await page.locator('.bt-table-wrapper').boundingBox())!;

		await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(handleBox.x + handleBox.width / 2 + 100, handleBox.y + handleBox.height / 2, { steps: 10 });
		await page.waitForTimeout(50);
		const wrapperDuring = (await page.locator('.bt-table-wrapper').boundingBox())!;

		const rightEdgeDelta = (wrapperDuring.x + wrapperDuring.width) - (wrapperBefore.x + wrapperBefore.width);
		expect(rightEdgeDelta).toBeCloseTo(100, 0);
		await page.mouse.up();
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
