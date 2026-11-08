import { test, expect } from '../../common/test-base';

// A column with no width of its own beside one that has one: the auto column is sized to its content by the
// browser, not squeezed to nothing by its pinned neighbour.
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

test('an auto column next to a fixed one is sized to its content, not squeezed to nothing', { tag: '@geometry' }, async ({ page, renderBlock }) => {
	await renderBlock(SOURCE);

	const fixedWidth = await page.locator('col[data-col="0"]').evaluate(el => (el as HTMLElement).getBoundingClientRect().width);
	expect(fixedWidth).toBe(200);

	// Comfortably below what LONG_TEXT needs on one line, well above a squeezed-to-nothing column.
	const autoWidth = await page.locator('col[data-col="1"]').evaluate(el => (el as HTMLElement).getBoundingClientRect().width);
	expect(autoWidth).toBeGreaterThan(150);
});
