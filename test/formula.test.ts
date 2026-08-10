import { describe, it, expect } from 'vitest';
import { parseTable } from '../src/parser';
import { serializeTable } from '../src/serializer';
import { applyStructuralOpV2 } from '../src/operations';
import { parseFormula, evaluateFormula, recomputeFormulas } from '../src/formula';
import type { TableModelV2 } from '../src/model';

describe('formulas YAML field', () => {
	it('parses formulas from front-matter', () => {
		const source = `---
version: 2
columns:
  - id: c_000000
    name: A
  - id: c_000001
    name: B
rows:
  - id: r_000000
    cells: { c_000000: "1", c_000001: "2" }
    formulas: { c_000001: "=r_000000.c_000000+1" }
---
`;
		const model = parseTable(source);
		expect(model.rows[0]?.formulas).toEqual({ c_000001: '=r_000000.c_000000+1' });
	});

	it('omits formulas entirely when a row has none', () => {
		const source = `---
version: 2
columns:
  - id: c_000000
    name: A
rows:
  - id: r_000000
    cells: { c_000000: "1" }
---
`;
		const model = parseTable(source);
		expect(model.rows[0]?.formulas).toBeUndefined();
	});

	it('serializes formulas back into the YAML front-matter', () => {
		const model = parseTable(`---
version: 2
columns:
  - id: c_000000
    name: A
  - id: c_000001
    name: B
rows:
  - id: r_000000
    cells: { c_000000: "1", c_000001: "2" }
    formulas: { c_000001: "=r_000000.c_000000+1" }
---
`);
		const out = serializeTable(model);
		expect(out).toContain('formulas:');
		expect(out).toContain('c_000001: "=r_000000.c_000000+1"');
	});
});

function opsModel(): TableModelV2 {
	return {
		version: 2,
		columns: [
			{ id: 'c_0', name: 'A' },
			{ id: 'c_1', name: 'B' },
		],
		rows: [
			{ id: 'r_0', cells: { c_0: '1', c_1: '2' }, formulas: { c_1: '=r_0.c_0+1' } },
		],
		merges: [],
		styles: [],
	};
}

describe('delete-col cleans up formulas', () => {
	it('removes the formula entry for the deleted column', () => {
		const model = opsModel();
		applyStructuralOpV2(model, { type: 'delete-col', colId: 'c_1' });
		expect(model.rows[0]?.formulas).toBeUndefined();
	});

	it('leaves other columns\' formulas untouched', () => {
		const model = opsModel();
		model.columns.push({ id: 'c_2', name: 'C' });
		model.rows[0]!.cells.c_2 = '3';
		model.rows[0]!.formulas!.c_2 = '=r_0.c_0+2';
		applyStructuralOpV2(model, { type: 'delete-col', colId: 'c_1' });
		expect(model.rows[0]?.formulas).toEqual({ c_2: '=r_0.c_0+2' });
	});
});

describe('parseFormula', () => {
	it('parses a plain number', () => {
		expect(parseFormula('=42')).toEqual({ kind: 'num', value: 42 });
	});

	it('respects * / over + - precedence', () => {
		expect(parseFormula('=1+2*3')).toEqual({
			kind: 'binop', op: '+',
			left: { kind: 'num', value: 1 },
			right: { kind: 'binop', op: '*', left: { kind: 'num', value: 2 }, right: { kind: 'num', value: 3 } },
		});
	});

	it('parentheses override precedence', () => {
		expect(parseFormula('=(1+2)*3')).toEqual({
			kind: 'binop', op: '*',
			left: { kind: 'binop', op: '+', left: { kind: 'num', value: 1 }, right: { kind: 'num', value: 2 } },
			right: { kind: 'num', value: 3 },
		});
	});

	it('parses unary minus', () => {
		expect(parseFormula('=-5+1')).toEqual({
			kind: 'binop', op: '+',
			left: { kind: 'neg', operand: { kind: 'num', value: 5 } },
			right: { kind: 'num', value: 1 },
		});
	});

	it('parses a single-cell reference', () => {
		expect(parseFormula('=r_abc123.c_def456+1')).toEqual({
			kind: 'binop', op: '+',
			left: { kind: 'ref', rowId: 'r_abc123', colId: 'c_def456' },
			right: { kind: 'num', value: 1 },
		});
	});

	it('parses a function call over a range', () => {
		expect(parseFormula('=SUM(r_a.c_a:r_b.c_a)')).toEqual({
			kind: 'call', name: 'SUM',
			startRowId: 'r_a', startColId: 'c_a', endRowId: 'r_b', endColId: 'c_a',
		});
	});

	it('is case-insensitive on function names', () => {
		expect(parseFormula('=sum(r_a.c_a:r_b.c_a)')).toMatchObject({ kind: 'call', name: 'SUM' });
	});

	it('accepts the leading = being absent (already stripped)', () => {
		expect(parseFormula('42')).toEqual({ kind: 'num', value: 42 });
	});

	it('rejects an unrecognized character', () => {
		expect(parseFormula('=1&2')).toBeNull();
	});

	it('rejects a bare range outside a function call', () => {
		expect(parseFormula('=r_a.c_a:r_b.c_a')).toBeNull();
	});

	it('rejects unbalanced parentheses', () => {
		expect(parseFormula('=(1+2')).toBeNull();
	});

	it('rejects trailing garbage after a valid expression', () => {
		expect(parseFormula('=1+2)')).toBeNull();
	});

	it('rejects an empty formula', () => {
		expect(parseFormula('=')).toBeNull();
	});
});

