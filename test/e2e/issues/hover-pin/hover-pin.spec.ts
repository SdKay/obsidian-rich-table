import { test, expect } from '../../common/test-base';
import { scrollableTable } from '../../common/fixtures';

// The hover-only selector strips show and hide on the table root's own
// mouseenter/mouseleave. Every menu and floating panel renders to document.body,
// OUTSIDE that root — so moving the pointer from the table onto one fires a
// genuine mouseleave and used to collapse the strips mid-interaction, which
// visibly jumped the page and reappeared the instant the pointer came back.
// renderHoverPin.ts fixes that with an open-popup counter: leave is ignored while
// a popup we opened is still showing, and when the last one closes the root is
// re-checked so the strips only hide if the pointer genuinely isn't back.
//
// Until the harness could run the real renderTable, none of this was testable:
// there were unit tests for the counter itself, but nothing checking that the
// strips actually obey it. The leak-safety part especially — a table torn down
// while its own panel is open must not leave the counter permanently nonzero,
// which would pin the strips open for every table on the page.
test.describe('hover-pin', () => {
	const SOURCE = scrollableTable({ freezeRows: 1, freezeCols: 1, theme: 'grid' });

	const stripsVisible = (page: import('@playwright/test').Page) => page.evaluate(() =>
		document.querySelectorAll('.bt-col-selector.bt-strip-visible, .bt-row-selector.bt-strip-visible').length);

	/** Hover the table and wait for the strips to actually appear. */
	const hoverTable = async (page: import('@playwright/test').Page) => {
		const box = (await page.locator('.bt-table').boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await expect.poll(() => stripsVisible(page)).toBeGreaterThan(0);
		return box;
	};

	/** Move the pointer far away, as if onto a menu rendered to document.body. */
	const leaveTable = (page: import('@playwright/test').Page) => page.mouse.move(2, 2);

	/** Open a data cell's panel and wait for it, via the real gesture. */
	const openPanel = async (page: import('@playwright/test').Page) => {
		await page.locator('.bt-td[data-row="1"][data-col="0"]').first().dblclick();
		await expect.poll(() => page.evaluate(() => document.querySelectorAll('.bt-cell-panel').length)).toBeGreaterThan(0);
	};

	test('strips appear on hover and hide when the pointer leaves', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await hoverTable(page);
		await leaveTable(page);
		// A short hide delay is deliberate in the renderer, so poll rather than
		// assert immediately.
		await expect.poll(() => stripsVisible(page)).toBe(0);
	});

	test('strips stay while a panel opened from the table is showing', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await hoverTable(page);

		// Double-click a data cell — the real gesture that opens the cell panel in
		// the default mode (a single click enters edit instead; right-click is the
		// header's gesture, not a data cell's).
		await openPanel(page);


		// Now "move onto the panel": the pointer leaves the root entirely.
		await leaveTable(page);
		await page.waitForTimeout(300);
		expect(await stripsVisible(page),
			'the strips collapsed while a panel we opened was still showing — this is the layout jump renderHoverPin exists to prevent')
			.toBeGreaterThan(0);
	});

	test('strips hide once the panel closes and the pointer really is away', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await hoverTable(page);
		await openPanel(page);
		await leaveTable(page);
		await page.waitForTimeout(200);

		// Escape dismisses the panel; the pointer is still far away, so the
		// re-check on unpin should now let the strips go.
		await page.keyboard.press('Escape');
		await expect.poll(() => stripsVisible(page)).toBe(0);
	});

	test('strips stay if the pointer is back over the table when the panel closes', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		const box = await hoverTable(page);
		await openPanel(page);
		await leaveTable(page);
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
		expect(await stripsVisible(page),
			'the strips hid even though the pointer was back over the table — the unpin re-check is what distinguishes these two cases')
			.toBeGreaterThan(0);
	});

	test('a table torn down with its panel open does not leak the pin', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await hoverTable(page);
		await openPanel(page);

		// The counter is global, so a leak here would pin the strips open for every
		// table on the page — which is why the release is registered on the
		// component as well as called from the panel's own close().
		await page.evaluate(() => {
			(window as unknown as { __btComponent: { unload(): void } }).__btComponent.unload();
			document.querySelector('.bt-render-root')?.replaceChildren();
		});
		expect(await page.evaluate(() => window.RichTableReal.isHoverPinned()),
			'hover stayed pinned after the table was torn down with its panel still open').toBe(false);
	});
});
