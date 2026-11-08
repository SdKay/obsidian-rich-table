/**
 * Runs a parsed Tasks query over tasks. Pure: "today" is an argument, so a result depends on nothing but
 * its inputs.
 */
import type { ParsedTask } from './taskParse';
import { isDoneType } from './taskParse';
import type { DateField, DateOp, DateSpec, Filter, Group, GroupKey, Sort, SortKey, TaskQuery } from './taskQuery';

/** A parsed task and where it lives. */
export interface LocatedTask extends ParsedTask {
	path: string;
	/** 0-based line in the file. */
	line: number;
	/** The nearest heading above the task, or null. */
	heading: string | null;
	/** True when the task is nested under another task. */
	isSubItem: boolean;
}

export interface TaskGroup { heading: string; tasks: LocatedTask[] }

export interface QueryResult {
	/** Without groups this is one group with an empty heading. */
	groups: TaskGroup[];
	/** How many tasks matched before `limit`. */
	total: number;
}

// ── Dates: plain `YYYY-MM-DD` strings in local time, so they compare as strings ──────────────

const pad = (n: number) => String(n).padStart(2, '0');
export const toIso = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromIso = (iso: string): Date => {
	const [y, m, d] = iso.split('-').map(Number);
	if (y === undefined || m === undefined || d === undefined) throw new Error(`not a date: ${iso}`);
	return new Date(y, m - 1, d);
};
const addDays = (iso: string, n: number): string => { const d = fromIso(iso); d.setDate(d.getDate() + n); return toIso(d); };

