import { test, expect } from '../../common/test-base';
import { scrollableTable } from '../../common/fixtures';

// Reported as the frozen band looking "broken/incomplete" (看着太丑了) whenever
// more than one row or column was frozen: every frozen cell had ALL its borders
// suppressed, which erased the separators INSIDE the band and replaced only the
// band's outer edges, leaving one flat line-less block.
//
// Rewritten against the REAL source — the hand-ported fixture this replaced
// still asserted a 2px synthetic seam line that the plugin no longer draws, and
// passed regardless because it tested its own copy of the old algorithm.
test.describe('freeze-multi-band', () => {
	const SOURCE = scrollableTable({ freezeRows: 2, freezeCols: 2, theme: 'grid' });

	test('interior cells of a multi-row/multi-column block keep every real border', async ({ page, renderReal }) => {
		await renderReal(SOURCE);
		// Row 1 / column 1: inside the block on both axes, touching none of its
		// outer edges, so nothing about it should be suppressed at all.
		const sides = await page.locator('#table td[data-row="1"][data-col="1"]').evaluate(el => {
			const cs = getComputedStyle(el);
			return { top: cs.borderTopColor, right: cs.borderRightColor, bottom: cs.borderBottomColor, left: cs.borderLeftColor };
		});
		// top/left are none by design for every cell (one border per edge — the
		// table's outer frame supplies the grid's top and left), so the two edges
		// this cell actually owns are the ones to check.
		expect(sides.right).toBe('rgb(17, 17, 17)');
		expect(sides.bottom).toBe('rgb(17, 17, 17)');
	});

	test('the block\'s true corner cell suppresses only its two outer-frame sides', async ({ page, renderReal }) => {
		await renderReal(SOURCE);
		const sides = await page.locator('#table th[data-col="0"]').evaluate(el => {
			const cs = getComputedStyle(el);
			return { top: cs.borderTopColor, right: cs.borderRightColor, bottom: cs.borderBottomColor, left: cs.borderLeftColor };
		});
		// Only the two edges replaced by the synthetic outer frame are hidden…
		expect(sides.top).toBe('rgba(0, 0, 0, 0)');
		expect(sides.left).toBe('rgba(0, 0, 0, 0)');
		// …and the two facing INTO the block keep the theme's real gridline.
		expect(sides.right).toBe('rgb(17, 17, 17)');
		expect(sides.bottom).not.toBe('rgba(0, 0, 0, 0)');
	});

	test('the seam against the scrolling region keeps the theme\'s own line, plus elevation', async ({ page, renderReal }) => {
		await renderReal(SOURCE);
		// The last frozen row/column used to have its border replaced by a generic
		// synthetic line, which under grid swapped a near-black rule for a pale
		// grey one a pixel out of place. Now the real border stays and only the
		// elevation shadow is added, so the block reads as floating above the
		// content it covers.
		const lastRow = await page.locator('#table td[data-row="2"][data-col="4"]').evaluate(el => {
			const cs = getComputedStyle(el);
			return { bottom: cs.borderBottomColor, shadow: cs.boxShadow };
		});
		expect(lastRow.bottom).toBe('rgb(17, 17, 17)');
		expect(lastRow.shadow).toContain('inset');

		const lastCol = await page.locator('#table td[data-row="4"][data-col="1"]').evaluate(el => {
			const cs = getComputedStyle(el);
			return { right: cs.borderRightColor, shadow: cs.boxShadow };
		});
		expect(lastCol.right).toBe('rgb(17, 17, 17)');
		expect(lastCol.shadow).toContain('inset');
	});
});
