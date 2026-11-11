import { describe, it, expect } from 'vitest';
import { toggleTaskInCell } from '../src/cellTaskToggle';

describe('toggleTaskInCell', () => {
	it('ticks an open task and changes nothing else on its line', () => {
		expect(toggleTaskInCell('- [ ] write the report 📅 2026-12-01', 0)).toBe('- [x] write the report 📅 2026-12-01');
	});

	it('unticks a ticked task', () => {
		expect(toggleTaskInCell('- [x] done', 0)).toBe('- [ ] done');
	});

	it('counts task lines from the top and leaves the others as they are', () => {
		const text = '- [ ] a\n- [ ] b\n- [x] c';
		expect(toggleTaskInCell(text, 1)).toBe('- [ ] a\n- [x] b\n- [x] c');
		expect(toggleTaskInCell(text, 2)).toBe('- [ ] a\n- [ ] b\n- [ ] c');
	});

	it('does not count lines that are not tasks', () => {
		const text = 'intro\n- plain item\n- [ ] first\n[ ] not a list\n- [ ] second';
		expect(toggleTaskInCell(text, 1)).toBe('intro\n- plain item\n- [ ] first\n[ ] not a list\n- [x] second');
	});

	it('takes indented, starred and numbered tasks', () => {
		const text = '* [ ] a\n  - [ ] b\n1. [ ] c\n2) [ ] d';
		expect(toggleTaskInCell(text, 1)).toBe('* [ ] a\n  - [x] b\n1. [ ] c\n2) [ ] d');
		expect(toggleTaskInCell(text, 2)).toBe('* [ ] a\n  - [ ] b\n1. [x] c\n2) [ ] d');
		expect(toggleTaskInCell(text, 3)).toBe('* [ ] a\n  - [ ] b\n1. [ ] c\n2) [x] d');
	});

	it('skips what a code block holds, which renders no checkbox', () => {
		const text = '```\n- [ ] in code\n```\n- [ ] real';
		expect(toggleTaskInCell(text, 0)).toBe('```\n- [ ] in code\n```\n- [x] real');
	});

	it('ends a fence only on its own kind of fence', () => {
		const text = '~~~\n```\n- [ ] still code\n~~~\n- [ ] real';
		expect(toggleTaskInCell(text, 0)).toBe('~~~\n```\n- [ ] still code\n~~~\n- [x] real');
	});

	it('gives null when the cell has no such task', () => {
		expect(toggleTaskInCell('- [ ] a', 1)).toBeNull();
		expect(toggleTaskInCell('no tasks here', 0)).toBeNull();
		expect(toggleTaskInCell('', 0)).toBeNull();
	});

	it('takes any mark but a space as ticked, so a custom status goes back to open', () => {
		expect(toggleTaskInCell('- [/] half', 0)).toBe('- [ ] half');
		expect(toggleTaskInCell('- [-] dropped', 0)).toBe('- [ ] dropped');
	});

	it('keeps a text that has no trailing newline or has CRLF lines intact apart from the mark', () => {
		expect(toggleTaskInCell('- [ ] a\r\n- [ ] b', 1)).toBe('- [ ] a\r\n- [x] b');
	});
});
