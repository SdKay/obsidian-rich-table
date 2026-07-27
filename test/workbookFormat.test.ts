/**
 * Multi-sheet workbook format (v3) — parse/serialize round-trip and the
 * structural detection `parseSource` dispatches on. Same "semantic round
 * trip a real write-back/reload cycle depends on" approach as
 * test/v2.roundtrip.test.ts's views section, one level up (workbook, not
 * just a single sheet's model).
 */
import { describe, it, expect } from 'vitest';
import { parseTable, parseWorkbook, parseSource } from '../src/parser';
import { serializeTable, serializeWorkbook } from '../src/serializer';
import type { WorkbookV3 } from '../src/model';

function baseWorkbook(): WorkbookV3 {
	return {
		version: 3,
		title: 'My workbook',
		activeSheetId: 's_a',
		sheets: [
			{
				id: 's_a', version: 2, name: 'Sheet A', tabColor: '#ff0000', tabTextColor: '#ffffff',
				columns: [{ id: 'c_0', name: 'Col A' }],
				rows: [{ id: 'r_0', cells: { c_0: 'hello' } }],
				merges: [], styles: [],
			},
			{
				id: 's_b', version: 2,
				columns: [{ id: 'c_1', name: 'Col B' }],
				rows: [{ id: 'r_1', cells: { c_1: 'world' } }],
				merges: [], styles: [],
			},
		],
	};
}

describe('parseWorkbook structural detection', () => {
	it('returns null for a plain single-sheet v2 table (no sheets field)', () => {
		const source = serializeTable(parseTable(''));
		expect(parseWorkbook(source)).toBeNull();
	});

	it('returns null for a sheets field that parses to zero valid entries', () => {
		const source = '---\nversion: 3\nsheets: []\n---\n';
		expect(parseWorkbook(source)).toBeNull();
	});

	it('parses a real sheets array', () => {
		const source = serializeWorkbook(baseWorkbook());
		const wb = parseWorkbook(source);
		expect(wb).not.toBeNull();
		expect(wb!.sheets).toHaveLength(2);
	});
});

describe('parseSource dispatch', () => {
	it('dispatches a plain table to TableModelV2 (version 2)', () => {
		const source = serializeTable(parseTable(''));
		const result = parseSource(source);
		expect(result.version).toBe(2);
	});

	it('dispatches a workbook source to WorkbookV3 (version 3)', () => {
		const source = serializeWorkbook(baseWorkbook());
		const result = parseSource(source);
		expect(result.version).toBe(3);
	});
});

describe('workbook round-trip (serializeWorkbook → parseWorkbook)', () => {
	it('preserves title, activeSheetId, and every sheet field including tab style', () => {
		const wb = baseWorkbook();
		const reparsed = parseWorkbook(serializeWorkbook(wb));
		expect(reparsed).toEqual(wb);
	});

	it('second round trip is byte-stable (same Principle-3 guarantee as the single-sheet case)', () => {
		const wb = baseWorkbook();
		const once = serializeWorkbook(parseWorkbook(serializeWorkbook(wb))!);
		const twice = serializeWorkbook(parseWorkbook(once)!);
		expect(once).toBe(twice);
	});

	it('a duplicate sheet id (e.g. from hand-editing) is silently re-generated, not rejected', () => {
		const source = [
			'---',
			'version: 3',
			'active_sheet: s_dup',
			'sheets:',
			'  - id: s_dup',
			'    columns: []',
			'    rows: []',
			'  - id: s_dup',
			'    columns: []',
			'    rows: []',
			'---',
			'',
		].join('\n');
		const wb = parseWorkbook(source);
		expect(wb).not.toBeNull();
		expect(wb!.sheets).toHaveLength(2);
		const ids = wb!.sheets.map(s => s.id);
		expect(new Set(ids).size).toBe(2); // deduped, no longer identical
	});

	it('an active_sheet pointing nowhere falls back to the first sheet — a workbook always has SOME active sheet', () => {
		const source = [
			'---',
			'version: 3',
			'active_sheet: s_does_not_exist',
			'sheets:',
			'  - id: s_only',
			'    columns: []',
			'    rows: []',
			'---',
			'',
		].join('\n');
		const wb = parseWorkbook(source);
		expect(wb!.activeSheetId).toBe('s_only');
	});

	it('editing one sheet leaves an untouched sibling sheet\'s re-parsed fields byte-identical', () => {
		const wbBefore = baseWorkbook();
		const wbAfter = baseWorkbook();
		wbAfter.sheets[0]!.columns[0]!.name = 'Renamed column A'; // only sheet A changes

		const sheetBBefore = parseWorkbook(serializeWorkbook(wbBefore))!.sheets.find(s => s.id === 's_b');
		const sheetBAfter  = parseWorkbook(serializeWorkbook(wbAfter))!.sheets.find(s => s.id === 's_b');
		expect(sheetBAfter).toEqual(sheetBBefore);
	});
});
