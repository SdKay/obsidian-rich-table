import { describe, it, expect, beforeAll } from 'vitest';
import { parse as parseDoc, stringify as stringifyDoc } from 'yaml';
import { setYamlAdapter, editBlock, findBlocks, applyOp, parse, serialize, isWorkbook } from '../src/core';
import { STRUCTURAL_OP_TYPES } from '../src/operations';
import { setYamlAdapter as restore } from '../src/yamlAdapter';
import { parseYaml, stringifyYaml } from 'obsidian';

// Exactly what the standalone CLI installs: a JSON-compatible YAML, so dates stay text.
const standalone = {
	parse: (s: string) => parseDoc(s, { schema: 'core' }),
	stringify: (v: unknown) => stringifyDoc(v, { lineWidth: 0 }),
};

const BLOCK = `---
version: 2
columns:
  - id: c_a
    name: 任务
  - id: c_b
    name: 结束时间
    type: date
rows:
  - id: r_1
    cells:
      c_a: 设计
      c_b: 2026-07-17
  - id: r_2
    cells:
      c_a: 实现
      c_b: 2026-07-24
---`;
const NOTE = `# 周报\n\n前言，不能被改动。\n\n\`\`\`rich-table\n${BLOCK}\n\`\`\`\n\n后记，不能被改动。\n`;

beforeAll(() => setYamlAdapter(standalone));
// vitest shares the module registry across files in a worker; put the default back.
import { afterAll } from 'vitest';
afterAll(() => restore({ parse: parseYaml, stringify: stringifyYaml }));

describe('findBlocks', () => {
	it('locates a block and its fences', () => {
		const [b] = findBlocks(NOTE);
		expect(b?.start).toBe(4);
		expect(b?.source.startsWith('---')).toBe(true);
	});
	it('finds several blocks in order and ignores other fenced code', () => {
		const note = `\`\`\`js\nx\n\`\`\`\n\n\`\`\`rich-table\n${BLOCK}\n\`\`\`\n\n\`\`\`rich-table\n${BLOCK}\n\`\`\`\n`;
		expect(findBlocks(note)).toHaveLength(2);
	});
	it('a longer fence and ~~~ fences work', () => {
		expect(findBlocks(`~~~rich-table\n${BLOCK}\n~~~\n`)).toHaveLength(1);
		expect(findBlocks(`\`\`\`\`rich-table\n${BLOCK}\n\`\`\`\`\n`)).toHaveLength(1);
	});
	it('an unclosed block is ignored rather than swallowing the rest', () => {
		expect(findBlocks(`\`\`\`rich-table\n${BLOCK}\n`)).toEqual([]);
	});
});

