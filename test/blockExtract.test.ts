import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parse as parseDoc, stringify as stringifyDoc } from 'yaml';
import { setYamlAdapter } from '../src/yamlAdapter';
import { parseYaml, stringifyYaml } from 'obsidian';
import { extractBlock, isBlockAnchor, BLOCK_EXTRACT_VERSION, BLOCK_LANGUAGES } from '../src/blockExtract';

// Dates stay text, as in the plugin and the command-line tool.
beforeAll(() => setYamlAdapter({ parse: s => parseDoc(s, { schema: 'core' }), stringify: v => stringifyDoc(v, { lineWidth: 0 }) }));
afterAll(() => setYamlAdapter({ parse: parseYaml, stringify: stringifyYaml }));

const lines = (source: string) => {
	const r = extractBlock(source);
	if (!r.ok) throw new Error('expected ok, got: ' + r.error);
	return r.value;
};
const texts = (source: string) => lines(source).map(l => l.text);

const TABLE = `---
version: 2
title: Roadmap
columns:
  - id: c_a
    name: Task
    width: 120
  - id: c_b
    name: Owner
    type: person
    align: right
rows:
  - id: r_1
    cells:
      c_a: Write tests
      c_b: amy
  - id: r_2
    cells:
      c_a: Ship it
      c_b: bob
styles:
  - target: r_1.c_a
    bg: '#ffeeaa'
    bold: true
merges: []
footer: Draft only
theme: grid
freezeRows: 0
viewWidth: 640
---
`;

describe('extractBlock: what is returned', () => {
	it('returns the title, column names, cells and footer in reading order', () => {
		expect(texts(TABLE)).toEqual(['Roadmap', 'Task', 'Owner', 'Write tests', 'amy', 'Ship it', 'bob', 'Draft only']);
	});

	it('returns no id, style key, colour or other field of the block', () => {
		const all = texts(TABLE).join('\n');
		for (const structure of ['c_a', 'r_1', 'version', 'width', '#ffeeaa', 'bold', 'grid', 'target', 'person', 'right', 'freezeRows', '640']) {
			expect(all, structure).not.toContain(structure);
		}
	});

	it('gives a cell a spreadsheet coordinate (header row 1) and a stable-id anchor', () => {
		const cell = lines(TABLE).find(l => l.text === 'bob');
		expect(cell).toEqual({ text: 'bob', location: 'B3', anchor: { kind: 'cell', rowId: 'r_2', colId: 'c_b' } });
	});

	it('gives a column name, the title and the footer their own anchors', () => {
		const byText = (t: string) => lines(TABLE).find(l => l.text === t);
		expect(byText('Owner')).toEqual({ text: 'Owner', location: 'B1', anchor: { kind: 'header', colId: 'c_b' } });
		expect(byText('Roadmap')).toEqual({ text: 'Roadmap', location: 'title', anchor: { kind: 'title' } });
		expect(byText('Draft only')).toEqual({ text: 'Draft only', location: 'footer', anchor: { kind: 'footer', line: 0 } });
	});

	it('is deterministic and JSON-serialisable', () => {
		expect(extractBlock(TABLE)).toEqual(extractBlock(TABLE));
		const found = lines(TABLE);
		expect(JSON.parse(JSON.stringify(found))).toEqual(found);
	});

	it('declares the block language and a numeric version', () => {
		expect(BLOCK_LANGUAGES).toEqual(['rich-table']);
		expect(typeof BLOCK_EXTRACT_VERSION).toBe('number');
	});
});

