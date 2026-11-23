import { parseSource, readBlock } from './parser';
import { CURRENT_TABLE_VERSION } from './tableVersion';
import { spliceBlock } from './blockSplice';
import { serializeTable, serializeWorkbook } from './serializer';
import { applyStructuralOpV2, STRUCTURAL_OP_TYPES, type StructuralOpV2 } from './operations';
import { applyWorkbookOp, isWorkbookOp, type WorkbookOpV2 } from './workbookOperations';
import type { SheetDefV2, TableModelV2, WorkbookV3 } from './model';
import { checkOpIds, targetTable } from './opCheck';

export { setYamlAdapter, type YamlAdapter } from './yamlAdapter';
export { readBlock, type BlockRead } from './parser';
export { CURRENT_TABLE_VERSION };
export { serializeTable, serializeWorkbook } from './serializer';
export type { StructuralOpV2, WorkbookOpV2, TableModelV2, WorkbookV3, SheetDefV2 };

export type RichTableOp = StructuralOpV2 | WorkbookOpV2;
export type RichTableDoc = TableModelV2 | WorkbookV3;

export const isWorkbook = (doc: RichTableDoc): doc is WorkbookV3 => 'sheets' in doc;

/**
 * Parses a block. Throws, rather than return a guess that a write would then
 * save over the block, when it was written by a newer version or is not a
 * table this version reads (such as the pre-1.0 format).
 */
export function parse(source: string): RichTableDoc {
	const read = readBlock(source);
	if (read.kind === 'too-new') throw new Error(`This block was written by a newer Rich Table (format ${read.version}; this one reads up to ${CURRENT_TABLE_VERSION})`);
	if (read.kind === 'empty') throw new Error('This block is empty: there is no table to read');
	if (read.kind === 'unreadable') throw new Error(read.yamlError ? `This block could not be read: ${read.yamlError}` : 'This block is not a table this version reads');
	return parseSource(source);
}

export function serialize(doc: RichTableDoc): string {
	return isWorkbook(doc) ? serializeWorkbook(doc) : serializeTable(doc);
}

/**
 * Applies one operation in place. A workbook op needs a workbook; any other op acts on a
 * table, or on the active sheet of a workbook (or the one named by `sheetId`). An unknown
 * operation type, or an id that is not in the table, throws before anything is changed.
 */
export function applyOp(doc: RichTableDoc, op: RichTableOp & { sheetId?: string }): void {
	if (isWorkbookOp(op)) {
		if (!isWorkbook(doc)) throw new Error(`"${op.type}" needs a multi-sheet table`);
		applyWorkbookOp(doc, op);
		return;
	}
	if (!STRUCTURAL_OP_TYPES.has(op.type)) throw new Error(`Unknown operation "${op.type}"`);
	const table = targetTable(doc, op.sheetId);
	if (!table) throw new Error('This workbook has no sheet to edit');
	const problems = checkOpIds(table, op);
	if (problems.length > 0) throw new Error(`"${op.type}" refused: ${problems.join('; ')}`);
	applyStructuralOpV2(table, op);
}

export interface RichTableBlock {
	/** 0-based line of the opening fence. */
	start: number;
	/** 0-based line of the closing fence. */
	end: number;
	/** The block's lines as they stand in the note, without the fences. `parse` takes the shared indent off. */
	source: string;
	/** The opening fence's indent (a block in a list item has one), which written lines must carry again. */
	indent: string;
}

/** Finds every ```rich-table fenced block in a note, in order. */
export function findBlocks(markdown: string): RichTableBlock[] {
	const lines = markdown.split('\n');
	const blocks: RichTableBlock[] = [];
	for (let i = 0; i < lines.length; i++) {
		const open = /^([ \t]*)(`{3,}|~{3,})\s*rich-table\s*$/.exec(lines[i] ?? '');
		if (!open) continue;
		const indent = open[1] ?? '';
		const fence = open[2] ?? '```';
		const close = lines.findIndex((l, j) => j > i && new RegExp(`^\\s*${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`).test(l));
		if (close < 0) break;
		blocks.push({ start: i, end: close, source: lines.slice(i + 1, close).join('\n'), indent });
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
	const doc = parse(block.source);
	for (const op of Array.isArray(ops) ? ops : [ops]) applyOp(doc, op);
	return spliceBlock(markdown, block.start, block.end, serialize(doc));
}