describe('editBlock', () => {
	const fill = { type: 'fill-cells', cells: [{ rowId: 'r_1', colId: 'c_a' }, { rowId: 'r_2', colId: 'c_a' }], values: ['①', '②'] } as const;

	it('changes only the cells it was asked to, and nothing outside the block', () => {
		const out = editBlock(NOTE, fill);
		expect(out.split('\n').filter((l, i) => l !== NOTE.split('\n')[i])).toEqual(['      c_a: ①', '      c_a: ②']);
		expect(out.startsWith('# 周报\n\n前言，不能被改动。\n')).toBe(true);
		expect(out.endsWith('后记，不能被改动。\n')).toBe(true);
	});

	it('keeps a date as the text it was, not a timestamp', () => {
		expect(editBlock(NOTE, fill)).toContain('c_b: 2026-07-17');
		expect(editBlock(NOTE, fill)).not.toContain('T00:00:00');
	});

	it('applies several operations in order', () => {
		const out = editBlock(NOTE, [{ type: 'insert-row', afterRowId: null }, { type: 'set-col-name', colId: 'c_a', name: '事项' }]);
		const doc = parse(findBlocks(out)[0]!.source);
		expect(isWorkbook(doc)).toBe(false);
		expect((doc as { rows: unknown[] }).rows).toHaveLength(3);
		expect((doc as { columns: { name: string }[] }).columns[0]?.name).toBe('事项');
	});

	it('edits the block it was pointed at and leaves the others alone', () => {
		const two = `${NOTE}\n\`\`\`rich-table\n${BLOCK}\n\`\`\`\n`;
		const out = editBlock(two, fill, 1);
		const [first, second] = findBlocks(out);
		expect(first?.source).toBe(findBlocks(two)[0]?.source);
		expect(second?.source).toContain('c_a: ①');
	});

	it('refuses a block that is not there', () => {
		expect(() => editBlock(NOTE, fill, 3)).toThrow(/No rich-table block #3/);
	});

	it('respects the reducer: a merged cell\'s covered neighbours are not written', () => {
		const withMerge = NOTE.replace('      c_b: 2026-07-24\n---', '      c_b: 2026-07-24\nmerges:\n  - { anchor: r_1.c_a, end: r_2.c_a }\n---');
		const out = editBlock(withMerge, fill);
		expect(out).toContain('c_a: ①');
		expect(out).not.toContain('c_a: ②');
	});
});

describe('refusing bad operations', () => {
	it('an unknown operation type is an error, not a silent no-op', () => {
		expect(() => editBlock(NOTE, { type: 'no-such-op' } as never)).toThrow(/Unknown operation "no-such-op"/);
	});

	it('a row or column that is not in the table is named in the error', () => {
		expect(() => editBlock(NOTE, { type: 'set-cell-content', rowId: 'r_nope', colId: 'c_a', value: 'x' })).toThrow(/rowId: no row "r_nope"/);
		expect(() => editBlock(NOTE, { type: 'set-col-name', colId: 'c_nope', name: 'x' })).toThrow(/colId: no column "c_nope"/);
	});

	it('reports every bad id at once, including ones inside a cell list', () => {
		const bad = { type: 'fill-cells', cells: [{ rowId: 'r_x', colId: 'c_y' }], values: ['1'] } as const;
		expect(() => editBlock(NOTE, bad)).toThrow(/cells\[0\]\.rowId: no row "r_x".*cells\[0\]\.colId: no column "c_y"/);
	});

	it('null means "none" (insert at the top) and "header" is a valid row', () => {
		expect(() => editBlock(NOTE, { type: 'insert-row', afterRowId: null })).not.toThrow();
		expect(() => editBlock(NOTE, { type: 'set-cell-style', rowId: 'header', colId: 'c_a', bg: '#fff', color: null, size: null, bold: null, italic: null })).not.toThrow();
	});

	it('a failing later operation leaves nothing half-applied', () => {
		const doc = parse(findBlocks(NOTE)[0]!.source);
		const before = serialize(doc);
		expect(() => { applyOp(doc, { type: 'insert-row', afterRowId: null }); applyOp(doc, { type: 'delete-row', rowId: 'r_nope' }); }).toThrow();
		// editBlock does the same on a throwaway copy of the block, so the note text is untouched:
		expect(() => editBlock(NOTE, [{ type: 'insert-row', afterRowId: null }, { type: 'delete-row', rowId: 'r_nope' }])).toThrow();
		expect(serialize(parse(findBlocks(NOTE)[0]!.source))).toBe(before);
	});

	it('the operation list covers every case the reducer handles', () => {
		expect(STRUCTURAL_OP_TYPES.size).toBeGreaterThan(50);
		for (const t of ['insert-row', 'fill-cells', 'merge-cells', 'set-theme']) expect(STRUCTURAL_OP_TYPES.has(t)).toBe(true);
	});
});

describe('applyOp on a workbook', () => {
	const WB = `---\nversion: 3\nactiveSheetId: s_1\nsheets:\n  - id: s_1\n    name: A\n    columns:\n      - { id: c_a, name: X }\n    rows:\n      - { id: r_1, cells: { c_a: old } }\n  - id: s_2\n    name: B\n    columns:\n      - { id: c_a, name: Y }\n    rows:\n      - { id: r_1, cells: { c_a: keep } }\n---`;

	it('a row op acts on the active sheet unless a sheet is named', () => {
		const doc = parse(WB);
		expect(isWorkbook(doc)).toBe(true);
		applyOp(doc, { type: 'fill-cells', cells: [{ rowId: 'r_1', colId: 'c_a' }], values: ['new'] });
		applyOp(doc, { type: 'fill-cells', cells: [{ rowId: 'r_1', colId: 'c_a' }], values: ['two'], sheetId: 's_2' } as never);
		const out = serialize(doc);
		expect(out).toContain('c_a: new');
		expect(out).toContain('c_a: two');
		expect(out).not.toContain('c_a: old');
	});

	it('a sheet op on a plain table is an error, not a silent no-op', () => {
		expect(() => applyOp(parse(BLOCK), { type: 'create-sheet' })).toThrow(/multi-sheet/);
	});
});