function evalModel(): TableModelV2 {
	return {
		version: 2,
		columns: [
			{ id: 'c_a', name: 'A' },
			{ id: 'c_b', name: 'B' },
			{ id: 'c_c', name: 'C' },
		],
		rows: [
			{ id: 'r_1', cells: { c_a: '5', c_b: '3' } },
			{ id: 'r_2', cells: { c_a: '10', c_b: '' } },
			{ id: 'r_3', cells: { c_a: 'text', c_b: '2' } },
		],
		merges: [],
		styles: [],
	};
}

describe('evaluateFormula — arithmetic', () => {
	it('evaluates a direct reference plus a literal', () => {
		const m = evalModel();
		m.rows[0]!.formulas = { c_c: '=r_1.c_a+1' };
		expect(evaluateFormula(m, 'r_1', 'c_c')).toBe('6');
	});

	it('treats a blank referenced cell as 0 in arithmetic', () => {
		const m = evalModel();
		m.rows[1]!.formulas = { c_c: '=r_2.c_b+100' };
		expect(evaluateFormula(m, 'r_2', 'c_c')).toBe('100');
	});

	it('returns #VALUE! when a referenced cell is non-numeric text', () => {
		const m = evalModel();
		m.rows[2]!.formulas = { c_c: '=r_3.c_a+1' };
		expect(evaluateFormula(m, 'r_3', 'c_c')).toBe('#VALUE!');
	});

	it('returns #DIV/0! on division by zero', () => {
		const m = evalModel();
		m.rows[0]!.formulas = { c_c: '=1/0' };
		expect(evaluateFormula(m, 'r_1', 'c_c')).toBe('#DIV/0!');
	});

	it('returns #REF! when the referenced row no longer exists', () => {
		const m = evalModel();
		m.rows[0]!.formulas = { c_c: '=r_missing.c_a+1' };
		expect(evaluateFormula(m, 'r_1', 'c_c')).toBe('#REF!');
	});

	it('returns #VALUE! for a syntactically invalid formula', () => {
		const m = evalModel();
		m.rows[0]!.formulas = { c_c: '=1&2' };
		expect(evaluateFormula(m, 'r_1', 'c_c')).toBe('#VALUE!');
	});

	it('chains through another formula cell (multi-level reference)', () => {
		const m = evalModel();
		m.rows[0]!.formulas = { c_c: '=r_1.c_a*2' };   // c_c = 5*2 = 10
		m.rows[1]!.formulas = { c_c: '=r_1.c_c+1' };    // references the OTHER formula cell above
		expect(evaluateFormula(m, 'r_2', 'c_c')).toBe('11');
	});

	it('detects a direct circular reference', () => {
		const m = evalModel();
		m.rows[0]!.formulas = { c_c: '=r_1.c_c+1' }; // references itself
		expect(evaluateFormula(m, 'r_1', 'c_c')).toBe('#CIRCULAR!');
	});

	it('detects an indirect circular reference (A -> B -> A)', () => {
		const m = evalModel();
		m.rows[0]!.formulas = { c_c: '=r_2.c_c+1' };
		m.rows[1]!.formulas = { c_c: '=r_1.c_c+1' };
		expect(evaluateFormula(m, 'r_1', 'c_c')).toBe('#CIRCULAR!');
	});

	it('rounds to at most 2 decimal places', () => {
		const m = evalModel();
		m.rows[0]!.formulas = { c_c: '=10/3' };
		expect(evaluateFormula(m, 'r_1', 'c_c')).toBe('3.33');
	});
});

