import { describe, it, expect } from 'vitest';
import { editPolicy, type PolicyInput } from '../src/editPolicy';
import { effectOf, effectOfWorkbook, type OpEffect } from '../src/opEffect';
import type { StructuralOpV2 } from '../src/operations';
import type { WorkbookOpV2 } from '../src/workbookOperations';

const base: PolicyInput = { surface: 'live', readingEdit: false, locked: false, legacy: false, empty: false };
const with_ = (p: Partial<PolicyInput>) => editPolicy({ ...base, ...p });
const EDITING: OpEffect[] = ['content', 'structure', 'look', 'derived'];

describe('editPolicy', () => {
	it('lets an unlocked table in live preview be changed in every way', () => {
		const p = with_({});
		for (const e of [...EDITING, 'state', 'navigate'] as OpEffect[]) expect(p.permits(e), e).toBe(true);
		expect(p.editable).toBe(true);
	});

	it('a locked table keeps no editing at all, not even the look; it can be unlocked and can show another sheet', () => {
		const p = with_({ locked: true });
		for (const e of EDITING) expect(p.permits(e), e).toBe(false);
		expect(p.permits('state')).toBe(true);
		expect(p.permits('navigate')).toBe(true);
		expect(p.editable).toBe(false);
	});

	describe('reading view', () => {
		it('cannot be edited unless the setting allows it, and cannot be locked or unlocked either way', () => {
			const off = with_({ surface: 'reading', readingEdit: false });
			for (const e of EDITING) expect(off.permits(e), e).toBe(false);
			expect(off.permits('state')).toBe(false);
			expect(off.permits('navigate')).toBe(true);
			const on = with_({ surface: 'reading', readingEdit: true });
			for (const e of EDITING) expect(on.permits(e), e).toBe(true);
			expect(on.permits('state')).toBe(false);
		});

		it('is still locked when the table is locked, whatever the setting says', () => {
			const p = with_({ surface: 'reading', readingEdit: true, locked: true });
			for (const e of EDITING) expect(p.permits(e), e).toBe(false);
		});
	});

	it('a table in an old format is only shown: no editing, no locking, no switching sheets', () => {
		const p = with_({ legacy: true });
		for (const e of [...EDITING, 'state', 'navigate'] as OpEffect[]) expect(p.permits(e), e).toBe(false);
	});

	it('a block with nothing in it has nothing to change or to open', () => {
		const p = with_({ empty: true });
		for (const e of [...EDITING, 'state', 'navigate'] as OpEffect[]) expect(p.permits(e), e).toBe(false);
	});

	it('the setting that allows editing in reading view does not touch live preview', () => {
		expect(with_({ readingEdit: true }).permits('content')).toBe(true);
		expect(with_({ readingEdit: false }).permits('content')).toBe(true);
	});
});

describe('which operations are which', () => {
	const op = (type: string) => ({ type } as unknown as StructuralOpV2);
	const wop = (type: string) => ({ type } as unknown as WorkbookOpV2);

	it('classes the operations the policy has to treat specially', () => {
		expect(effectOf(op('toggle-lock'))).toBe('state');
		expect(effectOfWorkbook(wop('set-active-sheet'))).toBe('navigate');
		expect(effectOf(op('set-cell-content'))).toBe('content');
		// A header is a cell with text in it.
		expect(effectOf(op('set-col-name'))).toBe('content');
		expect(effectOf(op('insert-row'))).toBe('structure');
		expect(effectOf(op('set-zoom'))).toBe('look');
		expect(effectOf(op('set-sort'))).toBe('derived');
	});

	it('what a locked table refuses is every operation except unlocking and showing another sheet', () => {
		const locked = with_({ locked: true });
		const structural = ['insert-row', 'set-cell-content', 'set-col-width', 'set-zoom', 'set-view-width', 'set-theme', 'set-sort', 'set-filter', 'toggle-collapse', 'set-freeze-rows'];
		for (const t of structural) expect(locked.permits(effectOf(op(t))), t).toBe(false);
		expect(locked.permits(effectOf(op('toggle-lock')))).toBe(true);
		expect(locked.permits(effectOfWorkbook(wop('set-active-sheet')))).toBe(true);
		for (const t of ['create-sheet', 'delete-sheet', 'rename-sheet', 'reorder-sheets', 'set-sheet-content', 'set-sheet-tab-style']) {
			expect(locked.permits(effectOfWorkbook(wop(t))), t).toBe(false);
		}
	});
});
