import { describe, it, expect } from 'vitest';
import { parseSource, readBlock } from '../src/parser';
import { extractBlock } from '../src/blockExtract';

const BODY = 'version: 2\ncolumns:\n  - { id: c_a, name: A }\nrows:\n  - { id: r_a, cells: { c_a: "1" } }\n';
const SHEETS = 'sheets:\n  - id: s_a\n    columns:\n      - { id: c_a, name: A }\n    rows:\n      - { id: r_a, cells: { c_a: "1" } }\nversion: 3\n';

const columnsOf = (source: string) => {
	const doc = parseSource(source);
	return doc.version === 3 ? doc.sheets[0]?.columns.length : doc.columns.length;
};

describe('the --- delimiters are optional', () => {
	it.each([
		['both lines', `---\n${BODY}---\n`],
		['only the opening line', `---\n${BODY}`],
		['neither line', BODY],
	])('reads a block with %s', (_, source) => {
		expect(columnsOf(source)).toBe(1);
		expect(readBlock(source)).toMatchObject({ kind: 'table', version: 2 });
	});

	it('ignores what follows the closing line, as an older note with a pipe-table mirror has', () => {
		const source = `---\n${BODY}---\n\n| A |\n|---|\n| 1 |\n`;
		expect(columnsOf(source)).toBe(1);
	});

	it('takes the version from the YAML, not from a line that looks like a delimiter', () => {
		const source = `---\ntitle: |\n  above\n  ---\n  below\n${SHEETS}---\n`;
		expect(readBlock(source)).toMatchObject({ kind: 'table', version: 3 });
		expect(columnsOf(source)).toBe(1);
	});

	it('reads a block without delimiters whose cell holds an indented ---', () => {
		const source = 'columns:\n  - { id: c_a, name: A }\nrows:\n  - id: r_a\n    cells:\n      c_a: |\n        above\n        ---\n        below\nversion: 2\n';
		expect(readBlock(source)).toMatchObject({ kind: 'table', version: 2 });
		const doc = parseSource(source);
		expect(doc.version === 2 && doc.rows[0]?.cells['c_a']).toContain('below');
	});

	it('treats a missing version as 2', () => {
		expect(readBlock('columns:\n  - { id: c_a, name: A }\nrows: []\n')).toMatchObject({ kind: 'table', version: 2 });
	});

	it('reports a version newer than this build, from any position in the YAML', () => {
		expect(readBlock('columns: []\nrows: []\nversion: 99\n')).toEqual({ kind: 'too-new', version: 99 });
	});

	it('reports text that is not a table as unreadable rather than guessing', () => {
		for (const source of ['| a | b |\n|---|---|\n| 1 | 2 |\n', 'just words', '- a\n- b\n']) {
			expect(readBlock(source).kind).toBe('unreadable');
		}
	});

	it('search reads a block without delimiters', () => {
		const r = extractBlock(BODY);
		expect(r.ok && r.value.map(l => l.text)).toEqual(['A', '1']);
	});
});

describe('the pre-1.0 format is no longer read', () => {
	const PRE_1_0 = `---
columns:
  - { name: Task, width: 200 }
  - { name: Status, type: task-status }
styles:
  - { target: "1:1", bold: true }
---
| Task   | Status |
| ------ | ------ |
| Design | done   |`;

	it('reports a pipe table under YAML whose columns have no ids as unreadable', () => {
		expect(readBlock(PRE_1_0)).toEqual({ kind: 'unreadable' });
	});

	it('still reads a current table whose columns list is empty', () => {
		expect(readBlock('---\nversion: 2\ncolumns: []\nrows: []\n---\n')).toMatchObject({ kind: 'table' });
	});
});

describe('what a reader takes as lines and as a version', () => {
	const ROWS = 'columns:\n  - { id: c_a, name: A }\nrows:\n  - { id: r_a, cells: { c_a: "1" } }\n';

	it.each([
		['CRLF line breaks', `---\r\nversion: 2\r\n${ROWS.replace(/\n/g, '\r\n')}---\r\n`],
		['a byte-order mark', `﻿---\nversion: 2\n${ROWS}---\n`],
		['a byte-order mark and no delimiters', `﻿version: 2\n${ROWS}`],
		['an indented opening line', `  ---\nversion: 2\n${ROWS}---\n`],
		['blank lines before the opening line', `\n\n---\nversion: 2\n${ROWS}---\n`],
	])('reads a block with %s', (_, source) => {
		expect(readBlock(source)).toEqual({ kind: 'table', version: 2 });
		expect(columnsOf(source)).toBe(1);
	});

	it.each(['"2"', '0', '1', '-1', '2.5', '.inf', 'two', 'null'])('does not guess at version %s', v => {
		expect(readBlock(`version: ${v}\n${ROWS}`)).toEqual({ kind: 'unreadable' });
	});

	it('reports a too-new version before deciding whether the rest is a table', () => {
		expect(readBlock('version: 4\n')).toEqual({ kind: 'too-new', version: 4 });
	});

	it('takes rows that are not a list as not a table, rather than an empty one a write would keep', () => {
		expect(readBlock('version: 2\ncolumns:\n  - { id: c_a, name: A }\nrows: 5\n').kind).toBe('unreadable');
	});

	it('sees a block with only whitespace or a byte-order mark as empty, not unreadable', () => {
		for (const source of ['', '  \n\n', '﻿', '\r\n']) expect(readBlock(source)).toEqual({ kind: 'empty' });
	});
});

describe('whitespace, the byte-order mark and an empty sheets list', () => {
	const ROWS = 'columns:\n  - { id: c_a, name: A }\nrows:\n  - { id: r_a, cells: { c_a: "1" } }\n';

	it('takes only spaces and tabs as blank around the opening line', () => {
		expect(readBlock(`\t---\nversion: 2\n${ROWS}---\n`)).toEqual({ kind: 'table', version: 2 });
		// A no-break space is not blank, so the line is not an opening ---: the content is then two YAML documents.
		expect(readBlock(`\u00A0---\nversion: 2\n${ROWS}---\n`).kind).toBe('unreadable');
		expect(readBlock('\u00A0\n').kind).toBe('unreadable');
	});

	it('drops a byte-order mark before anything else', () => {
		expect(readBlock('\uFEFF')).toEqual({ kind: 'empty' });
		expect(readBlock(`\uFEFF\n---\nversion: 2\n${ROWS}---\n`)).toEqual({ kind: 'table', version: 2 });
	});

	it('takes a sheets list with no entry that has an id as not a workbook, so it is never written back as one', () => {
		expect(readBlock('version: 3\nsheets: []\n').kind).toBe('unreadable');
		expect(readBlock('version: 3\nsheets:\n  - { name: S }\n').kind).toBe('unreadable');
		expect(readBlock(`version: 3\nsheets:\n  - { id: s_a, ${'columns: [], rows: []'} }\n`)).toEqual({ kind: 'table', version: 3 });
	});
});
