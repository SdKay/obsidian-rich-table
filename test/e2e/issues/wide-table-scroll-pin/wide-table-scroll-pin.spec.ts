import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported: scroll a wide, untitled table all the way to its right edge, move
// the pointer away, then hover the table again — the scrollbar visibly
// retreats from the edge the user had explicitly scrolled to.
//
// Root cause: a wide table with a fixed view width (--bt-view-width) has a
// FIXED, border-box outer width. Hovering it can reserve --bt-sel-pad-left
// (root's own padding-left, made room for the row selector + ctrl column when
// the table has no natural left margin) — under border-box, growing padding
// shrinks the CONTENT area rather than growing the box, so the wrapper's own
// clientWidth shrinks by the same amount the instant that padding is
// reserved. scrollLeft (a raw pixel value) doesn't move on its own, but the
// max legal scrollLeft (scrollWidth - clientWidth) just grew — so a scrollbar
// that was pinned to the true right edge a moment ago is no longer at the
// (new, larger) max, and visibly sits short of the edge.
test.describe('wide table — scroll position survives the left-padding reservation', () => {
	const WIDE_NO_TITLE = tableSource({
		widths: [150, 150, 150, 150, 150, 150, 150, 150, 150, 150],
		rows: [{ 0: 'a1' }, { 0: 'a2' }],
		viewWidth: 300,
	});

	test('scrollbar stays pinned to the right edge across the first hover', async ({ page, renderFull }) => {
		// Narrow viewport reproduces "table fills its container flush-left" —
		// see the locked-wide-table-ctrl-col suite's own note on why the default
		// (much wider) Playwright viewport hides this class of bug entirely.
		await page.setViewportSize({ width: 340, height: 400 });
		await renderFull(WIDE_NO_TITLE);

		const wrapper = page.locator('.bt-table-wrapper');
		await wrapper.evaluate((el: HTMLElement) => { el.scrollLeft = el.scrollWidth; });

		// Hover a point that's actually within the (viewport-clamped) wrapper —
		// the table's own bounding box is wider than the viewport, so hovering
		// its midpoint would move the pointer off-page and never fire mouseenter.
		const wrapperBox = (await wrapper.boundingBox())!;
		await page.mouse.move(wrapperBox.x + wrapperBox.width / 2, wrapperBox.y + wrapperBox.height / 2);

		await expect.poll(() => wrapper.evaluate((el: HTMLElement) => parseFloat(getComputedStyle(el.closest('.bt-render-root')!).paddingLeft)))
			.toBeGreaterThan(0);

		const stillAtMax = await wrapper.evaluate((el: HTMLElement) =>
			el.scrollWidth - el.clientWidth - el.scrollLeft < 1);
		expect(stillAtMax, 'scrollbar retreated from the right edge once the left padding was reserved').toBe(true);
	});
});
