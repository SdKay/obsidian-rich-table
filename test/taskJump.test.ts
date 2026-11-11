import { describe, it, expect } from 'vitest';
import { jumpTo } from '../src/tasks/taskJump';

// A task row opens the note it came from, at the task's line. Where it opens (this tab or a new one) is the modifier
// keys' business, as for any link.
describe('jumpTo', () => {
	it('opens the note by its path, from the note the table is in, at the task’s line', () => {
		expect(jumpTo({ path: 'proj/a.md', line: 7 }, 'notes/today.md', false)).toEqual({
			linktext: 'proj/a.md',
			sourcePath: 'notes/today.md',
			where: false,
			state: { eState: { line: 7 } },
		});
	});

	it('keeps where the modifier keys ask for', () => {
		expect(jumpTo({ path: 'a.md', line: 0 }, 'x.md', 'tab').where).toBe('tab');
		expect(jumpTo({ path: 'a.md', line: 0 }, 'x.md', 'split').where).toBe('split');
	});

	it('passes the line as it is, 0 included: Obsidian ignores a 0, and a note opens at its top anyway', () => {
		expect(jumpTo({ path: 'a.md', line: 0 }, 'x.md', false).state).toEqual({ eState: { line: 0 } });
	});
});
