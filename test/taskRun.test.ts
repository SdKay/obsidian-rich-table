import { describe, it, expect } from 'vitest';
import { parseTaskLine } from '../src/tasks/taskParse';
import { parseTaskQuery } from '../src/tasks/taskQuery';
import { runTaskQuery, dateRange, urgency, type LocatedTask } from '../src/tasks/taskRun';

// 2026-11-04 is a Wednesday.
const TODAY = '2026-11-04';

const task = (line: string, path = 'a.md', n = 0, heading: string | null = null, isSubItem = false): LocatedTask => {
	const t = parseTaskLine(line);
	if (!t) throw new Error(`not a task: ${line}`);
	return { ...t, path, line: n, heading, isSubItem };
};
const names = (src: LocatedTask[], q: string) => runTaskQuery(src, parseTaskQuery(q), TODAY).groups.flatMap(g => g.tasks.map(t => t.description));

describe('dateRange', () => {
	it('reads the relative words', () => {
		expect(dateRange({ kind: 'relative', word: 'today' }, TODAY)).toEqual([TODAY, TODAY]);
		expect(dateRange({ kind: 'relative', word: 'tomorrow' }, TODAY)).toEqual(['2026-11-05', '2026-11-05']);
		expect(dateRange({ kind: 'relative', word: 'yesterday' }, TODAY)).toEqual(['2026-11-03', '2026-11-03']);
	});
	it('starts the week on Monday', () => {
		expect(dateRange({ kind: 'span', unit: 'week', which: 'this' }, TODAY)).toEqual(['2026-11-02', '2026-11-08']);
		expect(dateRange({ kind: 'span', unit: 'week', which: 'next' }, TODAY)).toEqual(['2026-11-09', '2026-11-15']);
		expect(dateRange({ kind: 'span', unit: 'week', which: 'last' }, TODAY)).toEqual(['2026-10-26', '2026-11-01']);
	});
	it('does a Sunday as the last day of its week, not the first of the next', () => {
		expect(dateRange({ kind: 'span', unit: 'week', which: 'this' }, '2026-11-08')).toEqual(['2026-11-02', '2026-11-08']);
	});
	it('covers a month and a year, across year ends', () => {
		expect(dateRange({ kind: 'span', unit: 'month', which: 'this' }, TODAY)).toEqual(['2026-11-01', '2026-11-30']);
		expect(dateRange({ kind: 'span', unit: 'month', which: 'next' }, '2026-12-15')).toEqual(['2027-01-01', '2027-01-31']);
		expect(dateRange({ kind: 'span', unit: 'month', which: 'last' }, '2026-01-10')).toEqual(['2025-12-01', '2025-12-31']);
		expect(dateRange({ kind: 'span', unit: 'year', which: 'this' }, TODAY)).toEqual(['2026-01-01', '2026-12-31']);
	});
	it('puts next monday after today and last monday before it, even when today is a Monday', () => {
		expect(dateRange({ kind: 'weekday', day: 1, which: 'next' }, TODAY)).toEqual(['2026-11-09', '2026-11-09']);
		expect(dateRange({ kind: 'weekday', day: 1, which: 'last' }, TODAY)).toEqual(['2026-11-02', '2026-11-02']);
		expect(dateRange({ kind: 'weekday', day: 1, which: 'next' }, '2026-11-02')).toEqual(['2026-11-09', '2026-11-09']);
		expect(dateRange({ kind: 'weekday', day: 1, which: 'last' }, '2026-11-02')).toEqual(['2026-10-26', '2026-10-26']);
	});
});

