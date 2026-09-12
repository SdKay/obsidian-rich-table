import { test, expect } from '../../common/test-base';

/**
 * Reported: a multi-line cell where both the line above and the line below
 * contain inline code — their code backgrounds visually overlapped. Obsidian's
 * own inline-`code` styling (background, padding) is theme/snippet territory
 * this plugin doesn't control, and a "chunky" style (generous vertical
 * padding) can render taller than the theme's own line-height, so the code's
 * background paints past its own line into the next one.
 *
 * Fixed by applyCodeLineHeightFix (renderAutofit.ts): measure whatever
 * `<code>` element actually rendered, and only widen line-height enough to
 * fit it — a no-op for the overwhelming majority of tables with no inline
 * code at all.
 *
 * The test harness's MarkdownRenderer stub (obsidian-shim.ts) deliberately
 * does not parse inline markdown at all — "no layout question turns on
 * whether `**a**` came out bold" — so a backtick code span typed into a
 * cell's source text never becomes a real `<code>` element here. This test
 * instead builds the exact DOM shape a real render would (two `<p>`s, one
 * `<code>` each) directly, and calls the real, exported
 * applyCodeLineHeightFix on it — testing the fix's own measurement/decision
 * logic in isolation from markdown parsing, which is a separate concern
 * already covered by production use (and untestable here regardless).
 */
const SOURCE = `---
version: 2
columns:
  - { id: c_0, name: A, width: 200 }
rows:
  - { id: r_0, cells: { c_0: alpha } }
---
`;

// A realistic "chunky" theme code style — generous vertical padding relative
// to a typical tight line-height, the exact shape that caused the overlap.
const CHUNKY_CODE_CSS = `
code { padding: 0.5em 0.4em; background: rgba(120, 120, 120, 0.3); border-radius: 4px; }
.bt-td p { line-height: 1.2; font-size: 16px; }
`;

test('two stacked lines of inline code no longer visually overlap after the fix runs', async ({ page, renderReal }) => {
	await renderReal(SOURCE);
	await page.addStyleTag({ content: CHUNKY_CODE_CSS });

	// One <p> with an embedded <br> — the actual shape a soft line break
	// inside one cell produces (see CLAUDE.md's own note on this), not two
	// separate <p>s.
	await page.locator('.bt-td').first().evaluate(cell => {
		cell.innerHTML = '<p><code>alpha</code><br><code>beta</code></p>';
	});

	// Before the fix runs: reproduces the reported overlap (sanity-checks the
	// injected styles actually create the problem, not just assert the fix).
	const before = await page.evaluate(() => {
		const codes = Array.from(document.querySelectorAll('.bt-td code'));
		const [a, b] = codes.map(c => c.getBoundingClientRect());
		return { overlap: b.top < a.bottom - 0.5 };
	});
	expect(before.overlap, 'the chunky code style fixture should reproduce the overlap before the fix runs').toBe(true);

	await page.evaluate(() => {
		const table = document.querySelector('table.bt-table');
		window.RichTableReal.applyCodeLineHeightFix(table);
	});

	const after = await page.evaluate(() => {
		const codes = Array.from(document.querySelectorAll('.bt-td code'));
		const [a, b] = codes.map(c => c.getBoundingClientRect());
		return { overlap: b.top < a.bottom - 0.5 };
	});
	expect(after.overlap).toBe(false);
});

test('a table with no inline code is left untouched', async ({ page, renderReal }) => {
	await renderReal(SOURCE);
	await page.addStyleTag({ content: CHUNKY_CODE_CSS });

	await page.evaluate(() => {
		const table = document.querySelector('table.bt-table');
		window.RichTableReal.applyCodeLineHeightFix(table);
	});

	const varValue = await page.locator('table.bt-table').evaluate(el =>
		(el as HTMLElement).style.getPropertyValue('--bt-cell-line-height'));
	expect(varValue).toBe('');
});
