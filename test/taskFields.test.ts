import { describe, it, expect } from 'vitest';
import { parseTaskLine } from '../src/tasks/taskParse';
import type { LocatedTask } from '../src/tasks/taskRun';
import { fieldText, bodyOf, shownTags, TASK_FIELDS, DEFAULT_TASK_FIELDS, fieldById } from '../src/tasks/taskFields';

const at = (line: string, path = 'notes/Weekly/第15周.md', heading: string | null = 'Plan'): LocatedTask => {
	const t = parseTaskLine(line)!;
	return { ...t, path, line: 3, heading, isSubItem: false };
};

describe('fieldText', () => {
	const t = at('- [ ] write the report #work/phone ➕ 2026-01-02 🛫 2026-01-03 ⏳ 2026-01-04 📅 2026-01-05 ⏫ 🔁 every week');

	it('shows each property as the text a person reads', () => {
		expect(fieldText(t, 'body')).toBe('write the report');
		expect(fieldText(t, 'description')).toBe('write the report #work/phone');
		expect(fieldText(t, 'due')).toBe('2026-01-05');
		expect(fieldText(t, 'scheduled')).toBe('2026-01-04');
		expect(fieldText(t, 'start')).toBe('2026-01-03');
		expect(fieldText(t, 'created')).toBe('2026-01-02');
		expect(fieldText(t, 'done')).toBe('');
		expect(fieldText(t, 'priority')).toBe('⏫');
		expect(fieldText(t, 'tags')).toBe('#work/phone');
		expect(fieldText(t, 'recurrence')).toBe('every week');
		expect(fieldText(t, 'heading')).toBe('Plan');
	});

	it('names the file without its folder or extension, and the path in full', () => {
		expect(fieldText(t, 'file')).toBe('第15周');
		expect(fieldText(t, 'path')).toBe('notes/Weekly/第15周.md');
	});

	it('marks the status by its type, not by the character', () => {
		const m = (c: string) => fieldText(at(`- [${c}] x`), 'status');
		expect([m(' '), m('/'), m('x'), m('-'), m('?')]).toEqual(['☐', '◐', '☑', '☒', '☐']);
	});

	it('leaves a missing property empty, and an unknown field too', () => {
		const bare = at('- [ ] plain', 'a.md', null);
		for (const f of ['due', 'priority', 'tags', 'recurrence', 'heading']) expect(fieldText(bare, f)).toBe('');
		expect(fieldText(bare, 'nonsense')).toBe('');
	});
});

describe('the task body', () => {
	it('drops the tags wherever they stand and tidies the spaces', () => {
		expect(bodyOf(parseTaskLine('- [ ] #a call #b her #c')!)).toBe('call her');
	});
	it('keeps the rest of the text, links and marks included', () => {
		expect(bodyOf(parseTaskLine('- [ ] see [[Note]] and **this**')!)).toBe('see [[Note]] and **this**');
	});
});

describe('tags shown', () => {
	it('leaves out a colour left by a highlight, and keeps every tag a person typed', () => {
		expect(shownTags(['#00FFFF;', '#FF0000;', '#fff;', '#project/zephyr', '#2026', '#beef', '#fff'])).toEqual(['#project/zephyr', '#2026', '#beef', '#fff']);
	});
});

describe('the field list', () => {
	it('has a unique id for each field and a name for each, and the default columns are all known', () => {
		const ids = TASK_FIELDS.map(f => f.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const f of TASK_FIELDS) expect(f.label).not.toBe('');
		for (const id of DEFAULT_TASK_FIELDS) expect(fieldById(id)).toBeDefined();
		expect(DEFAULT_TASK_FIELDS).toEqual(['status', 'body', 'due', 'priority', 'tags', 'file']);
	});
	it('names the Tasks sort line each sortable field uses', () => {
		expect(fieldById('due')?.sort).toBe('due');
		expect(fieldById('body')?.sort).toBe('description');
		expect(fieldById('recurrence')?.sort).toBeUndefined();
	});
});
