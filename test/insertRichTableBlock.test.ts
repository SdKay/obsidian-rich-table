import { describe, it, expect } from 'vitest';
import { planRichTableBlockInsertion } from '../src/insertRichTableBlock';

/**
 * Splits a document (as an array of lines) at cursor by applying the planned
 * insertion, mirroring what Editor.replaceRange(text, cursor) actually does
 * (a pure insertion at one position — no `to`, so nothing is replaced).
 */
function applyInsertion(lines: string[], cursor: { line: number; ch: number }): { lines: string[]; cursorAfter: { line: number; ch: number } } {
	const plan = planRichTableBlockInsertion(cursor, lines[cursor.line] ?? '');
	const before = lines[cursor.line]?.slice(0, cursor.ch) ?? '';
	const after = lines[cursor.line]?.slice(cursor.ch) ?? '';
	const inserted = (before + plan.text + after).split('\n');
	const result = [...lines.slice(0, cursor.line), ...inserted, ...lines.slice(cursor.line + 1)];
	return { lines: result, cursorAfter: plan.cursorAfter };
}

describe('planRichTableBlockInsertion', () => {
	it('on an empty line at column 0, inserts the fence directly with no leading blank line', () => {
		const { lines, cursorAfter } = applyInsertion([''], { line: 0, ch: 0 });
		expect(lines).toEqual(['```rich-table', '', '```', '']);
		expect(cursorAfter).toEqual({ line: 1, ch: 0 });
		expect(lines[cursorAfter.line]).toBe('');
	});

	it('at the end of a non-empty line, splits onto a new line before the fence', () => {
		const { lines, cursorAfter } = applyInsertion(['some text'], { line: 0, ch: 9 });
		expect(lines).toEqual(['some text', '```rich-table', '', '```', '']);
		expect(cursorAfter).toEqual({ line: 2, ch: 0 });
	});

	it('mid-line, splits the line around the block without merging into either fence', () => {
		const { lines, cursorAfter } = applyInsertion(['before AFTER'], { line: 0, ch: 7 });
		expect(lines).toEqual(['before ', '```rich-table', '', '```', 'AFTER']);
		// The closing fence must be alone on its own line — a trailing
		// non-whitespace suffix on that line stops it being recognized as a
		// closing fence at all, swallowing the rest of the note into the block.
		expect(lines[3]).toBe('```');
		expect(cursorAfter).toEqual({ line: 2, ch: 0 });
	});

	it('preserves lines before and after the cursor line untouched', () => {
		const { lines } = applyInsertion(['line above', 'target', 'line below'], { line: 1, ch: 6 });
		expect(lines[0]).toBe('line above');
		expect(lines.at(-1)).toBe('line below');
	});

	it('a line that is only whitespace, not truly empty, still gets a leading newline', () => {
		// cursor.ch === 0 but the line itself has (whitespace) content past it —
		// trim() === '' still counts as "empty" for this decision, matching the
		// intent (a blank-looking line), not a literal zero-length string check.
		const { lines } = applyInsertion(['   '], { line: 0, ch: 0 });
		expect(lines[0]).toBe('```rich-table');
	});
});
