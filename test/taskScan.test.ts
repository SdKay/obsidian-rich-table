import { describe, it, expect } from 'vitest';
import { scanTasks, TaskIndex } from '../src/tasks/taskScan';

const scan = (text: string) => scanTasks('a.md', text);

describe('scanTasks', () => {
	it('finds the tasks with their line, in order', () => {
		const t = scan('intro\n- [ ] one\n- [x] two\ntext\n- [/] three');
		expect(t.map(x => [x.line, x.description])).toEqual([[1, 'one'], [2, 'two'], [4, 'three']]);
		expect(t.every(x => x.path === 'a.md')).toBe(true);
	});

	it('records the heading above each task, and none before the first heading', () => {
		const t = scan('- [ ] a\n# One\n- [ ] b\n## Two ##\n- [ ] c');
		expect(t.map(x => x.heading)).toEqual([null, 'One', 'Two']);
	});

	it('skips what is inside a code block, whichever fence opens it', () => {
		const t = scan('```md\n- [ ] in code\n```\n- [ ] real\n~~~\n- [ ] in tilde\n~~~\n- [ ] also real');
		expect(t.map(x => x.description)).toEqual(['real', 'also real']);
	});

	it('does not close a backtick fence with a tilde one', () => {
		expect(scan('```\n~~~\n- [ ] still code\n```\n- [ ] out').map(x => x.description)).toEqual(['out']);
	});

	it('skips the front-matter', () => {
		expect(scan('---\ntitle: x\n- [ ] not a task\n---\n- [ ] real').map(x => x.description)).toEqual(['real']);
	});

	it('treats a rule on the first line that never closes as text, not as front-matter', () => {
		expect(scan('---\n- [ ] a task').map(x => x.description)).toEqual(['a task']);
	});

	it('marks a task nested under another list item as a sub-item', () => {
		const t = scan('- [ ] parent\n  - [ ] child\n    - [ ] grandchild\n- [ ] next parent');
		expect(t.map(x => x.isSubItem)).toEqual([false, true, true, false]);
	});

	it('counts a task under a plain list item as a sub-item too', () => {
		const t = scan('- plain\n  - [ ] under it\n- [ ] top');
		expect(t.map(x => x.isSubItem)).toEqual([true, false]);
	});

	it('starts again after a heading', () => {
		const t = scan('- [ ] a\n  - [ ] b\n# H\n  - [ ] c');
		expect(t.map(x => x.isSubItem)).toEqual([false, true, false]);
	});

	it('reads tasks in a quote, and a tab as one level', () => {
		const t = scan('> - [ ] quoted\n- [ ] top\n\t- [ ] tabbed');
		expect(t.map(x => [x.description, x.isSubItem])).toEqual([['quoted', false], ['top', false], ['tabbed', true]]);
	});

	it('is empty for text with no tasks', () => {
		expect(scan('')).toEqual([]);
		expect(scan('- not a task\n[ ] no bullet')).toEqual([]);
	});
});

describe('TaskIndex', () => {
	const tasks = (path: string, n: number) => scanTasks(path, Array.from({ length: n }, (_, i) => `- [ ] ${path} ${i}`).join('\n'));

	it('lists every note in path order, and counts the tasks', () => {
		const ix = new TaskIndex();
		ix.set('b.md', tasks('b.md', 2));
		ix.set('a.md', tasks('a.md', 1));
		expect(ix.all().map(t => t.path)).toEqual(['a.md', 'b.md', 'b.md']);
		expect(ix.size).toBe(3);
	});

	it('replaces a note on change, and forgets one that has no tasks left', () => {
		const ix = new TaskIndex();
		ix.set('a.md', tasks('a.md', 3));
		ix.set('a.md', tasks('a.md', 1));
		expect(ix.size).toBe(1);
		ix.set('a.md', []);
		expect(ix.size).toBe(0);
	});

	it('follows a rename and a delete', () => {
		const ix = new TaskIndex();
		ix.set('a.md', tasks('a.md', 2));
		ix.rename('a.md', 'dir/b.md');
		expect(ix.all().map(t => t.path)).toEqual(['dir/b.md', 'dir/b.md']);
		ix.delete('dir/b.md');
		expect(ix.size).toBe(0);
		ix.rename('missing.md', 'x.md');
		expect(ix.size).toBe(0);
	});
});
