/**
 * Tasks query text to conditions. A line this does not understand is reported, never skipped: a query
 * that silently ignores a line shows tasks the author meant to exclude.
 *
 * Supported is the part of the Tasks language that notes actually use (see the list in the README);
 * `filter by function`, boolean groups and presets are not, and say so.
 */
import type { StatusType } from './taskParse';

export type DateField = 'created' | 'start' | 'scheduled' | 'due' | 'done' | 'cancelled';
export type TextField = 'description' | 'path' | 'filename' | 'folder' | 'heading' | 'tag';
export type DateOp = 'before' | 'after' | 'on' | 'onOrBefore' | 'onOrAfter';

/** A date as written: a day, or a span (this week) whose ends are resolved when the query runs. */
export type DateSpec =
	| { kind: 'day'; iso: string }
	| { kind: 'relative'; word: 'today' | 'tomorrow' | 'yesterday' }
	| { kind: 'span'; unit: 'week' | 'month' | 'year'; which: 'this' | 'next' | 'last' }
	| { kind: 'weekday'; day: number; which: 'next' | 'last' };

export type Filter =
	| { type: 'done'; value: boolean }
	| { type: 'recurring'; value: boolean }
	| { type: 'hasDate'; field: DateField | 'happens'; value: boolean }
	| { type: 'date'; field: DateField | 'happens'; op: DateOp; spec: DateSpec }
	| { type: 'dateIn'; field: DateField | 'happens'; spec: DateSpec & { kind: 'span' } }
	| { type: 'text'; field: TextField; includes: boolean; value: string; regex: RegExp | null }
	| { type: 'tags'; value: boolean }
	| { type: 'priority'; op: 'is' | 'above' | 'below' | 'not'; level: number }
	| { type: 'statusType'; is: boolean; value: StatusType }
	| { type: 'statusName'; includes: boolean; value: string }
	| { type: 'excludeSubItems' };

export type SortKey = 'priority' | 'done' | 'due' | 'start' | 'scheduled' | 'created' | 'happens' | 'path' | 'filename' | 'description' | 'status' | 'status.name' | 'status.type' | 'heading' | 'tag' | 'urgency';
export type GroupKey = 'folder' | 'filename' | 'path' | 'heading' | 'status' | 'status.name' | 'status.type' | 'priority' | 'tags' | 'due' | 'start' | 'scheduled' | 'created' | 'done' | 'happens' | 'recurring' | 'urgency';

export interface Sort { key: SortKey; reverse: boolean }
export interface Group { key: GroupKey; reverse: boolean }

export interface TaskQuery {
	filters: Filter[];
	sorts: Sort[];
	groups: Group[];
	limit: number | null;
	/** One entry per line that was not understood. */
	errors: QueryError[];
}

export interface QueryError { line: number; text: string; reason: string }

const DATE_FIELDS = ['created', 'start', 'scheduled', 'due', 'done', 'cancelled', 'happens'] as const;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Lines that only change how Tasks draws its list; a table chooses its own columns. */
const DISPLAY_ONLY = /^(hide|show)\b|^short mode$|^full mode$|^explain$|^ignore global query$|^#/i;

export function parseDateSpec(text: string): DateSpec | null {
	const t = text.trim().toLowerCase();
	if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return { kind: 'day', iso: t };
	// Written with dots or slashes, as some notes do: 2023.6.9
	const loose = /^(\d{4})[./](\d{1,2})[./](\d{1,2})$/.exec(t);
	if (loose) return { kind: 'day', iso: `${loose[1]}-${loose[2]!.padStart(2, '0')}-${loose[3]!.padStart(2, '0')}` };
	if (t === 'today' || t === 'tomorrow' || t === 'yesterday') return { kind: 'relative', word: t };
	const span = /^(this|next|last) (week|month|year)$/.exec(t);
	if (span) return { kind: 'span', which: span[1] as 'this', unit: span[2] as 'week' };
	const wd = /^(next|last) (\w+)$/.exec(t);
	if (wd) {
		const day = WEEKDAYS.indexOf(wd[2]!);
		if (day >= 0) return { kind: 'weekday', which: wd[1] as 'next', day };
	}
	return null;
}

const DATE_LINE = new RegExp(`^(${DATE_FIELDS.join('|')}) (?:((?:on|in) or before|(?:on|in) or after|before|after|on|in) )?(.+)$`);

const TEXT_LINE = /^(description|path|filename|folder|heading|tags?) (does not include|do not include|includes?|regex matches|regex does not match) (.+)$/i;

/** The field name and operator are case-insensitive; the value keeps the case it was written in. */
function textFilter(line: string): Filter | null {
	const m = TEXT_LINE.exec(line);
	if (!m) return null;
	const name = m[1]!.toLowerCase();
	const field = (name === 'tags' ? 'tag' : name) as TextField;
	const op = m[2]!.toLowerCase();
	const value = m[3]!.trim();
	let regex: RegExp | null = null;
	if (op.startsWith('regex')) {
		const lit = /^\/(.*)\/([a-z]*)$/.exec(value);
		if (!lit) return null;
		try { regex = new RegExp(lit[1]!, lit[2]); } catch { return null; }
	}
	const includes = op === 'includes' || op === 'include' || op === 'regex matches';
	return { type: 'text', field, includes, value, regex };
}

