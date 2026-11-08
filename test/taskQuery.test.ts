import { describe, it, expect } from 'vitest';
import { parseTaskQuery, parseDateSpec } from '../src/tasks/taskQuery';

describe('parseTaskQuery', () => {
	it('reads the block the feature was asked for', () => {
		const q = parseTaskQuery(`not done
tags include #question
path does not include Templates
path does not include tmp
group by folder
sort by created`);
		expect(q.errors).toEqual([]);
		expect(q.filters).toEqual([
			{ type: 'done', value: false },
			{ type: 'text', field: 'tag', includes: true, value: '#question', regex: null },
			{ type: 'text', field: 'path', includes: false, value: 'Templates', regex: null },
			{ type: 'text', field: 'path', includes: false, value: 'tmp', regex: null },
		]);
		expect(q.groups).toEqual([{ key: 'folder', reverse: false }]);
		expect(q.sorts).toEqual([{ key: 'created', reverse: false }]);
	});

	it('keeps the case of a value and ignores the case of the keywords', () => {
		const q = parseTaskQuery('Description INCLUDES Carla');
		expect(q.filters).toEqual([{ type: 'text', field: 'description', includes: true, value: 'Carla', regex: null }]);
	});

	it('reads the date lines in use', () => {
		const q = parseTaskQuery(`due on or after 2026-01-01
due on or before 2026-01-31
due before next monday
done 2026-05-02
created after 2026-02-01
due today
due in this week
due this month`);
		expect(q.errors).toEqual([]);
		expect(q.filters.map(f => f.type)).toEqual(['date', 'date', 'date', 'date', 'date', 'date', 'dateIn', 'dateIn']);
		expect(q.filters[2]).toMatchObject({ field: 'due', op: 'before', spec: { kind: 'weekday', day: 1, which: 'next' } });
		expect(q.filters[3]).toMatchObject({ field: 'done', op: 'on' });
	});

	it('reads a date written with dots, as notes do', () => {
		expect(parseDateSpec('2023.6.9')).toEqual({ kind: 'day', iso: '2023-06-09' });
	});

	it('reads has/no date, recurring, tags, priority and status lines', () => {
		const q = parseTaskQuery(`no due date
has start date
is recurring
no tags
priority is high
priority above none
status.type is IN_PROGRESS
exclude sub-items`);
		expect(q.errors).toEqual([]);
		expect(q.filters).toEqual([
			{ type: 'hasDate', field: 'due', value: false },
			{ type: 'hasDate', field: 'start', value: true },
			{ type: 'recurring', value: true },
			{ type: 'tags', value: false },
			{ type: 'priority', op: 'is', level: 1 },
			{ type: 'priority', op: 'above', level: 3 },
			{ type: 'statusType', is: true, value: 'IN_PROGRESS' },
			{ type: 'excludeSubItems' },
		]);
	});

	it('reads sort, group and limit with reverse', () => {
		const q = parseTaskQuery(`sort by priority
sort by due date
sort by description reverse
group by status.type
limit 30`);
		expect(q.errors).toEqual([]);
		expect(q.sorts).toEqual([
			{ key: 'priority', reverse: false },
			{ key: 'due', reverse: false },
			{ key: 'description', reverse: true },
		]);
		expect(q.groups).toEqual([{ key: 'status.type', reverse: false }]);
		expect(q.limit).toBe(30);
	});

	it('ignores the lines that only change how Tasks draws its list', () => {
		const q = parseTaskQuery(`hide due date
hide backlink
short mode
#hide backlink
explain`);
		expect(q.errors).toEqual([]);
		expect(q.filters).toEqual([]);
	});

	it('reads a regex and refuses a broken one', () => {
		const ok = parseTaskQuery('description regex matches /^pay\\b/i');
		expect(ok.errors).toEqual([]);
		expect(ok.filters[0]).toMatchObject({ type: 'text', includes: true });
		expect(parseTaskQuery('description regex matches /(/').errors).toHaveLength(1);
	});

	describe('what it does not understand is reported with its line, not skipped', () => {
		it('JavaScript expressions', () => {
			const q = parseTaskQuery('not done\nsort by function task.lineNumber');
			expect(q.errors).toEqual([{ line: 2, text: 'sort by function task.lineNumber', reason: 'JavaScript expressions are not supported' }]);
		});
		it('boolean groups', () => {
			expect(parseTaskQuery('(due today) OR (priority is high)').errors[0]?.reason).toMatch(/boolean/);
		});
		it('an unreadable date', () => {
			expect(parseTaskQuery('due before the end of days').errors[0]?.reason).toMatch(/cannot read the date/);
		});
		it('an unknown keyword', () => {
			expect(parseTaskQuery('frobnicate the tasks').errors).toEqual([{ line: 1, text: 'frobnicate the tasks', reason: 'not understood' }]);
		});
		it('an unknown sort or group key', () => {
			expect(parseTaskQuery('sort by colour').errors[0]?.reason).toMatch(/unknown sort key/);
			expect(parseTaskQuery('group by colour').errors[0]?.reason).toMatch(/unknown group key/);
		});
		it('a template placeholder that was never filled in', () => {
			expect(parseTaskQuery('due before {{date:YYYY-MM-DD}}').errors[0]?.reason).toMatch(/cannot read the date/);
		});
	});
});
