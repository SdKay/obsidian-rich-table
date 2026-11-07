/**
 * What a rendered table may change, and the one way to change it. Every control asks `can` about the operation it
 * would emit and is drawn only when the answer is yes, so a table offers exactly what it accepts: a locked table
 * offers no editing, a table backed by an .xlsx file offers what the file can take. `run` asks the same question
 * again and drops a refused operation, so a control that forgot to ask still changes nothing.
 *
 * Two answers make one: what the table's source accepts (a property of the kind of table), and what the user may
 * do right now (editPolicy.ts: the surface, the lock, the format).
 */
import type { StructuralOpV2 } from './operations';
import type { WorkbookOpV2 } from './workbookOperations';
import { effectOfType, type OpEffect } from './opEffect';

export type TableOp = StructuralOpV2 | WorkbookOpV2;
export type TableOpType = TableOp['type'];

export interface TableEdits {
	can: (type: TableOpType) => boolean;
	/** Whether at least one of these can be done: a control that emits several is drawn when any of them can. */
	canAny: (types: readonly TableOpType[]) => boolean;
	/** Carries out an operation `can` allows; any other is dropped. */
	run: (op: TableOp) => void;
}

export function tableEdits(
	accepts: (type: TableOpType) => boolean,
	permits: (effect: OpEffect) => boolean,
	write: (op: TableOp) => void,
): TableEdits {
	const can = (type: TableOpType) => accepts(type) && permits(effectOfType(type));
	return {
		can,
		canAny: types => types.some(can),
		run: op => { if (can(op.type)) write(op); },
	};
}

/** A table nothing can change: a preview, or a view with no write-back. */
export const NO_EDITS: TableEdits = { can: () => false, canAny: () => false, run: () => { /* nothing to change */ } };
