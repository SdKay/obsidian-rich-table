import { test, expect } from '../../common/test-base';

// Coverage for the actual headline behaviour of the auto width/height feature
// (see CLAUDE.md's "auto" design) that neither autofit-header-icon nor
// header-type-caret's dblclick/auto-fit-all tests exercise: a column with NO
// width of its own, sitting alongside a sibling that DOES have one — the one
// case that needs applyAutoColWidths (renderAutofit.ts) to run at all. Both of
// those other tests happened to clear every column's width at once, which
// drops the whole table out of table-layout:fixed entirely (renderer.ts's
// hasExplicitWidths) and lets the browser's native table-layout:auto do the
// work for free — so they pass even with applyAutoColWidths's call site
// removed from tableBlock.ts entirely. This test's fixed/auto MIX is what
// actually forces the col[data-auto] measurement path.
const LONG_TEXT = '这是一段用来测试自动列宽是否真的按内容宽度撑开的很长文字';

const SOURCE = `---
version: 2
columns:
  - { id: c_0, name: A, width: 200 }
  - { id: c_1, name: B }
rows:
  - { id: r_0, cells: { c_0: "1", c_1: "${LONG_TEXT}" } }
---
`;

test('an auto column next to a fixed one is pinned to its own content width, not squeezed to nothing', async ({ page, renderBlock }) => {
	await renderBlock(SOURCE);

	const fixedWidth = await page.locator('col[data-col="0"]').evaluate(el => (el as HTMLElement).getBoundingClientRect().width);
	expect(fixedWidth).toBe(200);

	// Without applyAutoColWidths running, the table's overall CSS width is set
	// from only the columns that have an explicit width (renderer.ts's
	// totalWidth), so a table-layout:fixed column with no width of its own gets
	// squeezed toward zero rather than sized to its real content — this
	// threshold is comfortably below what LONG_TEXT actually needs on one line
	// but well above what a squeezed-to-nothing column would measure.
	const autoWidth = await page.locator('col[data-col="1"]').evaluate(el => (el as HTMLElement).getBoundingClientRect().width);
	expect(autoWidth).toBeGreaterThan(150);
});
