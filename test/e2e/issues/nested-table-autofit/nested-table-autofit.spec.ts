import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// A nested rich-table block's own .bt-table-wrapper has `max-width: 100%`
// (styles.css) — capped down to whatever the outer cell already is — so
// measuring offsetWidth/clientWidth for auto-fit just confirms the existing
// (too-narrow) width forever. Simulates the nested render (which this
// harness's MarkdownRenderer stub can't actually produce) by injecting the
// same DOM shape auto-fit looks for: a `.bt-render-root .bt-table-wrapper`
// whose CONTENT overflows past that cap, so its scrollWidth reflects the
// true wider content while its own rendered box stays capped.
//
// Auto-fit no longer computes and dispatches a one-shot width on click — a
// double-click or the "auto-fit all" button now clears the column back to
// auto (see CLAUDE.md's "auto" width design), and the actual pinning happens
// in applyAutoColWidths (renderAutofit.ts), called from tableBlock.ts right
// after every render. A column stays eligible for that pinning only while at
// least one OTHER column in the table has an explicit width of its own
// (renderer.ts's hasExplicitWidths) — if every column were cleared at once
// (auto-fit-all's own effect), the whole table falls back to the browser's
// native table-layout:auto instead, which is no longer this codebase's own
// measurement code to test. So this exercises the one path that IS still
// ours: a column with no width of its own, sitting next to a column that has
// one, gets pinned to its real content width via applyAutoColWidths, and
// that measurement must see the nested table's true (uncapped) scrollWidth.
const SOURCE = tableSource({
	widths: [50, 0],
	rows: [{ 0: 'x', 1: 'y' }],
});

test("applyAutoColWidths pins an auto column to a nested table's true content width, not its capped rendered width", async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	await page.evaluate(() => {
		const cell = document.querySelector('[data-row="1"][data-col="1"]')!;
		cell.innerHTML = '';
		const root = document.createElement('div');
		root.className = 'bt-render-root';
		const wrapper = document.createElement('div');
		wrapper.className = 'bt-table-wrapper';
		const wide = document.createElement('div');
		wide.style.width = '800px';
		wide.style.height = '1px';
		wrapper.appendChild(wide);
		root.appendChild(wrapper);
		cell.appendChild(root);
	});

	// Re-run the same pinning pass tableBlock.ts's render() runs after every
	// real render, now that the nested table's DOM is in place.
	await page.evaluate(() => {
		const table = document.querySelector('table.bt-table')!;
		window.RichTableReal.applyAutoColWidths(table as HTMLElement);
	});

	const autoColWidth = await page.locator('col[data-col="1"]').evaluate(el => (el as HTMLElement).getBoundingClientRect().width);
	expect(autoColWidth, "should grow to the nested table's true (wide) content width, not stay squeezed").toBeGreaterThan(700);
});
