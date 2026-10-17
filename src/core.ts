import { parseSource } from './parser';
import { serializeTable, serializeWorkbook } from './serializer';
import { applyStructuralOpV2, STRUCTURAL_OP_TYPES, type StructuralOpV2 } from './operations';
import { applyWorkbookOp, type WorkbookOpV2 } from './workbookOperations';
import type { SheetDefV2, TableModelV2, WorkbookV3 } from './model';
import { checkOpIds, targetTable } from './opCheck';

export { setYamlAdapter, type YamlAdapter } from './yamlAdapter';
export { parseSource as parse } from './parser';
export { serializeTable, serializeWorkbook } from './serializer';
export type { StructuralOpV2, WorkbookOpV2, TableModelV2, WorkbookV3, SheetDefV2 };

export type RichTableOp = StructuralOpV2 | WorkbookOpV2;
export type RichTableDoc = TableModelV2 | WorkbookV3;

export const isWorkbook = (doc: RichTableDoc): doc is WorkbookV3 => 'sheets' in doc;

export function serialize(doc: RichTableDoc): string {
	return isWorkbook(doc) ? serializeWorkbook(doc) : serializeTable(doc);
}

const WORKBOOK_OPS: ReadonlySet<string> = new Set([
	'create-sheet', 'delete-sheet', 'rename-sheet', 'reorder-sheets', 'set-active-sheet', 'set-sheet-tab-style', 'set-sheet-content',
]);

/**
 * Applies one operation in place. A workbook op needs a workbook; any other op acts on a
 * table, or on the active sheet of a workbook (or the one named by `sheetId`). An unknown
 * operation type, or an id that is not in the table, throws before anything is changed.
 */
export function applyOp(doc: RichTableDoc, op: RichTableOp & { sheetId?: string }): void {
	if (WORKBOOK_OPS.has(op.type)) {
		if (!isWorkbook(doc)) throw new Error(`"${op.type}" needs a multi-sheet table`);
		applyWorkbookOp(doc, op as WorkbookOpV2);
		return;
	}
	if (!STRUCTURAL_OP_TYPES.has(op.type)) throw new Error(`Unknown operation "${op.type}"`);
	const table = targetTable(doc, op.sheetId);
	if (!table) throw new Error('This workbook has no sheet to edit');
	const problems = checkOpIds(table, op);
	if (problems.length > 0) throw new Error(`"${op.type}" refused: ${problems.join('; ')}`);
	applyStructuralOpV2(table, op as StructuralOpV2);
}

export interface RichTableBlock {
	/** 0-based line of the opening fence. */
	start: number;
	/** 0-based line of the closing fence. */
	end: number;
	/** The block's content, without the fences. */
	source: string;
}

/** Finds every ```rich-table fenced block in a note, in order. */
export function findBlocks(markdown: string): RichTableBlock[] {
	const lines = markdown.split('\n');
	const blocks: RichTableBlock[] = [];
	for (let i = 0; i < lines.length; i++) {
		const open = /^(\s*)(`{3,}|~{3,})\s*rich-table\s*$/.exec(lines[i] ?? '');
		if (!open) continue;
		const fence = open[2] ?? '```';
		const close = lines.findIndex((l, j) => j > i && new RegExp(`^\\s*${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`).test(l));
		if (close < 0) break;
		blocks.push({ start: i, end: close, source: lines.slice(i + 1, close).join('\n') });
		i = close;
	}
	return blocks;
}

/**
 * Applies `ops` to the `index`-th rich-table block of `markdown` and returns the whole
 * note with only that block rewritten. Everything outside the block is left untouched.
 */
export function editBlock(markdown: string, ops: RichTableOp | RichTableOp[], index = 0): string {
	const blocks = findBlocks(markdown);
	const block = blocks[index];
	if (!block) throw new Error(`No rich-table block #${index} (this note has ${blocks.length})`);
	const doc = parseSource(block.source);
	for (const op of Array.isArray(ops) ? ops : [ops]) applyOp(doc, op);
	const lines = markdown.split('\n');
	lines.splice(block.start + 1, block.end - block.start - 1, ...serialize(doc).trimEnd().split('\n'));
	return lines.join('\n');
}
