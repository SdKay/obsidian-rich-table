import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// A typed column's header shows a small "tag" icon immediately before the
// header's own name — living inside .bt-th-text, not a corner overlay like
// the filter/sort buttons. Two earlier designs were tried and both had real
// problems: a ▾ glued directly onto the text (had to be measured into
// auto-fit, some columns still wrapped, and inviting a click on it opened a
// panel nothing else in the header explains); then a filter/sort-style
// corner badge (tracked the CELL's corner rather than the TEXT, so with the
// header's default centered alignment — or really any column wider than the
// icon — it visibly drifted away from the name it was meant to label).
// Living inside .bt-th-text sidesteps both: it always sits flush against the
// name regardless of alignment/width, auto-fit's own .bt-th-text.offsetWidth
// measurement naturally includes it since it's a real child, and it's left
// with no click handler at all — the type-switch panel is already one
// right-click/double-click away.

const SOURCE = tableSource({
	widths: [40],
	types: ['task-status'],
	rows: [{ 0: 'x' }],
});

test('a typed column shows the type icon inline, immediately before the header text', async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	const icon = page.locator('.bt-th-type-icon').first();
	await expect(icon).toBeVisible();
	// A real child of .bt-th-text, not a sibling/overlay — its own icon-then-
	// text order inside that span is what keeps it flush against the name
	// regardless of the column's alignment or width.
	const isFirstChildOfText = await page.locator('.bt-th-text').first()
		.evaluate(el => el.firstElementChild?.classList.contains('bt-th-type-icon') ?? false);
	expect(isFirstChildOfText).toBe(true);
});

// Reported as visibly not centered against the header text — the icon's own
// `vertical-align: -3px` was a guessed offset from the (baseline-aligned)
// default, which doesn't land on the text's actual visual center for this
// font/icon combination. `vertical-align: middle` was tried next and landed
// closer but still measurably off (middle aligns to a fixed point half an ex
// above the baseline, not the text's real center). Fixed by making
// .bt-th-text itself the flex container: the icon and the text both become
// flex items, and the flex algorithm's own cross-axis centering aligns them
// against each other directly, not against an assumed text-metrics offset.
test('the type icon is vertically centered against the header text, not offset above or below it', async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	const iconBox = (await page.locator('.bt-th-type-icon').first().boundingBox())!;
	const textBox = (await page.locator('.bt-th-text').first().boundingBox())!;
	const iconCenterY = iconBox.y + iconBox.height / 2;
	const textCenterY = textBox.y + textBox.height / 2;
	expect(Math.abs(iconCenterY - textCenterY), 'the icon is not vertically centered against the header text').toBeLessThan(1);
});

test('clicking the type icon is inert — no panel opens, the click falls through to the header itself', async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	await page.locator('.bt-th-type-icon').first().click();
	// The header's own single-click-edit primaryAction is deferred 200ms
	// (bindCellActivation) to disambiguate from a double-click.
	await page.waitForTimeout(300);
	expect(await page.evaluate(() => document.querySelectorAll('.bt-cell-panel').length)).toBe(0);
	expect(await page.locator('[data-row="0"][data-col="0"]').evaluate(el => el.classList.contains('bt-editing'))).toBe(true);
});

