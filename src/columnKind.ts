/**
 * What a column is, and what it can be changed to, in the one row of the column menu that says so. For a table written
 * in the note that is the column's type (a date, a choice); for a tasks table it is the property of each task the column
 * shows. The table's kind decides the choices; the menu only draws them.
 */
import type { ColumnDefV2 } from './model';
import type { ChoiceRegistry } from './choiceRegistry';
import type { TableOp, TableOpType } from './tableEdits';
import { SPECIAL_TYPES } from './renderTypes';
import { t, typeLabel } from './i18n';

export interface KindChoice {
	label: string;
	/** The op that makes the column this. */
	op: TableOp;
	current: boolean;
}

export interface ColumnKinds {
	/** The row's own text: what the column is now. */
	label: string;
	/** Groups of choices, drawn with a divider between them. */
	groups: KindChoice[][];
	/** The op every choice emits, so the row is offered only when the table can carry it out. */
	emits: TableOpType;
}

/** A table written in the note: no type, a built-in type, or one of the choice types the vault defines. */
export function columnTypeKinds(col: ColumnDefV2, registry: ChoiceRegistry): ColumnKinds {
	const choice = (id: string | undefined, label: string): KindChoice => ({
		label, current: col.type === id, op: { type: 'set-col-type', colId: col.id, colType: id },
	});
	return {
		label: typeLabel(col.type),
		emits: 'set-col-type',
		groups: [
			[choice(undefined, t('noType'))],
			[...SPECIAL_TYPES].map(id => choice(id, id)),
			registry.getAllTypes().map(ct => choice(ct.id, ct.id)),
		],
	};
}
