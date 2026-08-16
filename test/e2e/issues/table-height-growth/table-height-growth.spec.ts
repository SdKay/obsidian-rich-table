import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Discovered while diagnosing "行列增加按钮没了" (a separate, already-fixed bug —
// see edge-buttons-hidden.spec.ts) — not something the status bar (FR-017)
// introduced, present on master beforehand, just previously masked because
// the OTHER bug's over-tight guard kept bailing out before this one could run.
//
// Root cause: `.bt-table-content-row > .bt-table` had no `align-self`, so
// flex's default `align-items: stretch` forced <table> to match the row's
// cross-size on every layout pass — which is normally addColBtn's own height
// (set FROM the table's last measured height, positionEdgeStrips in
// renderer.ts). Stretch applies to the table's CONTENT-box height, while the
// getBoundingClientRect() reading that feeds the NEXT pass is its BORDER-box
// height — any border/padding difference between the two got re-added on
// every single resize-observer pass, so a hovered table's own measured
// height climbed without bound (confirmed: from ~65px to 500+px over roughly
// a second) before some unrelated ceiling capped it. Fixed by giving <table>
// `align-self: flex-start` (styles.css) — the same treatment addColBtn
// already had for the identical reason (see its own CSS comment) — so
// table's height is governed by its own content only, never by contentRow's
// derived cross-size.
test('a table does not grow taller than its own content after being hovered', async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }], title: 'My title' }));
	const table = page.locator('.bt-table');
	const wrapper = page.locator('.bt-table-wrapper');

	const before = (await table.boundingBox())!;
	const wrapperBox = (await wrapper.boundingBox())!;
	await page.mouse.move(wrapperBox.x + wrapperBox.width / 2, wrapperBox.y + wrapperBox.height / 2);
	// The bug took up to ~1-1.5s to fully run away in the worst case measured
	// during diagnosis — well past that, with margin.
	await page.waitForTimeout(2000);
	const after = (await table.boundingBox())!;

	expect(after.height, 'the table must not grow taller than its own content just from being hovered')
		.toBeLessThan(before.height + 4);
});
