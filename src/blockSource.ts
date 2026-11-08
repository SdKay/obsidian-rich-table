/**
 * Where a table block's rows come from when they are not the block's own: an .xlsx file, the tasks a query finds.
 * A block written in the note has no source; everything here is what a source changes about that ordinary path.
 * Each kind keeps its state and its rules in one object, and the block asks it rather than testing what it is.
 *
 * A source reaches the block only through `SourceHost`.
 */
import type { App } from 'obsidian';
import type { CtrlColScenario, TableModelV2, WorkbookV3 } from './model';
import type { StructuralOpV2 } from './operations';
import type { TableAction } from './renderTypes';
import type { TableOp, TableOpType } from './tableEdits';
import type { EmptyEntry } from './emptyEntries';

/** What a source may ask of the block that holds it. */
export interface SourceHost {
	readonly app: App;
	/** The note the block is in. */
	readonly sourcePath: string;
	/** Draws the block again in place, from the note and the source as they are now. Nothing is written. */
	rerender(): Promise<void>;
	/** Replaces the whole text of the block in the note. */
	writeBlock(text: string): Promise<void>;
	/** Sends an operation down the block's own write path (reducer, then the note). */
	queueCell(op: StructuralOpV2): Promise<void>;
	/** Runs `write` after every write already queued, so writes to the note and to a file never interleave. */
	chainWrite(write: () => Promise<void>): Promise<void>;
}

/** The block as parsed from the note: one table, or a workbook. */
export type Parsed = { model: TableModelV2; workbook: null } | { model: null; workbook: WorkbookV3 };

/**
 * What to draw. `parsed` is what the block's own write path reduces on and writes back; `drawn`, when given, is what
 * is shown instead (rows built from the vault), never written. `message` is shown in place of a table.
 */
export type Loaded =
	| { kind: 'table'; parsed: Parsed; drawn?: TableModelV2 }
	| { kind: 'message'; parsed: Parsed; render: (el: HTMLElement, can: (type: TableOpType) => boolean) => void };

/** One render's answers about the table, given what `load` returned. */
export interface BlockSource {
	/** Reads what the source holds. Throws on a source that cannot be read; the block shows the error. */
	load(parsed: Parsed): Promise<Loaded>;
	/** Whether the table is locked against editing, given what the note says. */
	locked(noteLocked: boolean): boolean;
	/** Which toolbar buttons the settings keep for this table. */
	scenario(locked: boolean): CtrlColScenario;
	/** Whether this kind of table takes an operation at all; the user's situation narrows it further. */
	accepts(type: TableOpType): boolean;
	/**
	 * An operation `accepts` allowed, before the block's own write path. `true`: the source carried it out (or
	 * dropped it). An op: send that one down the write path instead (a rewrite, or the op itself unchanged).
	 */
	route(op: TableOp): true | TableOp;
	/** The buttons this kind of table adds to the toolbar. `can` is what the user may do right now. */
	actions(can: (type: TableOpType) => boolean): TableAction[];
	/** Whether the block's own "export as .xlsx" fits this table. */
	readonly exportable: boolean;
	/** Lets go of anything held outside the block. */
	dispose(): void;
}

/** One kind of source: which blocks are of it, and how one is made. */
export interface SourceKind {
	/** Whether a block with these fields is of this kind. */
	matches(model: TableModelV2): boolean;
	create(host: SourceHost): BlockSource;
	/** The empty-block button that begins a table of this kind, if it has one. */
	entry?(host: SourceHost & EntryHost): EmptyEntry;
}

/** What beginning a table needs beyond the source's host. */
export interface EntryHost {
	/** The theme new tables get. */
	defaultTheme(): string | undefined;
}

/** The answers of a table written in the note, which a source changes only where it differs. */
export const NATIVE: Pick<BlockSource, 'locked' | 'scenario' | 'accepts'> = {
	locked: (noteLocked) => noteLocked,
	scenario: (locked) => locked ? 'locked' : 'unlocked',
	accepts: () => true,
};
