import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported (with screenshots): on an untitled table, Obsidian's own block-
// hover toolbar (the floating "</>" edit-source button, shown while hovering
// ANY code block) sits directly over the table's top-right corner — exactly
// where the column-selector strip and the last column's resize handle live —
// making that seam hard or impossible to grab. A title pushes the table down
// clear of it; without one there's nothing pushing the table's own top edge
// away from where Obsidian wants to render its toolbar.
//
// Fix reserves extra top padding (TOP_STRIP_PAD in renderer.ts) specifically
// when there's no title. The exact px is a guess from the reported
// screenshots, not a measurement against the real toolbar — this harness has
// no way to render Obsidian's own chrome, so this test only pins the LOGIC
// (no title → extra reservation; title → none), not whether the chosen
// amount actually clears the real toolbar. That part needs a manual check in
// the app.
test.describe('untitled table reserves extra top clearance', () => {
	const noTitleTop = async (page: import('@playwright/test').Page, renderFull: (s: string) => Promise<unknown>, title?: string) => {
		const source = tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }], title });
		await renderFull(source);
		const box = (await page.locator('.bt-table-wrapper').boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await expect.poll(() => page.locator('.bt-col-selector').evaluate((el: HTMLElement) => el.classList.contains('bt-strip-visible')))
			.toBe(true);
		return page.locator('.bt-render-root').evaluate((el: HTMLElement) => parseFloat(getComputedStyle(el).paddingTop));
	};

	test('an untitled table reserves more top padding than a titled one', async ({ page, renderFull }) => {
		const untitled = await noTitleTop(page, renderFull, undefined);
		const titled = await noTitleTop(page, renderFull, 'A title');
		expect(untitled, 'untitled table should reserve extra clearance for Obsidian\'s own toolbar')
			.toBeGreaterThan(titled);
	});

	// Reported: locking an untitled table collapsed this same clearance to 0
	// — Obsidian's floating toolbar still covers the same corner regardless
	// of lock state, but TOP_STRIP_PAD's write used to be nested inside an
	// onStructuralOp-only block, so a locked table (no onStructuralOp) never
	// got it at all. Locked has no column selector, so its own share of the
	// reservation is correctly 0 — the assertion here is specifically that
	// the OBSIDIAN-toolbar share survives locking, not that locked matches
	// unlocked's full amount.
	test('a locked untitled table still reserves top clearance for Obsidian\'s own toolbar', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }], locked: true }));
		const padTop = await page.locator('.bt-render-root').evaluate((el: HTMLElement) => parseFloat(getComputedStyle(el).paddingTop));
		expect(padTop).toBeGreaterThan(0);
	});
});