describe('extractBlock: what a reader sees', () => {
	const withRows = (extra: string, rows: string, cols = '  - { id: c_a, name: A }\n  - { id: c_b, name: B }') =>
		`---\nversion: 2\ncolumns:\n${cols}\nrows:\n${rows}\n${extra}---\n`;

	it('reports hidden columns, hidden rows and rows a filter hides, as decided', () => {
		const src = `---
version: 2
columns:
  - { id: c_a, name: A, filter: ["keep"] }
  - { id: c_b, name: Secret, hidden: true }
rows:
  - { id: r_1, cells: { c_a: keep, c_b: shown-hidden-col } }
  - { id: r_2, hidden: true, cells: { c_a: keep, c_b: x } }
  - { id: r_3, cells: { c_a: drop, c_b: y } }
---
`;
		expect(texts(src)).toEqual(['A', 'Secret', 'keep', 'shown-hidden-col', 'keep', 'x', 'drop', 'y']);
	});

	it('reports the stored value of a typed column, not a label', () => {
		const src = withRows('', '  - { id: r_1, cells: { c_a: done, c_b: "3" } }', '  - { id: c_a, name: Status, type: task-status }\n  - { id: c_b, name: N }');
		expect(texts(src)).toEqual(['Status', 'N', 'done', '3']);
	});

	it('reports the computed value of a formula cell, which is what the table shows', () => {
		const src = `---
version: 2
columns:
  - { id: c_a, name: X }
  - { id: c_b, name: Sum }
rows:
  - id: r_1
    cells: { c_a: "4", c_b: "" }
    formulas: { c_b: "=r_1.c_a+1" }
---
`;
		const found = texts(src);
		expect(found).toContain('5');
		expect(found.join('|')).not.toContain('=r_1');
	});

	it('reports a formula error as the table shows it', () => {
		const src = `---
version: 2
columns:
  - { id: c_a, name: X }
  - { id: c_b, name: Bad }
rows:
  - id: r_1
    cells: { c_a: "4", c_b: "" }
    formulas: { c_b: "=r_1.c_a/0" }
---
`;
		expect(texts(src)).toContain('#DIV/0!');
	});

	it('keeps a date as written and a multi-line cell as one line', () => {
		const src = withRows('', '  - id: r_1\n    cells:\n      c_a: 2026-07-17\n      c_b: |-\n        first\n        second', '  - { id: c_a, name: When, type: date }\n  - { id: c_b, name: Note }');
		expect(texts(src)).toEqual(['When', 'Note', '2026-07-17', 'first\nsecond']);
	});

	it('skips empty cells and a column with an empty name', () => {
		const src = withRows('', '  - { id: r_1, cells: { c_a: x } }', '  - { id: c_a, name: "" }\n  - { id: c_b, name: B }');
		expect(texts(src)).toEqual(['B', 'x']);
	});

	it('does not report a cell covered by a merge, which has no text of its own', () => {
		const src = withRows('merges:\n  - { anchor: r_1.c_a, end: r_2.c_a }\n', '  - { id: r_1, cells: { c_a: tall } }\n  - { id: r_2, cells: { c_a: "" } }', '  - { id: c_a, name: A }');
		expect(texts(src)).toEqual(['A', 'tall']);
	});

	it('splits a footer into lines, whether it is a list or one string', () => {
		expect(texts(withRows('footer:\n  - one\n  - two\n', '  - { id: r_1, cells: {} }', '  - { id: c_a, name: A }'))).toEqual(['A', 'one', 'two']);
		expect(texts(withRows('footer: "x\\ny"\n', '  - { id: r_1, cells: {} }', '  - { id: c_a, name: A }'))).toEqual(['A', 'x', 'y']);
	});

	it('uses the stored order of rows for a coordinate, however the table is sorted', () => {
		const src = withRows('sort: { colId: c_a, dir: desc }\n', '  - { id: r_1, cells: { c_a: first } }\n  - { id: r_2, cells: { c_a: second } }', '  - { id: c_a, name: A }');
		expect(lines(src).find(l => l.text === 'first')?.location).toBe('A2');
		expect(lines(src).find(l => l.text === 'second')?.location).toBe('A3');
	});
});

describe('extractBlock: a workbook', () => {
	const BOOK = `---
version: 3
title: Not shown
active_sheet: s_2
sheets:
  - id: s_1
    name: Budget
    title: Q1
    columns: [ { id: c_a, name: Item } ]
    rows: [ { id: r_1, cells: { c_a: rent } } ]
    footer: sheet footer
  - id: s_2
    name: Team Two
    columns: [ { id: c_a, name: Name } ]
    rows: [ { id: r_1, cells: { c_a: amy } } ]
    xlsxSource: { path: ignored.xlsx }
  - id: s_3
    columns: [ { id: c_a, name: Name } ]
    rows: [ { id: r_1, cells: { c_a: carl } } ]
---
`;
	it('reports each sheet\'s name, title, cells and footer, and not the workbook\'s own title', () => {
		expect(texts(BOOK)).toEqual(['Budget', 'Q1', 'Item', 'rent', 'sheet footer', 'Team Two', 'Name', 'amy', 'Name', 'carl']);
	});

	it('puts the sheet name in front of a coordinate, quoting it when it has a space', () => {
		const found = lines(BOOK);
		expect(found.find(l => l.text === 'rent')?.location).toBe('Budget!A2');
		expect(found.find(l => l.text === 'amy')?.location).toBe("'Team Two'!A2");
	});

	it('names an unnamed sheet by its position, as the tabs do not, and keeps the sheet in the anchor', () => {
		const carl = lines(BOOK).find(l => l.text === 'carl');
		expect(carl).toEqual({ text: 'carl', location: 'Sheet3!A2', anchor: { kind: 'cell', sheetId: 's_3', rowId: 'r_1', colId: 'c_a' } });
	});

	it('gives two sheets\' footers and titles different anchors', () => {
		const anchors = lines(BOOK).filter(l => l.location.endsWith('footer') || l.location.endsWith('title')).map(l => l.anchor);
		expect(anchors).toEqual([{ kind: 'title', sheetId: 's_1' }, { kind: 'footer', sheetId: 's_1', line: 0 }]);
	});

	it('still reads a sheet that carries an xlsxSource, which the renderer ignores inside a workbook', () => {
		expect(texts(BOOK)).toContain('amy');
	});

	it('marks the sheet name line with the sheet id', () => {
		expect(lines(BOOK)[0]).toEqual({ text: 'Budget', location: 'sheet', anchor: { kind: 'sheet', sheetId: 's_1' } });
	});
});

