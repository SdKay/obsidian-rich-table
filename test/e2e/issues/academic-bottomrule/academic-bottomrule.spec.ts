import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported (github.com/SdKay/obsidian-rich-table/issues/8): the academic
// theme's bottomrule (a box-shadow on <tbody>, since a rowspanned merge
// reaching the last row has no <td> of its own in that row's <tr> — see this
// file's own comment) disappeared once a background color was set on the
// last data row. Table cells paint AFTER their row group under normal CSS
// table-painting order, so an opaque per-cell background (applyResolvedStyle,
// inline !important) painted straight over the line tbody drew at that exact
// boundary. Fixed by ALSO drawing the same shadow directly on the last row's
// own cells, kept alongside (not instead of) the tbody rule so a rowspanned
// merge's column still gets the line from that rule.
test.describe('academic theme bottomrule survives a background on the last row', () => {
	const bgSource = tableSource({
		widths: [80, 80],
		rows: [{ 0: 'a1', 1: 'b1' }, { 0: 'a2', 1: 'b2' }],
		theme: 'academic',
		styles: [{ target: 'r_1.c_0:r_1.c_1', bg: '#ffcccc' }],
	});

	test('the last row\'s own cells carry the bottomrule box-shadow when it has a background', async ({ page, renderFull }) => {
		await renderFull(bgSource);
		const shadows = await page.evaluate(() => {
			const cells = Array.from(document.querySelectorAll('[data-row="2"]')) as HTMLElement[];
			return cells.map(c => getComputedStyle(c).boxShadow);
		});
		expect(shadows.length).toBe(2);
		for (const s of shadows) {
			expect(s).not.toBe('none');
			expect(s).toContain('inset');
		}
	});

	const mergeSource = tableSource({
		widths: [80, 80],
		rows: [{ 0: 'merged', 1: 'b1' }, { 1: 'b2' }],
		theme: 'academic',
		merges: [[0, 0, 1, 0]],
	});

	test('a merge spanning into the last row still gets the line under its own column (tbody rule)', async ({ page, renderFull }) => {
		await renderFull(mergeSource);
		// The merged cell (column A) lives in row 1's <tr>, has no cell of its
		// own in row 2 — its line has to come from tbody's own box-shadow, not
		// the per-cell rule this fix added.
		const tbodyShadow = await page.evaluate(() => getComputedStyle(document.querySelector('tbody') as HTMLElement).boxShadow);
		expect(tbodyShadow).not.toBe('none');
		expect(tbodyShadow).toContain('inset');
	});
});
