import { describe, it, expect } from 'vitest';
import {
	findMarkdownTableAtCursor,
	buildTableFromGrid,
	planMarkdownTableConversion,
} from '../src/convertMarkdownTable';
import { parseTable } from '../src/parser';

describe('findMarkdownTableAtCursor', () => {
	const doc = [
		'Some intro text.',
		'',
		'| Task   | Status |',
		'| ------ | ------ |',
		'| Design | done   |',
		'| Build  | pending|',
		'',
		'Trailing text.',
	];

	it('detects the table range when the cursor is on the header row', () => {
		const found = findMarkdownTableAtCursor(doc, 2);
		expect(found).not.toBeNull();
		expect(found!.startLine).toBe(2);
		expect(found!.endLine).toBe(5);
		expect(found!.values).toEqual([
			['Task', 'Status'],
			['Design', 'done'],
			['Build', 'pending'],
		]);
	});

	it('detects the same range when the cursor is on a data row', () => {
		const found = findMarkdownTableAtCursor(doc, 4);
		expect(found).not.toBeNull();
		expect(found!.startLine).toBe(2);
		expect(found!.endLine).toBe(5);
	});

	it('returns null when the cursor is not on a table row at all', () => {
		expect(findMarkdownTableAtCursor(doc, 0)).toBeNull();
		expect(findMarkdownTableAtCursor(doc, 1)).toBeNull();
		expect(findMarkdownTableAtCursor(doc, 7)).toBeNull();
	});

	it('returns null for a pipe-containing line that is not a real table (no valid delimiter row)', () => {
		const notATable = ['Look at a | b, not a table.'];
		expect(findMarkdownTableAtCursor(notATable, 0)).toBeNull();
	});

	it('returns null when the cursor is inside a fenced code block, even one that contains pipe-shaped text', () => {
		const withFence = [
			'```',
			'| a | b |',
			'| - | - |',
			'| 1 | 2 |',
			'```',
		];
		expect(findMarkdownTableAtCursor(withFence, 1)).toBeNull();
		expect(findMarkdownTableAtCursor(withFence, 2)).toBeNull();
	});

	it('finds a table that is not inside a fence, even when a fenced block appears earlier in the document', () => {
		const doc2 = [
			'```',
			'cmd1 | cmd2',
			'```',
			'',
			'| a | b |',
			'| - | - |',
			'| 1 | 2 |',
		];
		const found = findMarkdownTableAtCursor(doc2, 5);
		expect(found).not.toBeNull();
		expect(found!.startLine).toBe(4);
		expect(found!.endLine).toBe(6);
	});
});

describe('buildTableFromGrid', () => {
	it('turns the header row into column names and the rest into data rows', () => {
		const model = buildTableFromGrid([
			['Task', 'Status'],
			['Design', 'done'],
			['Build', 'pending'],
		]);
		expect(model.columns.map(c => c.name)).toEqual(['Task', 'Status']);
		expect(model.rows).toHaveLength(2);
		const [taskCol, statusCol] = model.columns;
		expect(model.rows[0]!.cells[taskCol!.id]).toBe('Design');
		expect(model.rows[0]!.cells[statusCol!.id]).toBe('done');
		expect(model.rows[1]!.cells[taskCol!.id]).toBe('Build');
	});

	it('gives every row and column a unique id', () => {
		const model = buildTableFromGrid([['A', 'B', 'C'], ['1', '2', '3']]);
		expect(new Set(model.columns.map(c => c.id)).size).toBe(3);
	});

	it('pads a short data row with empty cells rather than throwing', () => {
		const model = buildTableFromGrid([['A', 'B'], ['only-one']]);
		const [colA, colB] = model.columns;
		expect(model.rows[0]!.cells[colA!.id]).toBe('only-one');
		expect(model.rows[0]!.cells[colB!.id]).toBe('');
	});

	it('drops extra cells in a data row wider than the header', () => {
		const model = buildTableFromGrid([['A'], ['1', 'extra']]);
		expect(model.columns).toHaveLength(1);
		expect(model.rows[0]!.cells[model.columns[0]!.id]).toBe('1');
	});
});

describe('planMarkdownTableConversion', () => {
	it('produces a rich-table block that parses back to the same data', () => {
		const doc = [
			'| Task   | Status |',
			'| ------ | ------ |',
			'| Design | done   |',
		];
		const plan = planMarkdownTableConversion(doc, 0);
		expect(plan).not.toBeNull();
		expect(plan!.startLine).toBe(0);
		expect(plan!.endLine).toBe(2);
		expect(plan!.blockText.startsWith('```rich-table\n')).toBe(true);
		expect(plan!.blockText.endsWith('\n```')).toBe(true);

		const yaml = plan!.blockText.slice('```rich-table\n'.length, -'\n```'.length);
		const model = parseTable(yaml);
		expect(model.columns.map(c => c.name)).toEqual(['Task', 'Status']);
		expect(model.rows).toHaveLength(1);
	});

	it('returns null when there is nothing to convert', () => {
		expect(planMarkdownTableConversion(['plain text'], 0)).toBeNull();
	});
});