describe('extractBlock: blocks that are not read', () => {
	it('a block that points at a file gives no lines, as that file is searched on its own', () => {
		expect(extractBlock('---\nversion: 2\nxlsxSource:\n  path: data/budget.xlsx\n---\n')).toEqual({ ok: true, value: [] });
	});

	it('also when the block still holds old rows of its own, which the renderer replaces with the file\'s', () => {
		const src = '---\nversion: 2\ntitle: Kept title\ncolumns:\n  - { id: c_a, name: Stale }\nrows:\n  - { id: r_1, cells: { c_a: stale text } }\nxlsxSource:\n  path: data/budget.xlsx\n---\n';
		expect(extractBlock(src)).toEqual({ ok: true, value: [] });
	});

	it('an empty block gives no lines', () => {
		expect(extractBlock('')).toEqual({ ok: true, value: [] });
		expect(extractBlock('  \n\n')).toEqual({ ok: true, value: [] });
	});

	it('broken YAML is an error, so Rich Search searches the source instead', () => {
		const r = extractBlock('---\nversion: 2\ncolumns: [oops\n---\n');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/could not be read/i);
	});

	it('a table written by a newer Rich Table is an error, since the renderer shows a banner instead of it', () => {
		const r = extractBlock('---\nversion: 99\ncolumns:\n  - { id: c_a, name: A }\nrows: []\n---\n');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/newer/i);
	});

	it('an old v1 table is an error, not a guess', () => {
		const r = extractBlock('| a | b |\n|---|---|\n| 1 | 2 |\n');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/old format/i);
	});

	it('never throws, whatever it is given', () => {
		for (const bad of ['---\n', '---\n---\n', '\u0000\u0001', '---\nversion: 2\ncolumns: 5\nrows: x\n---\n']) {
			expect(() => extractBlock(bad)).not.toThrow();
		}
	});
});

describe('isBlockAnchor', () => {
	it('accepts every anchor extractBlock produces', () => {
		const book = '---\nversion: 3\ntitle: t\nsheets:\n  - id: s_1\n    name: A\n    title: T\n    columns: [ { id: c_a, name: X } ]\n    rows: [ { id: r_1, cells: { c_a: v } } ]\n    footer: f\n---\n';
		for (const src of [TABLE, book]) for (const line of lines(src)) expect(isBlockAnchor(line.anchor), JSON.stringify(line.anchor)).toBe(true);
	});

	it('accepts each kind in its minimal form', () => {
		for (const a of [{ kind: 'title' }, { kind: 'footer', line: 0 }, { kind: 'sheet', sheetId: 's' }, { kind: 'header', colId: 'c' }, { kind: 'cell', rowId: 'r', colId: 'c' }]) {
			expect(isBlockAnchor(a), JSON.stringify(a)).toBe(true);
		}
	});

	it('refuses what is not an object or has an unknown kind', () => {
		for (const a of [null, undefined, 0, 'cell', [], {}, { kind: 'nope' }, { kind: 5 }]) expect(isBlockAnchor(a), JSON.stringify(a)).toBe(false);
	});

	it('refuses a kind with a missing or mistyped field', () => {
		for (const a of [
			{ kind: 'footer' }, { kind: 'footer', line: -1 }, { kind: 'footer', line: 1.5 }, { kind: 'footer', line: '0' },
			{ kind: 'sheet' }, { kind: 'sheet', sheetId: 3 },
			{ kind: 'header' }, { kind: 'header', colId: 3 },
			{ kind: 'cell', rowId: 'r' }, { kind: 'cell', colId: 'c' }, { kind: 'cell', rowId: 1, colId: 'c' }, { kind: 'cell', rowId: 'r', colId: 2 },
		]) expect(isBlockAnchor(a), JSON.stringify(a)).toBe(false);
	});

	it('refuses a sheet id that is present but not a string, on any kind', () => {
		for (const a of [{ kind: 'title', sheetId: 1 }, { kind: 'cell', rowId: 'r', colId: 'c', sheetId: {} }, { kind: 'footer', line: 0, sheetId: false }]) {
			expect(isBlockAnchor(a), JSON.stringify(a)).toBe(false);
		}
	});
});