const SORT_KEYS: readonly string[] = ['priority', 'done', 'due', 'due date', 'start', 'scheduled', 'created', 'happens', 'path', 'filename', 'description', 'status', 'status.name', 'status.type', 'heading', 'tag', 'urgency'];
const GROUP_KEYS: readonly string[] = ['folder', 'filename', 'path', 'heading', 'status', 'status.name', 'status.type', 'priority', 'tags', 'due', 'start', 'scheduled', 'created', 'done', 'happens', 'recurring', 'urgency'];

export function parseTaskQuery(source: string): TaskQuery {
	const q: TaskQuery = { filters: [], sorts: [], groups: [], limit: null, errors: [] };
	const fail = (line: number, text: string, reason: string) => { q.errors.push({ line, text, reason }); };

	source.split('\n').forEach((raw, i) => {
		// A trailing backslash continues the next line in Tasks; nothing in practice uses it, so say so.
		const text = raw.trim().replace(/\s+/g, ' ');
		const lower = text.toLowerCase();
		const n = i + 1;
		if (!text || DISPLAY_ONLY.test(text)) return;

		if (lower === 'done') return void q.filters.push({ type: 'done', value: true });
		if (lower === 'not done') return void q.filters.push({ type: 'done', value: false });
		if (lower === 'is recurring') return void q.filters.push({ type: 'recurring', value: true });
		if (lower === 'is not recurring') return void q.filters.push({ type: 'recurring', value: false });
		if (lower === 'has tags') return void q.filters.push({ type: 'tags', value: true });
		if (lower === 'no tags') return void q.filters.push({ type: 'tags', value: false });
		if (lower === 'exclude sub-items') return void q.filters.push({ type: 'excludeSubItems' });

		const has = /^(has|no) (created|start|scheduled|due|done|cancelled|happens) date$/.exec(lower);
		if (has) return void q.filters.push({ type: 'hasDate', field: has[2] as DateField, value: has[1] === 'has' });

		if (/^(filter|sort|group) by function\b/.test(lower)) return fail(n, text, 'JavaScript expressions are not supported');

		const lim = /^limit (?:to )?(\d+)(?: tasks?)?$/.exec(lower);
		if (lim) { q.limit = Number(lim[1]); return; }

		const sort = /^sort by ([a-z. ]+?)( reverse)?$/.exec(lower);
		if (sort) {
			const key = sort[1] === 'due date' ? 'due' : sort[1]!;
			if (SORT_KEYS.includes(key)) return void q.sorts.push({ key: key as SortKey, reverse: !!sort[2] });
			return fail(n, text, `unknown sort key "${sort[1]}"`);
		}
		const group = /^group by ([a-z. ]+?)( reverse)?$/.exec(lower);
		if (group) {
			if (GROUP_KEYS.includes(group[1]!)) return void q.groups.push({ key: group[1] as GroupKey, reverse: !!group[2] });
			return fail(n, text, `unknown group key "${group[1]}"`);
		}

		const pri = /^priority (is|is not|above|below|not) (highest|high|medium|none|low|lowest)$/.exec(lower);
		if (pri) {
			const level = ({ highest: 0, high: 1, medium: 2, none: 3, low: 4, lowest: 5 } as Record<string, number>)[pri[2]!]!;
			const op = pri[1] === 'is not' || pri[1] === 'not' ? 'not' : pri[1] as 'is' | 'above' | 'below';
			return void q.filters.push({ type: 'priority', op, level });
		}

		const st = /^status\.type (is|is not) (todo|in_progress|done|cancelled|on_hold|non_task)$/.exec(lower);
		if (st) return void q.filters.push({ type: 'statusType', is: st[1] === 'is', value: st[2]!.toUpperCase() as StatusType });
		const sn = /^status\.name (includes|does not include) (.+)$/.exec(lower);
		if (sn) return void q.filters.push({ type: 'statusName', includes: sn[1] === 'includes', value: sn[2]! });

		if (/\b(AND|OR|NOT|XOR)\b/.test(text) && /^\(/.test(text)) return fail(n, text, 'boolean groups are not supported');

		const d = DATE_LINE.exec(lower);
		if (d) {
			const field = d[1] as DateField | 'happens';
			const op = d[2] ?? 'on';
			const spec = parseDateSpec(d[3]!);
			if (!spec) return fail(n, text, `cannot read the date "${d[3]}"`);
			if (op === 'in') {
				if (spec.kind !== 'span') return fail(n, text, `"in" needs this/next/last week, month or year`);
				return void q.filters.push({ type: 'dateIn', field, spec });
			}
			// "due in this week" parses as op "in"; "due this week" is the same thing.
			if (op === 'on' && spec.kind === 'span') return void q.filters.push({ type: 'dateIn', field, spec });
			const map: Record<string, DateOp> = { before: 'before', after: 'after', on: 'on', 'on or before': 'onOrBefore', 'in or before': 'onOrBefore', 'on or after': 'onOrAfter', 'in or after': 'onOrAfter' };
			return void q.filters.push({ type: 'date', field, op: map[op]!, spec });
		}

		const tf = textFilter(text);
		if (tf) return void q.filters.push(tf);

		fail(n, text, 'not understood');
	});
	return q;
}
