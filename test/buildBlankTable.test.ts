/**
 * buildBlankTable: the "start from scratch" counterpart to the demo template
 * inserted from the empty-block banner's new "Insert blank table" button.
 */
import { describe, it, expect } from 'vitest';
import { buildBlankTable } from '../src/blankTable';
import { parseTable } from '../src/parser';
import { serializeTable } from '../src/serializer';

describe('buildBlankTable', () => {
	it('creates the requested number of columns and rows, all empty', () => {
		const model = buildBlankTable(3, 4);
		expect(model.columns).toHaveLength(4);
		expect(model.rows).toHaveLength(3);
		expect(model.merges).toEqual([]);
		expect(model.styles).toEqual([]);
		for (const col of model.columns) expect(col.name).toBe('');
		for (const row of model.rows) {
			for (const col of model.columns) expect(row.cells[col.id]).toBe('');
		}
	});

	it('gives every row and column a unique id', () => {
		const model = buildBlankTable(5, 5);
		expect(new Set(model.columns.map(c => c.id)).size).toBe(5);
		expect(new Set(model.rows.map(r => r.id)).size).toBe(5);
	});

	it('round-trips through serializeTable/parseTable unchanged in shape', () => {
		const model = buildBlankTable(2, 3);
		const reparsed = parseTable(serializeTable(model));
		expect(reparsed.columns).toHaveLength(3);
		expect(reparsed.rows).toHaveLength(2);
		expect(reparsed.columns.map(c => c.id)).toEqual(model.columns.map(c => c.id));
		expect(reparsed.rows.map(r => r.id)).toEqual(model.rows.map(r => r.id));
	});

	it('supports a 1×1 minimum', () => {
		const model = buildBlankTable(1, 1);
		expect(model.columns).toHaveLength(1);
		expect(model.rows).toHaveLength(1);
	});
});
