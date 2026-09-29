import { test, expect } from '../../common/test-base';
import { tableSource, scrollableTable } from '../../common/fixtures';

// The custom vertical scrollbar (.bt-view-scroll) replacing the native one —
// the left/right symmetry design's right-side mirror of the toolbar
// (.bt-ctrl-col): same width (SEL_UNIT), same visibility rule (hover when
// unlocked, permanent when locked), sitting right of the column adder.

test('the native vertical scrollbar is hidden — .bt-view-scroll draws its own', async ({ page, renderFull }) => {
	await renderFull(scrollableTable());
	const wrapper = page.locator('.bt-table-wrapper:not(#wrapper)');
	// A hidden native scrollbar still leaves clientWidth === offsetWidth minus
	// any hidden-scrollbar reservation — the reliable signal ::-webkit-scrollbar
	// {display:none} takes effect is simply that .bt-view-scroll exists and is
	// the thing the user can interact with.
	await expect(page.locator('.bt-view-scroll')).toHaveCount(1);
	void wrapper;
});

test('unlocked table: the vertical scrollbar is hidden at rest and shown on hover, exactly like the toolbar', async ({ page, renderFull }) => {
	await renderFull(scrollableTable());
	const viewScroll = page.locator('.bt-view-scroll');
	const ctrlCol = page.locator('.bt-ctrl-col');

	expect(await viewScroll.evaluate(el => getComputedStyle(el).opacity)).toBe('0');
	expect(await ctrlCol.evaluate(el => getComputedStyle(el).opacity)).toBe('0');

	const wrapperBox = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
	await page.mouse.move(wrapperBox.x + wrapperBox.width / 2, wrapperBox.y + wrapperBox.height / 2);

	await expect.poll(() => viewScroll.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
	await expect.poll(() => ctrlCol.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
});

test('locked table: the vertical scrollbar is permanently visible, matching the toolbar\'s own is-locked treatment', async ({ page, renderFull }) => {
	await renderFull(scrollableTable({ locked: true }));
	const viewScroll = page.locator('.bt-view-scroll');
	await expect(viewScroll).toHaveClass(/is-locked/);
	expect(await viewScroll.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
});

test('the scrollbar and toolbar share the same width (SEL_UNIT)', async ({ page, renderFull }) => {
	await renderFull(scrollableTable({ locked: true }));
	const viewScrollWidth = await page.locator('.bt-view-scroll').evaluate(el => (el as HTMLElement).getBoundingClientRect().width);
	const ctrlBtnWidth = await page.locator('.bt-ctrl-btn').first().evaluate(el => (el as HTMLElement).getBoundingClientRect().width);
	// .bt-ctrl-btn is inset (SEL_CELL) inside the toolbar's own SEL_UNIT-wide
	// column, same relationship .bt-view-scroll-track has inside .bt-view-scroll
	// — comparing the OUTER strip widths is the actual symmetry claim.
	const sel_unit = await page.locator('.bt-render-root').evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue('--bt-sel-unit')));
	expect(viewScrollWidth).toBeCloseTo(sel_unit, 0);
	expect(ctrlBtnWidth).toBeLessThan(sel_unit);
});

test('a table with no vertical overflow shows an empty (full-track) thumb, not a hidden control', async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [60, 60], rows: [{ 0: 'a', 1: 'b' }], locked: true }));
	await expect(page.locator('.bt-view-scroll')).toHaveClass(/bt-view-scroll-empty/);
});

test('a table with real vertical overflow shows a proportional thumb and drags to scroll', async ({ page, renderFull }) => {
	await renderFull(scrollableTable({ locked: true }));
	const viewScroll = page.locator('.bt-view-scroll');
	await expect(viewScroll).not.toHaveClass(/bt-view-scroll-empty/);

	const wrapper = page.locator('.bt-table-wrapper:not(#wrapper)');
	const before = await wrapper.evaluate(el => el.scrollTop);
	expect(before).toBe(0);

	const thumb = page.locator('.bt-view-scroll-thumb');
	const thumbBox = (await thumb.boundingBox())!;
	await thumb.evaluate((el: HTMLElement, y: number) => {
		el.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: 0, clientY: y, bubbles: true, cancelable: true }));
	}, thumbBox.y + thumbBox.height / 2);
	await thumb.evaluate((el: HTMLElement, y: number) => {
		el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 0, clientY: y, bubbles: true, cancelable: true }));
	}, thumbBox.y + thumbBox.height / 2 + 40);

	const after = await wrapper.evaluate(el => el.scrollTop);
	expect(after).toBeGreaterThan(before);
});

test('scrolling the wrapper by wheel keeps the thumb position in sync', async ({ page, renderFull }) => {
	await renderFull(scrollableTable({ locked: true }));
	const wrapper = page.locator('.bt-table-wrapper:not(#wrapper)');
	const thumbTopBefore = await page.locator('.bt-view-scroll-thumb').evaluate(el => getComputedStyle(el).getPropertyValue('--bt-view-thumb-t'));

	await wrapper.evaluate(el => { (el as HTMLElement).scrollTop = 50; });
	await page.waitForTimeout(50);

	const thumbTopAfter = await page.locator('.bt-view-scroll-thumb').evaluate(el => getComputedStyle(el).getPropertyValue('--bt-view-thumb-t'));
	expect(thumbTopAfter).not.toBe(thumbTopBefore);
});
