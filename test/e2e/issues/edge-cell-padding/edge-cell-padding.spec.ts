import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported: a table's first-column cells rendered visibly off-center — text-
// align:center was centering correctly, but WITHIN a padding box that had lost
// its leading (left, in LTR) padding. Root cause, confirmed via the reporter's
// own getComputedStyle + matched-CSSRules dump: Obsidian's real reading-view/
// live-preview CSS trims a row's first cell's leading padding (and the last
// cell's trailing padding) to sit flush with surrounding note text — via
// ".markdown-preview-view td:first-child { padding-inline-start: ... }" — whose
// specificity (2 classes + a pseudo-class + an element selector) beat this
// plugin's base ".bt-table .bt-th, .bt-table .bt-td" rule (2 classes only)
// outright. obsidian-vars.css now reproduces that exact competing declaration
// (see its own comment) so this conflict fails here instead of only in a vault.
const SOURCE = tableSource({
	widths: [108, 40],
	rows: [
		{ 0: '3', 1: '4' },
		{ 0: '5', 1: '6' },
	],
	merges: [[0, 1, 1, 1]],
});

test('a row\'s first and last cell keep their own full padding despite Obsidian\'s edge-cell trim', async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	const cells = await page.evaluate(() => {
		const els = Array.from(document.querySelectorAll('[data-row][data-col]')) as HTMLElement[];
		return els.map(el => {
			const cs = getComputedStyle(el);
			return { row: el.dataset.row, col: el.dataset.col, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight };
		});
	});

	for (const cell of cells) {
		expect(cell.paddingLeft, `row ${cell.row} col ${cell.col} lost its left padding`).toBe('12px');
		expect(cell.paddingRight, `row ${cell.row} col ${cell.col} lost its right padding`).toBe('12px');
	}
});
