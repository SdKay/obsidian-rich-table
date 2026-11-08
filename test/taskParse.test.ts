import { describe, it, expect } from 'vitest';
import { parseTaskLine, splitTaskLine, findTags, isDoneType } from '../src/tasks/taskParse';

describe('splitTaskLine', () => {
	it('reads the bullet kinds, indentation and quote prefixes', () => {
		expect(splitTaskLine('- [ ] a')).toMatchObject({ marker: '-', statusSymbol: ' ', body: 'a' });
		expect(splitTaskLine('  * [x] a')).toMatchObject({ indentation: '  ', marker: '*', statusSymbol: 'x' });
		expect(splitTaskLine('1. [/] a')).toMatchObject({ marker: '1.', statusSymbol: '/' });
		expect(splitTaskLine('> - [ ] a')).toMatchObject({ statusSymbol: ' ' });
	});
	it('is null for anything that is not a task', () => {
		expect(splitTaskLine('- plain list item')).toBeNull();
		expect(splitTaskLine('[ ] no bullet')).toBeNull();
		expect(splitTaskLine('-[ ] no space')).toBeNull();
		expect(splitTaskLine('')).toBeNull();
	});
});

describe('parseTaskLine', () => {
	it('is null for a line that is not a task', () => {
		expect(parseTaskLine('just text')).toBeNull();
	});

	it('takes the description and the dates out of the line', () => {
		const t = parseTaskLine('- [ ] write the report ➕ 2026-01-02 🛫 2026-01-03 ⏳ 2026-01-04 📅 2026-01-05')!;
		expect(t.description).toBe('write the report');
		expect(t).toMatchObject({ created: '2026-01-02', start: '2026-01-03', scheduled: '2026-01-04', due: '2026-01-05', done: null });
	});

	it('does not care in which order the fields are written', () => {
		const a = parseTaskLine('- [ ] x 📅 2026-01-05 ⏫ 🔁 every week')!;
		const b = parseTaskLine('- [ ] x 🔁 every week ⏫ 📅 2026-01-05')!;
		expect(a).toEqual(b);
		expect(a).toMatchObject({ description: 'x', due: '2026-01-05', priority: 1, recurrence: 'every week' });
	});

	it('accepts the alternative symbols for due and scheduled, and a variation selector', () => {
		expect(parseTaskLine('- [ ] x 📆 2026-02-01')!.due).toBe('2026-02-01');
		expect(parseTaskLine('- [ ] x 🗓️ 2026-02-01')!.due).toBe('2026-02-01');
		expect(parseTaskLine('- [ ] x ⌛ 2026-02-01')!.scheduled).toBe('2026-02-01');
	});

	it('numbers the priorities the way Tasks does: smaller is more urgent, 3 is none', () => {
		const p = (s: string) => parseTaskLine(`- [ ] x ${s}`)!.priority;
		expect([p('🔺'), p('⏫'), p('🔼'), p(''), p('🔽'), p('⏬')]).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it('leaves a symbol in the middle of the description alone', () => {
		const t = parseTaskLine('- [ ] pay 📅 2026-01-05 the rent soon')!;
		expect(t.due).toBeNull();
		expect(t.description).toBe('pay 📅 2026-01-05 the rent soon');
	});

	it('reads done and cancelled dates, ids and dependencies', () => {
		const t = parseTaskLine('- [x] x ✅ 2026-03-01 🆔 abc ⛔ d1,d2')!;
		expect(t).toMatchObject({ done: '2026-03-01', id: 'abc', dependsOn: ['d1', 'd2'], statusType: 'DONE' });
		expect(parseTaskLine('- [-] y ❌ 2026-03-02')!).toMatchObject({ cancelled: '2026-03-02', statusType: 'CANCELLED' });
	});

	it('knows what a status character means, and treats an unknown one as a todo', () => {
		expect(parseTaskLine('- [/] x')!).toMatchObject({ statusName: 'In Progress', statusType: 'IN_PROGRESS' });
		expect(parseTaskLine('- [?] x')!).toMatchObject({ statusName: 'Unknown', statusType: 'TODO' });
		// Not configured, but Tasks still reads these by their character.
		expect(parseTaskLine('- [X] x', [])!.statusType).toBe('DONE');
		expect(parseTaskLine('- [x] x', [])!.statusType).toBe('DONE');
		expect(parseTaskLine('- [/] x', [])!.statusType).toBe('IN_PROGRESS');
		expect(parseTaskLine('- [-] x', [])!.statusType).toBe('CANCELLED');
		expect(parseTaskLine('- [!] x', [])!.statusType).toBe('TODO');
		const custom = [{ symbol: '?', name: 'Question', type: 'TODO' as const }];
		expect(parseTaskLine('- [?] x', custom)!.statusName).toBe('Question');
	});

	it('finds the tags in the description', () => {
		const t = parseTaskLine('- [ ] call #work/phone and #question about it 📅 2026-01-05')!;
		expect(t.tags).toEqual(['#work/phone', '#question']);
		expect(t.description).toBe('call #work/phone and #question about it');
	});

	it('is stable when a line has no fields at all', () => {
		expect(parseTaskLine('- [ ] ')!.description).toBe('');
		expect(parseTaskLine('- [ ] plain')).toMatchObject({ description: 'plain', priority: 3, due: null, tags: [], dependsOn: [] });
	});
});

describe('a tag written after the fields', () => {
	it('does not hide the dates before it, and stays in the description', () => {
		const t = parseTaskLine('- [ ] 学习深入理解计算机操作系统 📅 2024-08-31 #project/learning/System')!;
		expect(t.due).toBe('2024-08-31');
		expect(t.description).toBe('学习深入理解计算机操作系统 #project/learning/System');
		expect(t.tags).toEqual(['#project/learning/System']);
	});
	it('reads fields on both sides of several trailing tags', () => {
		const t = parseTaskLine('- [ ] 一机一密烧录工具 ➕ 2026-04-24 #周报 #project/sdk_tools')!;
		expect(t.created).toBe('2026-04-24');
		expect(t.tags).toEqual(['#周报', '#project/sdk_tools']);
		const u = parseTaskLine('- [ ] dplus PM porting ➕ 2026-04-24 🛫 2026-04-24 📅 2026-05-01 #project/zephyr')!;
		expect(u).toMatchObject({ created: '2026-04-24', start: '2026-04-24', due: '2026-05-01', description: 'dplus PM porting #project/zephyr' });
	});
	it('reads a field before the tag and another after it', () => {
		const t = parseTaskLine('- [ ] x ➕ 2026-01-01 #a 📅 2026-02-02')!;
		expect(t).toMatchObject({ created: '2026-01-01', due: '2026-02-02', description: 'x #a' });
	});
});

describe('a block id', () => {
	it('is kept apart from the description and found behind the fields', () => {
		const t = parseTaskLine('- [ ] write 📅 2026-01-05 ^task-1')!;
		expect(t).toMatchObject({ description: 'write', due: '2026-01-05', blockId: 'task-1' });
	});
	it('is null when there is none', () => {
		expect(parseTaskLine('- [ ] write')!.blockId).toBeNull();
	});
});

describe('findTags', () => {
	it('ignores a hash inside a word, a bare hash and an anchor', () => {
		expect(findTags('C# and a#b and # and #1')).toEqual(['#1']);
		expect(findTags('(#a) #b,')).toEqual(['#b']);
	});
});

describe('isDoneType', () => {
	it('counts done, cancelled and non-task as done, like Tasks', () => {
		expect(['DONE', 'CANCELLED', 'NON_TASK'].map(t => isDoneType(t as never))).toEqual([true, true, true]);
		expect(['TODO', 'IN_PROGRESS', 'ON_HOLD'].map(t => isDoneType(t as never))).toEqual([false, false, false]);
	});
});
