/**
 * extractFrontmatter (parser.ts) finds the closing "---" by scanning for the
 * first line that trims down to exactly that — which used to also match an
 * INDENTED "---" inside a cell's own block-scalar value (a nested rich-table
 * block's own delimiters, or just a plain Markdown horizontal rule typed into
 * a cell), truncating everything in the outer table after that point.
 */
import { describe, it, expect } from 'vitest';
import { parseTable } from '../src/parser';

describe('extractFrontmatter close-delimiter detection', () => {
	it('does not truncate a cell value containing a nested rich-table block (its own indented "---" lines)', () => {
		const source = `---
version: 2
columns:
  - { id: c_0, name: A }
rows:
  - id: r_0
    cells:
      c_0: |
        \`\`\`rich-table
        ---
        version: 2
        columns:
          - { id: c_0, name: X }
        rows:
          - { id: r_0, cells: { c_0: "1" } }
        ---
        \`\`\`
---
`;
		const model = parseTable(source);
		const cell = model.rows[0]?.cells['c_0'] ?? '';
		expect(cell).toContain('columns:');
		expect(cell).toContain('rows:');
		expect(cell).toContain('```rich-table');
	});

	it('does not truncate a cell value that is just a plain Markdown horizontal rule', () => {
		const source = `---
version: 2
columns:
  - { id: c_0, name: A }
  - { id: c_1, name: B }
rows:
  - id: r_0
    cells:
      c_0: |
        above
        ---
        below
      c_1: "after"
---
`;
		const model = parseTable(source);
		expect(model.rows[0]?.cells['c_0']).toContain('below');
		expect(model.rows[0]?.cells['c_1']).toBe('after');
	});

	it('still finds the real closing delimiter when it has trailing whitespace', () => {
		const source = '---\nversion: 2\ncolumns:\n  - { id: c_0, name: A }\nrows: []\n--- \n';
		const model = parseTable(source);
		expect(model.columns).toHaveLength(1);
	});
});
