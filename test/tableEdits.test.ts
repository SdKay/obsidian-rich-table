import { describe, it, expect } from 'vitest';
import { tableEdits, NO_EDITS, type TableOp, type TableOpType } from '../src/tableEdits';
import { editPolicy, type PolicyInput } from '../src/editPolicy';
import { effectOfType } from '../src/opEffect';
import { withEdits, type CellOpEntry } from '../src/renderPanel';
import { isWorkbookOp, WORKBOOK_OP_TYPES } from '../src/workbookOperations';
import { STRUCTURAL_OP_TYPES } from '../src/operations';

const base: PolicyInput = { surface: 'live', readingEdit: false, locked: false, legacy: false, empty: false };
const make = (policy: Partial<PolicyInput>, accepts: (t: TableOpType) => boolean = () => true) => {
	const written: TableOp[] = [];
	const edits = tableEdits(accepts, editPolicy({ ...base, ...policy }).permits, op => { written.push(op); });
	return { edits, written };
};
const op = (type: string) => ({ type } as unknown as TableOp);

describe('tableEdits', () => {
	it('an unlocked native table in live preview can do everything', () => {
		const { edits } = make({});
		for (const t of [...STRUCTURAL_OP_TYPES, ...WORKBOOK_OP_TYPES]) expect(edits.can(t as TableOpType), t).toBe(true);
	});

	it('a locked table can do nothing but unlock and show another sheet', () => {
		const { edits } = make({ locked: true });
		const allowed = [...STRUCTURAL_OP_TYPES, ...WORKBOOK_OP_TYPES].filter(t => edits.can(t as TableOpType));
		expect(allowed.sort()).toEqual(['set-active-sheet', 'toggle-lock']);
	});

	it('the source narrows what the user may do, and the policy narrows what the source accepts', () => {
		const xlsx = (t: TableOpType) => ['set-cell-content', 'set-col-name', 'merge-cells', 'unmerge-cells', 'set-active-sheet'].includes(t);
		expect(make({}, xlsx).edits.can('set-cell-content')).toBe(true);
		expect(make({}, xlsx).edits.can('set-sort')).toBe(false);
		expect(make({}, xlsx).edits.can('toggle-lock')).toBe(false);
		expect(make({ locked: true }, xlsx).edits.can('set-cell-content')).toBe(false);
		expect(make({ locked: true }, xlsx).edits.can('set-active-sheet')).toBe(true);
	});

	it('reading view cannot edit unless the setting allows it, and cannot lock either way', () => {
		expect(make({ surface: 'reading' }).edits.can('set-cell-content')).toBe(false);
		expect(make({ surface: 'reading', readingEdit: true }).edits.can('set-cell-content')).toBe(true);
		expect(make({ surface: 'reading', readingEdit: true }).edits.can('toggle-lock')).toBe(false);
	});

	it('run writes an operation the table can do and drops any other', () => {
		const { edits, written } = make({ locked: true });
		edits.run(op('set-cell-content'));
		edits.run(op('toggle-lock'));
		expect(written.map(o => o.type)).toEqual(['toggle-lock']);
	});

	it('canAny is true when one of the operations can be done', () => {
		const { edits } = make({ locked: true });
		expect(edits.canAny(['set-sort', 'toggle-lock'])).toBe(true);
		expect(edits.canAny(['set-sort', 'insert-row'])).toBe(false);
		expect(edits.canAny([])).toBe(false);
	});

	it('NO_EDITS can do nothing and writes nothing', () => {
		expect(NO_EDITS.can('toggle-lock')).toBe(false);
		expect(NO_EDITS.canAny(['set-active-sheet'])).toBe(false);
		NO_EDITS.run(op('toggle-lock'));
	});
});

describe('operation tables', () => {
	it('every operation has a class, and no operation is in both unions', () => {
		for (const t of STRUCTURAL_OP_TYPES) { expect(effectOfType(t as TableOpType), t).toBeTruthy(); expect(WORKBOOK_OP_TYPES.has(t), t).toBe(false); }
		for (const t of WORKBOOK_OP_TYPES) expect(effectOfType(t as TableOpType), t).toBeTruthy();
	});

	it('isWorkbookOp tells the two apart', () => {
		expect(isWorkbookOp({ type: 'create-sheet' })).toBe(true);
		expect(isWorkbookOp({ type: 'insert-row' })).toBe(false);
	});
});

describe('withEdits', () => {
	const entry = (label: string, emits?: TableOpType[]): CellOpEntry => ({ icon: 'x', label, emits, action: () => { /* unused */ } });
	const div: CellOpEntry = { divider: true };
	const labels = (list: CellOpEntry[]) => list.map(e => ('divider' in e ? '|' : e.label));

	it('keeps an entry that emits nothing (copying), and one whose operation can be done', () => {
		const { edits } = make({}, t => t !== 'delete-row');
		expect(labels(withEdits([entry('copy'), entry('hide', ['hide-row']), entry('delete', ['delete-row'])], edits))).toEqual(['copy', 'hide']);
	});

	it('keeps an entry that emits several when any of them can be done', () => {
		const { edits } = make({}, t => t === 'set-sort');
		expect(labels(withEdits([entry('both', ['reorder-rows', 'set-sort'])], edits))).toEqual(['both']);
	});

	it('drops the dividers of a group that was emptied: none leading, trailing or doubled', () => {
		const { edits } = make({}, t => t === 'hide-col');
		const list = [entry('a', ['hide-row']), div, entry('b', ['hide-col']), div, entry('c', ['delete-col']), div, entry('copy')];
		expect(labels(withEdits(list, edits))).toEqual(['b', '|', 'copy']);
		expect(labels(withEdits([div, entry('x'), div, div, entry('y'), div], edits))).toEqual(['x', '|', 'y']);
	});

	it('a locked table keeps only the entries that do not change it', () => {
		const { edits } = make({ locked: true });
		expect(labels(withEdits([entry('hide', ['hide-row']), div, entry('copy')], edits))).toEqual(['copy']);
	});
});