/** The first day of the week is Monday, as in Tasks. */
const weekStart = (iso: string): string => { const d = fromIso(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return toIso(d); };

/** A date spec as an inclusive [from, to] range of days. */
export function dateRange(spec: DateSpec, today: string): [string, string] {
	switch (spec.kind) {
		case 'day': return [spec.iso, spec.iso];
		case 'relative': {
			const d = spec.word === 'today' ? today : addDays(today, spec.word === 'tomorrow' ? 1 : -1);
			return [d, d];
		}
		case 'weekday': {
			// "next monday" is the first one after today, "last monday" the latest one before it.
			const t = fromIso(today);
			let delta = spec.day - t.getDay();
			if (spec.which === 'next') { if (delta <= 0) delta += 7; } else if (delta >= 0) delta -= 7;
			const d = addDays(today, delta);
			return [d, d];
		}
		case 'span': {
			const shift = spec.which === 'this' ? 0 : spec.which === 'next' ? 1 : -1;
			if (spec.unit === 'week') {
				const s = addDays(weekStart(today), shift * 7);
				return [s, addDays(s, 6)];
			}
			const t = fromIso(today);
			if (spec.unit === 'month') {
				return [toIso(new Date(t.getFullYear(), t.getMonth() + shift, 1)), toIso(new Date(t.getFullYear(), t.getMonth() + shift + 1, 0))];
			}
			return [toIso(new Date(t.getFullYear() + shift, 0, 1)), toIso(new Date(t.getFullYear() + shift, 11, 31))];
		}
	}
}

function dateOf(t: ParsedTask, field: DateField | 'happens'): string | null {
	if (field !== 'happens') return t[field];
	// What Tasks calls happens: the earliest of start, scheduled and due.
	const all = [t.start, t.scheduled, t.due].filter((d): d is string => d !== null).sort();
	return all[0] ?? null;
}

/** A task with no start date counts as already started, so a date filter on `start` keeps it; every other date drops it. */
const MATCHES_WHEN_MISSING: ReadonlySet<string> = new Set(['start']);

function compareDate(value: string, op: DateOp, [from, to]: [string, string]): boolean {
	switch (op) {
		case 'before': return value < from;
		case 'after': return value > to;
		case 'on': return value >= from && value <= to;
		case 'onOrBefore': return value <= to;
		case 'onOrAfter': return value >= from;
	}
}

// ── Filters ─────────────────────────────────────────────────────────────────────────────

const folderOf = (path: string): string => { const i = path.lastIndexOf('/'); return i < 0 ? '/' : path.slice(0, i + 1); };
const filenameOf = (path: string): string => { const base = path.slice(path.lastIndexOf('/') + 1); return base.replace(/\.md$/i, ''); };

function textOf(t: LocatedTask, f: Extract<Filter, { type: 'text' }>): string[] {
	switch (f.field) {
		case 'description': return [t.description];
		case 'path': return [t.path.replace(/\.md$/i, '')];
		case 'filename': return [filenameOf(t.path)];
		case 'folder': return [folderOf(t.path)];
		case 'heading': return [t.heading ?? ''];
		case 'tag': return t.tags;
	}
}

function matchesPriority(p: number, op: 'is' | 'above' | 'below' | 'not', level: number): boolean {
	switch (op) {
		case 'is': return p === level;
		case 'not': return p !== level;
		// "above" means more urgent, and the more urgent is the smaller number.
		case 'above': return p < level;
		case 'below': return p > level;
	}
}

function matches(t: LocatedTask, f: Filter, today: string): boolean {
	switch (f.type) {
		case 'done': return isDoneType(t.statusType) === f.value;
		case 'recurring': return (t.recurrence !== null) === f.value;
		case 'tags': return (t.tags.length > 0) === f.value;
		case 'excludeSubItems': return !t.isSubItem;
		case 'hasDate': return (dateOf(t, f.field) !== null) === f.value;
		case 'date': {
			const v = dateOf(t, f.field);
			return v === null ? MATCHES_WHEN_MISSING.has(f.field) : compareDate(v, f.op, dateRange(f.spec, today));
		}
		case 'dateIn': {
			const v = dateOf(t, f.field);
			return v === null ? MATCHES_WHEN_MISSING.has(f.field) : compareDate(v, 'on', dateRange(f.spec, today));
		}
		case 'priority': return matchesPriority(t.priority, f.op, f.level);
		case 'statusType': return (t.statusType === f.value) === f.is;
		case 'statusName': return t.statusName.toLowerCase().includes(f.value.toLowerCase()) === f.includes;
		case 'text': {
			const hay = textOf(t, f);
			let hit: boolean;
			if (f.regex) hit = hay.some(h => f.regex!.test(h));
			else if (f.field === 'tag') {
				// A tag is compared without its hash and by prefix of its levels, so #work matches #work/phone.
				const want = f.value.replace(/^#/, '').toLowerCase();
				hit = hay.some(h => { const g = h.replace(/^#/, '').toLowerCase(); return g === want || g.startsWith(`${want}/`); });
			} else {
				const want = f.value.toLowerCase();
				hit = hay.some(h => h.toLowerCase().includes(want));
			}
			return hit === f.includes;
		}
	}
}

// ── Sorting and grouping ─────────────────────────────────────────────────────────────────

/** Tasks' order for the status types, which is not alphabetical. */
const STATUS_RANK: Record<string, number> = { IN_PROGRESS: 1, TODO: 2, ON_HOLD: 3, DONE: 4, CANCELLED: 5, NON_TASK: 6 };

const DAY = 86400000;
const dayNumber = (iso: string): number => Math.round(fromIso(iso).getTime() / DAY);

/** Tasks' urgency score, a weighted sum of how near the due date is, the priority and the scheduled and start dates. */
export function urgency(t: ParsedTask, today: string): number {
	let score = 0;
	if (t.due !== null) {
		const days = dayNumber(today) - dayNumber(t.due);
		const factor = days >= 7 ? 1 : days >= -14 ? ((days + 14) * 0.8) / 21 + 0.2 : 0.2;
		score += factor * 12;
	}
	if (t.scheduled !== null && today >= t.scheduled) score += 5;
	if (t.start !== null && today < t.start) score += -3;
	switch (t.priority) {
		case 0: score += 1.5 * 6; break;
		case 1: score += 1 * 6; break;
		case 2: score += 0.65 * 6; break;
		case 3: score += 0.325 * 6; break;
		case 5: score -= 0.3 * 6; break;
		default: break;
	}
	return score;
}

const cmpNum = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);
const cmpText = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });
/** A date that is there sorts before one that is not. */
const cmpDate = (a: string | null, b: string | null): number => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : cmpNum(dayNumber(a), dayNumber(b)));

type Comparator = (a: LocatedTask, b: LocatedTask) => number;

function comparatorFor(key: SortKey, today: string): Comparator {
	switch (key) {
		case 'priority': return (a, b) => cmpNum(a.priority, b.priority);
		case 'done': return (a, b) => cmpDate(a.done, b.done);
		case 'due': return (a, b) => cmpDate(a.due, b.due);
		case 'start': return (a, b) => cmpDate(a.start, b.start);
		case 'scheduled': return (a, b) => cmpDate(a.scheduled, b.scheduled);
		case 'created': return (a, b) => cmpDate(a.created, b.created);
		case 'happens': return (a, b) => cmpDate(dateOf(a, 'happens'), dateOf(b, 'happens'));
		case 'path': return (a, b) => cmpText(a.path, b.path);
		case 'filename': return (a, b) => cmpText(filenameOf(a.path), filenameOf(b.path));
		case 'description': return (a, b) => cmpText(a.description, b.description);
		case 'status': return (a, b) => cmpText(isDoneType(a.statusType) ? 'Done' : 'Todo', isDoneType(b.statusType) ? 'Done' : 'Todo') * -1;
		case 'status.name': return (a, b) => cmpText(a.statusName, b.statusName);
		case 'status.type': return (a, b) => cmpNum(STATUS_RANK[a.statusType] ?? 7, STATUS_RANK[b.statusType] ?? 7);
		case 'heading': return (a, b) => cmpText(a.heading ?? '', b.heading ?? '');
		case 'tag': return (a, b) => {
			if (a.tags.length === 0 && b.tags.length === 0) return 0;
			if (a.tags.length === 0) return 1;
			if (b.tags.length === 0) return -1;
			return cmpText(a.tags[0]!, b.tags[0]!);
		};
		case 'urgency': return (a, b) => cmpNum(urgency(b, today), urgency(a, today));
	}
}

/**
 * The query's sort lines come first, then the five Tasks always adds: status type, urgency (highest
 * first), due date, priority, path. A line's `reverse` flips its comparison outright, so a task without
 * the date goes first.
 */
function sortTasks(tasks: LocatedTask[], sorts: Sort[], today: string): LocatedTask[] {
	const chain: Comparator[] = [
		...sorts.map(s => { const c = comparatorFor(s.key, today); return s.reverse ? (a: LocatedTask, b: LocatedTask) => c(a, b) * -1 : c; }),
		comparatorFor('status.type', today), comparatorFor('urgency', today), comparatorFor('due', today), comparatorFor('priority', today), comparatorFor('path', today),
	];
	return [...tasks].sort((a, b) => {
		for (const c of chain) {
			const r = c(a, b);
			if (r !== 0) return r;
		}
		return 0;
	});
}

function groupKeys(t: LocatedTask, key: GroupKey, today: string): string[] {
	const date = (d: string | null) => [d ?? 'No ' + key + ' date'];
	switch (key) {
		case 'folder': return [folderOf(t.path)];
		case 'filename': return [filenameOf(t.path)];
		case 'path': return [t.path.replace(/\.md$/i, '')];
		case 'heading': return [t.heading ?? '(No heading)'];
		case 'status': return [isDoneType(t.statusType) ? 'Done' : 'Todo'];
		case 'status.name': return [t.statusName];
		case 'status.type': return [t.statusType];
		case 'priority': return [['Highest priority', 'High priority', 'Medium priority', 'No priority', 'Low priority', 'Lowest priority'][t.priority]!];
		case 'tags': return t.tags.length ? t.tags : ['(No tags)'];
		case 'due': case 'start': case 'scheduled': case 'created': case 'done': return date(t[key]);
		case 'happens': return date(dateOf(t, 'happens'));
		case 'recurring': return [t.recurrence ? 'Recurring' : 'Not Recurring'];
		case 'urgency': return [urgency(t, today).toFixed(2)];
	}
}

function groupTasks(tasks: LocatedTask[], groups: Group[], today: string): TaskGroup[] {
	if (groups.length === 0) return [{ heading: '', tasks }];
	// Several group lines nest; for a flat table they join into one heading, outermost first.
	const buckets = new Map<string, LocatedTask[]>();
	for (const t of tasks) {
		let heads = [''];
		for (const g of groups) heads = heads.flatMap(h => groupKeys(t, g.key, today).map(k => (h ? `${h} / ${k}` : k)));
		for (const h of heads) {
			const list = buckets.get(h) ?? [];
			list.push(t);
			buckets.set(h, list);
		}
	}
	const first = groups[0]!;
	return [...buckets.entries()]
		.sort(([a], [b]) => (first.reverse ? -1 : 1) * a.localeCompare(b, undefined, { numeric: true }))
		.map(([heading, list]) => ({ heading, tasks: list }));
}

/** Filters, sorts, groups and limits `tasks` as the query says. `today` is `YYYY-MM-DD`. */
export function runTaskQuery(tasks: readonly LocatedTask[], query: TaskQuery, today: string): QueryResult {
	const kept = tasks.filter(t => query.filters.every(f => matches(t, f, today)));
	const sorted = sortTasks(kept, query.sorts, today);
	const limited = query.limit === null ? sorted : sorted.slice(0, query.limit);
	return { groups: groupTasks(limited, query.groups, today), total: kept.length };
}