test("auto-fit includes the type icon's width — a typed and an untyped column with identical text fit to different widths", async ({ page, renderBlock }) => {
	// renderBlock (not renderFull): auto-fit-all now CLEARS both columns'
	// widths rather than writing a computed number (see choice-col-reactive-
	// width's own notes) — the actual size only shows up after the note is
	// rewritten and reprocessed, which only renderBlock actually does.
	const block = await renderBlock(`---
version: 2
columns:
  - { id: c_0, name: Status Column, width: 40 }
  - { id: c_1, name: Status Column, width: 40, type: task-status }
rows:
  - { id: r_0, cells: { c_0: x, c_1: x } }
---
`);

	await page.locator('table.bt-table').first().hover();
	await page.waitForTimeout(150);
	await page.locator('.bt-ctrl-btn[aria-label*="Auto-fit"]').first().click();

	await expect.poll(() => block.noteText()).not.toContain('width:');
	await block.reprocess();

	// reprocess() doesn't itself wait for the rebuild to finish — poll on the
	// real rendered widths rather than reading them once immediately after.
	const width = (colIdx: number) => page.locator(`col[data-col="${colIdx}"]`).evaluate(el => (el as HTMLElement).getBoundingClientRect().width);
	await expect.poll(() => width(0)).toBeGreaterThan(0);
	const untypedWidth = await width(0);
	const typedWidth = await width(1);
	expect(typedWidth, "the typed column's fit width should account for the icon's own width").toBeGreaterThan(untypedWidth);
});

// A column that's typed, filtered, AND actively live-sorted shows the type
// icon inline plus the filter (bottom-right) and sort (top-right) corner
// icons at once. Filter and sort diagonally opposite each other is the
// intended layout, but a top-anchored and a bottom-anchored 16px icon each
// needing 3px from their own edge overlap in the MIDDLE of a normal ~32px-
// tall single-line header (3+16+3+16=38 > 32) — several alternate layouts
// (stacking, a shared row, opposite corners on the same side) were tried and
// rejected specifically to keep sort in its intended top-right spot. Fixed
// instead by growing exactly this header (bt-th-tall-icons, added only while
// a live sort is active on it) enough to fit both corners without moving
// either icon.
//
// Run under BOTH the harness's plain browser default (content-box) and a
// simulated Obsidian environment (global border-box reset) — this exact fix
// passed the content-box version, was deployed, and still overlapped in the
// real vault: this file never sets box-sizing on .bt-th/.bt-td, so a 44px
// height means two different things depending on the ambient default, and
// the harness's default (content-box, nothing here resets it) isn't
// Obsidian's (border-box, confirmed by reproducing the report with a forced
// global reset). Without covering both, a future edit that quietly drops the
// fix's own `box-sizing: border-box` would pass here and still break in the
// app it's meant to run in.
for (const mode of ['content-box (this harness\'s own default)', 'border-box (simulated Obsidian global reset)'] as const) {
	test(`a live-sorted, filtered header grows tall enough to fit both corner icons with no overlap — ${mode}`, async ({ page, renderFull }) => {
		await renderFull(`---
version: 2
columns:
  - { id: c_0, name: A, width: 60, type: task-status, filter: [done] }
rows:
  - { id: r_0, cells: { c_0: done } }
sort: { colId: c_0, dir: asc }
---
`);
		if (mode.startsWith('border-box')) {
			await page.addStyleTag({ content: '*, *::before, *::after { box-sizing: border-box !important; }' });
		}
		await page.locator('table.bt-table').first().hover();
		await page.waitForTimeout(150);

		const rects = await page.evaluate(() => {
			const r = (el: Element | null) => el ? (el as HTMLElement).getBoundingClientRect() : null;
			return {
				th:     r(document.querySelector('[data-row="0"][data-col="0"]')),
				filter: r(document.querySelector('.bt-filter-btn')),
				sort:   r(document.querySelector('.bt-sort-active-btn')),
			};
		});
		const { th, filter, sort } = rects;
		expect(th && filter && sort, 'both icons should be present').toBeTruthy();

		const within = (box: DOMRect) =>
			box.top >= th!.top - 0.5 && box.bottom <= th!.bottom + 0.5 &&
			box.left >= th!.left - 0.5 && box.right <= th!.right + 0.5;
		expect(within(filter as DOMRect), 'filter button rendered outside the header cell').toBe(true);
		expect(within(sort as DOMRect), 'sort indicator rendered outside the header cell').toBe(true);

		const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
		expect(overlaps(filter as DOMRect, sort as DOMRect), 'filter button overlaps the sort indicator').toBe(false);
	});
}