describe('evaluateFormula — range functions', () => {
	it('SUM skips blank and non-numeric cells (matches aggregate convention)', () => {
		const m = evalModel(); // c_a column: 5, 10, "text"
		m.rows[0]!.formulas = { c_c: '=SUM(r_1.c_a:r_3.c_a)' };
		expect(evaluateFormula(m, 'r_1', 'c_c')).toBe('15');
	});

	it('AVG divides only by the numeric count', () => {
		const m = evalModel();
		m.rows[0]!.formulas = { c_c: '=AVG(r_1.c_a:r_3.c_a)' };
		expect(evaluateFormula(m, 'r_1', 'c_c')).toBe('7.5'); // (5+10)/2, "text" skipped
	});

	it('MIN/MAX over a range', () => {
		const m = evalModel();
		m.rows[0]!.formulas = { c_c: '=MIN(r_1.c_a:r_3.c_a)' };
		expect(evaluateFormula(m, 'r_1', 'c_c')).toBe('5');
		m.rows[0]!.formulas = { c_c: '=MAX(r_1.c_a:r_3.c_a)' };
		expect(evaluateFormula(m, 'r_1', 'c_c')).toBe('10');
	});

	it('COUNT counts non-empty cells regardless of numeric-ness', () => {
		const m = evalModel(); // c_b column: '3', '', '2' — one blank
		m.rows[0]!.formulas = { c_c: '=COUNT(r_1.c_b:r_3.c_b)' };
		expect(evaluateFormula(m, 'r_1', 'c_c')).toBe('2');
	});

	it('propagates #REF! from inside a range if the range itself is invalid', () => {
		const m = evalModel();
		m.rows[0]!.formulas = { c_c: '=SUM(r_1.c_a:r_missing.c_a)' };
		expect(evaluateFormula(m, 'r_1', 'c_c')).toBe('#REF!');
	});
});

describe('recomputeFormulas', () => {
	it('writes every formula cell\'s result into cells, leaving literals untouched', () => {
		const m = evalModel();
		m.rows[0]!.formulas = { c_c: '=r_1.c_a+r_1.c_b' };
		recomputeFormulas(m);
		expect(m.rows[0]!.cells.c_c).toBe('8');
		expect(m.rows[0]!.cells.c_a).toBe('5'); // untouched literal
	});

	it('re-running is idempotent and reflects updated literal inputs', () => {
		const m = evalModel();
		m.rows[0]!.formulas = { c_c: '=r_1.c_a+1' };
		recomputeFormulas(m);
		expect(m.rows[0]!.cells.c_c).toBe('6');
		m.rows[0]!.cells.c_a = '20';
		recomputeFormulas(m);
		expect(m.rows[0]!.cells.c_c).toBe('21');
	});
});

describe('recompute is wired into applyStructuralOpV2 and parseTable', () => {
	it('applyStructuralOpV2 recomputes formulas after any op', () => {
		const m: TableModelV2 = {
			version: 2,
			columns: [{ id: 'c_a', name: 'A' }, { id: 'c_b', name: 'B' }],
			rows: [{ id: 'r_1', cells: { c_a: '5' }, formulas: { c_b: '=r_1.c_a+1' } }],
			merges: [], styles: [],
		};
		applyStructuralOpV2(m, { type: 'set-cell-content', rowId: 'r_1', colId: 'c_a', value: '9' });
		expect(m.rows[0]!.cells.c_b).toBe('10');
	});

	it('parseTable recomputes formulas even if the stored cache was stale', () => {
		const source = `---
version: 2
columns:
  - id: c_000000
    name: A
  - id: c_000001
    name: B
rows:
  - id: r_000000
    cells: { c_000000: "5", c_000001: "999" }
    formulas: { c_000001: "=r_000000.c_000000+1" }
---
`;
		const model = parseTable(source);
		expect(model.rows[0]?.cells.c_000001).toBe('6');
	});
});

describe('set-cell-formula', () => {
	function m(): TableModelV2 {
		return {
			version: 2,
			columns: [{ id: 'c_a', name: 'A' }, { id: 'c_b', name: 'B' }],
			rows: [{ id: 'r_1', cells: { c_a: '5' } }],
			merges: [], styles: [],
		};
	}

	it('sets a formula and the recompute pass fills in the cached value', () => {
		const model = m();
		applyStructuralOpV2(model, { type: 'set-cell-formula', rowId: 'r_1', colId: 'c_b', formula: '=r_1.c_a+1' });
		expect(model.rows[0]!.formulas).toEqual({ c_b: '=r_1.c_a+1' });
		expect(model.rows[0]!.cells.c_b).toBe('6');
	});

	it('clearing a formula (formula: null) removes it and leaves the last cached value as a plain literal', () => {
		const model = m();
		applyStructuralOpV2(model, { type: 'set-cell-formula', rowId: 'r_1', colId: 'c_b', formula: '=r_1.c_a+1' });
		applyStructuralOpV2(model, { type: 'set-cell-formula', rowId: 'r_1', colId: 'c_b', formula: null });
		expect(model.rows[0]!.formulas).toBeUndefined();
		expect(model.rows[0]!.cells.c_b).toBe('6'); // last computed value stays as a plain value
	});

	it('is a no-op for a nonexistent row', () => {
		const model = m();
		applyStructuralOpV2(model, { type: 'set-cell-formula', rowId: 'r_missing', colId: 'c_b', formula: '=1+1' });
		expect(model.rows[0]!.formulas).toBeUndefined();
	});
});
