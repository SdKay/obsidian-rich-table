import { describe, it, expect } from 'vitest';
import { parseMarkdownPipeTable, buildRangeHtml } from '../src/renderClipboard';
import type { TableModelV2 } from '../src/model';

function baseModel(): TableModelV2 {
	return {
		version: 2,
		columns: [
			{ id: 'c_0', name: 'A' },
			{ id: 'c_1', name: 'B' },
			{ id: 'c_2', name: 'C' },
		],
		rows: [
			{ id: 'r_0', cells: { c_0: 'a0', c_1: 'b0', c_2: 'c0v' } },
			{ id: 'r_1', cells: { c_0: 'a1', c_1: 'b1', c_2: 'c1v' } },
			{ id: 'r_2', cells: { c_0: 'a2', c_1: 'b2', c_2: 'c2v' } },
		],
		merges: [],
		styles: [],
	};
}

describe('parseMarkdownPipeTable', () => {
	it('parses a standard piped table with a header row', () => {
		const text = [
			'| a | b |',
			'| --- | --- |',
			'| 1 | 2 |',
			'| 3 | 4 |',
		].join('\n');
		expect(parseMarkdownPipeTable(text)).toEqual([
			['a', 'b'],
			['1', '2'],
			['3', '4'],
		]);
	});

	it('parses a table without leading/trailing pipes', () => {
		const text = [
			'a | b',
			'--- | ---',
			'1 | 2',
		].join('\n');
		expect(parseMarkdownPipeTable(text)).toEqual([
			['a', 'b'],
			['1', '2'],
		]);
	});

	it('accepts alignment colons in the delimiter row', () => {
		const text = [
			'| a | b | c |',
			'| :-- | :-: | --: |',
			'| 1 | 2 | 3 |',
		].join('\n');
		expect(parseMarkdownPipeTable(text)).toEqual([
			['a', 'b', 'c'],
			['1', '2', '3'],
		]);
	});

	it('unescapes \\| and converts <br> back to a newline (round-trips copyRangeAsMarkdown output)', () => {
		const text = [
			'| a\\|b | line1<br>line2 |',
			'| --- | --- |',
		].join('\n');
		expect(parseMarkdownPipeTable(text)).toEqual([
			['a|b', 'line1\nline2'],
		]);
	});

	it('tolerates a header-only table with a trailing blank line', () => {
		const text = '| a | b |\n| --- | --- |\n';
		expect(parseMarkdownPipeTable(text)).toEqual([['a', 'b']]);
	});

	it('preserves a legitimately empty middle cell', () => {
		const text = '| a | | c |\n| --- | --- | --- |\n';
		expect(parseMarkdownPipeTable(text)).toEqual([['a', '', 'c']]);
	});

	it('returns null for plain multi-line prose', () => {
		expect(parseMarkdownPipeTable('just some text\nacross two lines')).toBeNull();
	});

	it('returns null for a single line, even one with pipes', () => {
		expect(parseMarkdownPipeTable('| a | b |')).toBeNull();
	});

	it('returns null for a Setext-style heading underline (no pipes at all)', () => {
		// A bare "---" line matches the delimiter-row dash pattern on its own —
		// the whole point of requiring a pipe in BOTH lines is to reject this.
		expect(parseMarkdownPipeTable('My Heading\n---\nSome paragraph text.')).toBeNull();
	});

	it('returns null when the second line is not a real delimiter row', () => {
		expect(parseMarkdownPipeTable('| a | b |\n| 1 | 2 |')).toBeNull();
	});
});

describe('buildRangeHtml', () => {
	// Display row indices: 0 = header, 1 = r_0, 2 = r_1, 3 = r_2.

	it('emits a plain cell per column when there are no merges', () => {
		const model = baseModel();
		const html = buildRangeHtml(model, 1, 1, 0, 1);
		expect(html).toBe('<table><tr><td>a0</td><td>b0</td></tr></table>');
	});

	it('turns a vertical merge fully inside the range into a rowspan, omitting the covered cell', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'r_0.c_0', end: 'r_1.c_0' }); // spans display rows 1..2
		const html = buildRangeHtml(model, 1, 3, 0, 0);
		expect(html).toBe(
			'<table>' +
			'<tr><td rowspan="2">a0</td></tr>' +
			'<tr></tr>' +
			'<tr><td>a2</td></tr>' +
			'</table>',
		);
	});

	it('turns a rectangular merge into a rowspan+colspan and omits every covered cell', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'r_0.c_0', end: 'r_1.c_1' }); // spans display rows 1..2, cols 0..1
		const html = buildRangeHtml(model, 1, 2, 0, 2);
		expect(html).toBe(
			'<table>' +
			'<tr><td rowspan="2" colspan="2">a0</td><td>c0v</td></tr>' +
			'<tr><td>c1v</td></tr>' +
			'</table>',
		);
	});

	it('clips a span that extends past the copied range\'s own edge', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'r_0.c_0', end: 'r_2.c_0' }); // spans all 3 data rows (display 1..3)
		const html = buildRangeHtml(model, 1, 2, 0, 0); // but only display rows 1..2 are copied
		expect(html).toBe('<table><tr><td rowspan="2">a0</td></tr><tr></tr></table>');
	});

	it('leaves a covered cell as an ordinary blank cell when the merge\'s anchor is outside the range', () => {
		const model = baseModel();
		model.rows[1]!.cells.c_0 = ''; // a real merge leaves the covered cell's own content empty
		model.merges.push({ anchor: 'r_0.c_0', end: 'r_1.c_0' }); // spans display rows 1..2
		const html = buildRangeHtml(model, 2, 2, 0, 0); // copies only display row 2, the covered half
		expect(html).toBe('<table><tr><td></td></tr></table>');
	});

	it('covers the header row using the "header" sentinel anchor/end', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'header.c_0', end: 'header.c_1' });
		const html = buildRangeHtml(model, 0, 0, 0, 2);
		expect(html).toBe('<table><tr><td colspan="2">A</td><td>C</td></tr></table>');
	});
});