describe('runTaskQuery filters', () => {
	const tasks = [
		task('- [ ] open ➕ 2026-01-01', 'proj/a.md', 0),
		task('- [x] finished ✅ 2026-02-01', 'proj/a.md', 1),
		task('- [-] dropped ❌ 2026-02-02', 'proj/a.md', 2),
		task('- [/] doing', 'proj/b.md', 0),
		task('- [ ] due soon 📅 2026-11-06', 'proj/b.md', 1),
		task('- [ ] due late 📅 2026-12-31 ⏫', 'Templates/t.md', 0),
		task('- [ ] asked #question #work/phone', 'tmp/x.md', 0),
		task('- [ ] asked too #question', 'n/y.md', 0),
	];

	it('not done keeps todo and in progress; done keeps done and cancelled', () => {
		// With no sort line Tasks orders by status type (in progress first), urgency, due date, priority, path.
		expect(names(tasks, 'not done')).toEqual(['doing', 'due soon', 'due late', 'asked too #question', 'open', 'asked #question #work/phone']);
		expect(names(tasks, 'done')).toEqual(['finished', 'dropped']);
	});

	it('the requested block returns what it says', () => {
		const q = `not done
tags include #question
path does not include Templates
path does not include tmp
group by folder
sort by created`;
		const r = runTaskQuery(tasks, parseTaskQuery(q), TODAY);
		expect(r.groups).toEqual([{ heading: 'n/', tasks: [expect.objectContaining({ description: 'asked too #question' })] }]);
		expect(r.total).toBe(1);
	});

	it('matches a tag without its hash and by level', () => {
		expect(names(tasks, 'tags include work')).toEqual(['asked #question #work/phone']);
		expect(names(tasks, 'tags include #WORK')).toEqual(['asked #question #work/phone']);
		expect(names(tasks, 'tags do not include #question')).not.toContain('asked too #question');
	});

	it('compares dates, with the ends included where the words say so', () => {
		expect(names(tasks, 'due before 2026-11-06')).toEqual([]);
		expect(names(tasks, 'due on or before 2026-11-06')).toEqual(['due soon']);
		expect(names(tasks, 'due after 2026-11-06')).toEqual(['due late']);
		expect(names(tasks, 'due on or after 2026-11-06')).toEqual(['due soon', 'due late']);
		expect(names(tasks, 'due 2026-11-06')).toEqual(['due soon']);
	});

	it('a task without the date is never matched by a date comparison, and no due date finds it', () => {
		expect(names(tasks, 'due before 2030-01-01')).toEqual(['due soon', 'due late']);
		expect(names(tasks, 'no due date')).toHaveLength(6);
		expect(names(tasks, 'has due date')).toEqual(['due soon', 'due late']);
	});

	it('this week and this month use today', () => {
		expect(names(tasks, 'due in this week')).toEqual(['due soon']);
		expect(names(tasks, 'due this month')).toEqual(['due soon']);
		expect(names(tasks, 'due in next month')).toEqual(['due late']);
		expect(names(tasks, 'due in last month')).toEqual([]);
	});

	it('priority above means more urgent', () => {
		expect(names(tasks, 'priority above none')).toEqual(['due late']);
		expect(names(tasks, 'priority is high')).toEqual(['due late']);
		expect(names(tasks, 'priority below none')).toEqual([]);
	});

	it('filters on path, folder and a regex', () => {
		expect(names(tasks, 'path includes templates')).toEqual(['due late']);
		expect(names(tasks, 'folder includes proj/')).toHaveLength(5);
		// A folder match is a substring, like every other text match: "tmp/" contains "mp/".
		expect(names(tasks, 'folder includes mp/')).toEqual(['asked #question #work/phone']);
		expect(names(tasks, 'description regex matches /^due (soon|late)$/')).toEqual(['due soon', 'due late']);
		expect(names(tasks, 'description regex does not match /^due/i').length).toBe(6);
	});

	it('leaves out sub-items on request', () => {
		const nested = [task('- [ ] parent', 'a.md', 0), task('  - [ ] child', 'a.md', 1, null, true)];
		expect(names(nested, 'exclude sub-items')).toEqual(['parent']);
		expect(names(nested, 'not done')).toEqual(['parent', 'child']);
	});
});

describe('the order Tasks gives with no sort line', () => {
	it('puts a task in progress before a todo before a done one', () => {
		const t = [task('- [x] done'), task('- [ ] todo'), task('- [/] doing'), task('- [-] dropped')];
		expect(names(t, '')).toEqual(['doing', 'todo', 'done', 'dropped']);
	});
	it('then the more urgent first: a late due date, then priority', () => {
		const t = [task('- [ ] plain'), task('- [ ] later 📅 2026-12-30'), task('- [ ] late 📅 2026-10-01'), task('- [ ] high ⏫')];
		expect(names(t, '')).toEqual(['late', 'high', 'later', 'plain']);
	});
	it('compares paths so that week 2 comes before week 10', () => {
		const t = [task('- [ ] a', '第10周.md'), task('- [ ] b', '第2周.md')];
		expect(names(t, '')).toEqual(['b', 'a']);
	});
});

describe('Tasks\' own numbers', () => {
	it('scores urgency the way Tasks does', () => {
		const at = (line: string) => urgency(parseTaskLine(line)!, TODAY);
		// due today: (14 * 0.8 / 21 + 0.2) * 12 = 8.8, plus the priority part 0.325 * 6 = 1.95
		expect(at('- [ ] x 📅 2026-11-04')).toBeCloseTo(8.8 + 1.95, 5);
		expect(at('- [ ] x')).toBeCloseTo(1.95, 5);
		expect(at('- [ ] x 📅 2026-10-01')).toBeCloseTo(12 + 1.95, 5);
		expect(at('- [ ] x 📅 2027-06-01')).toBeCloseTo(0.2 * 12 + 1.95, 5);
		expect(at('- [ ] x 🔺')).toBeCloseTo(9, 5);
		expect(at('- [ ] x ⏬')).toBeCloseTo(-1.8, 5);
		expect(at('- [ ] x ⏳ 2026-11-01')).toBeCloseTo(5 + 1.95, 5);
		expect(at('- [ ] x 🛫 2026-12-01')).toBeCloseTo(-3 + 1.95, 5);
	});
});

describe('a task with no start date', () => {
	const t = [task('- [ ] none'), task('- [ ] early 🛫 2026-01-01'), task('- [ ] later 🛫 2027-01-01')];
	it('counts as started: a filter on the start date keeps it, any other date drops it', () => {
		expect(names(t, 'start before 2026-06-01')).toEqual(['none', 'early']);
		expect(names(t, 'start after 2026-06-01')).toEqual(['none', 'later']);
		expect(names(t, 'due before 2030-01-01')).toEqual([]);
	});
});

describe('in or before / in or after', () => {
	const t = [task('- [ ] a 📅 2026-11-02'), task('- [ ] b 📅 2026-11-08'), task('- [ ] c 📅 2026-11-09')];
	it('reads like on or before / on or after, over a span', () => {
		expect(names(t, 'due in or before this week')).toEqual(['a', 'b']);
		expect(names(t, 'due in or after this week')).toEqual(['a', 'b', 'c']);
	});
});

describe('runTaskQuery sorting, grouping and limit', () => {
	const tasks = [
		task('- [ ] c ⏬ 📅 2026-03-01', 'b.md', 0),
		task('- [ ] a 🔺 📅 2026-01-01', 'b.md', 1),
		task('- [ ] b 📅 2026-02-01', 'a.md', 0),
		task('- [ ] none', 'a.md', 1),
	];

	it('sorts by priority with the most urgent first, and by due with undated last', () => {
		expect(names(tasks, 'sort by priority')).toEqual(['a', 'b', 'none', 'c']);
		expect(names(tasks, 'sort by due date')).toEqual(['a', 'b', 'c', 'none']);
	});

	it('reverse flips the order outright, so a task without the date comes first', () => {
		expect(names(tasks, 'sort by due reverse')).toEqual(['none', 'c', 'b', 'a']);
		expect(names(tasks, 'sort by description reverse')).toEqual(['none', 'c', 'b', 'a']);
	});

	it('breaks a tie with the next sort line, then with the five Tasks always adds', () => {
		const t = [task('- [ ] x', 'b.md', 0), task('- [ ] y', 'a.md', 5), task('- [ ] z', 'a.md', 2)];
		// All three tie on every default but path, which puts a.md before b.md; inside a.md nothing separates them
		// and the sort is stable, so the order they were given in decides.
		expect(names(t, 'sort by priority')).toEqual(['y', 'z', 'x']);
		expect(names(t, 'sort by priority\nsort by description reverse')).toEqual(['z', 'y', 'x']);
		expect(names(t, 'sort by priority\nsort by description')).toEqual(['x', 'y', 'z']);
	});

	it('groups and orders the groups by name', () => {
		const r = runTaskQuery(tasks, parseTaskQuery('group by filename'), TODAY);
		expect(r.groups.map(g => [g.heading, g.tasks.length])).toEqual([['a', 2], ['b', 2]]);
		const rr = runTaskQuery(tasks, parseTaskQuery('group by filename reverse'), TODAY);
		expect(rr.groups.map(g => g.heading)).toEqual(['b', 'a']);
	});

	it('a task with several tags is in each tag group', () => {
		const t = [task('- [ ] x #a #b'), task('- [ ] y')];
		const r = runTaskQuery(t, parseTaskQuery('group by tags'), TODAY);
		expect(r.groups.map(g => [g.heading, g.tasks.length])).toEqual([['#a', 1], ['#b', 1], ['(No tags)', 1]].sort((p, q) => String(p[0]).localeCompare(String(q[0]), undefined, { numeric: true })));
	});

	it('limits after sorting, and reports how many matched', () => {
		const r = runTaskQuery(tasks, parseTaskQuery('sort by due\nlimit 2'), TODAY);
		expect(r.groups[0]!.tasks.map(t => t.description)).toEqual(['a', 'b']);
		expect(r.total).toBe(4);
	});

	it('returns one unnamed group when nothing is grouped', () => {
		expect(runTaskQuery(tasks, parseTaskQuery(''), TODAY).groups).toHaveLength(1);
		expect(runTaskQuery([], parseTaskQuery('not done'), TODAY)).toEqual({ groups: [{ heading: '', tasks: [] }], total: 0 });
	});
});
