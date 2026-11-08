/**
 * One markdown task line to a task. Pure, no Obsidian import, so the query engine and the CLI can use it.
 *
 * The format is the Tasks plugin's emoji format. Its fields are written after the description in any
 * order, and Tasks reads them by peeling them off the END of the line, one per pass; a symbol in the
 * middle of the description is text. That is kept here so a line means the same in both plugins.
 */

export type StatusType = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED' | 'ON_HOLD' | 'NON_TASK';

/** What a status character means when the vault configures nothing for it. These are Tasks' own fallbacks. */
export function statusForUnknownSymbol(symbol: string): StatusType {
	switch (symbol) {
		case 'x': case 'X': return 'DONE';
		case '/': return 'IN_PROGRESS';
		case '-': return 'CANCELLED';
		default: return 'TODO';
	}
}

/** What a status character means. A character the vault never configured is judged by `statusForUnknownSymbol`. */
export interface StatusDef { symbol: string; name: string; type: StatusType }

export const DEFAULT_STATUSES: readonly StatusDef[] = [
	{ symbol: ' ', name: 'Todo', type: 'TODO' },
	{ symbol: 'x', name: 'Done', type: 'DONE' },
	{ symbol: '/', name: 'In Progress', type: 'IN_PROGRESS' },
	{ symbol: '-', name: 'Cancelled', type: 'CANCELLED' },
];

/** Tasks' numbering: the smaller, the more urgent. 3 is "none". */
export type Priority = 0 | 1 | 2 | 3 | 4 | 5;

export interface ParsedTask {
	/** The text after the checkbox with every field removed. */
	description: string;
	statusSymbol: string;
	statusName: string;
	statusType: StatusType;
	priority: Priority;
	/** ISO `YYYY-MM-DD`, or null. */
	created: string | null;
	start: string | null;
	scheduled: string | null;
	due: string | null;
	done: string | null;
	cancelled: string | null;
	recurrence: string | null;
	onCompletion: string | null;
	id: string | null;
	dependsOn: string[];
	/** With the leading `#`, in the order written. */
	tags: string[];
	/** The `^id` written after the task, without the caret. */
	blockId: string | null;
}

const DATE = '(\\d{4}-\\d{2}-\\d{2})';
const END = '\\uFE0F? *';
const field = (symbols: string, value: string) => new RegExp(`(?:${symbols})${END}${value}$`, 'u');

const PRIORITY_SYMBOLS: Record<string, Priority> = {
	'\u{1F53A}': 0, '⏫': 1, '\u{1F53C}': 2, '\u{1F53D}': 4, '⏬': 5,
};

const FIELDS = {
	priority: /(\u{1F53A}|⏫|\u{1F53C}|\u{1F53D}|⏬)\uFE0F?$/u,
	start: field('\u{1F6EB}', DATE),
	created: field('➕', DATE),
	scheduled: field('⏳|⌛', DATE),
	due: field('\u{1F4C5}|\u{1F4C6}|\u{1F5D3}', DATE),
	done: field('✅', DATE),
	cancelled: field('❌', DATE),
	recurrence: field('\u{1F501}', '([a-zA-Z0-9, !]+)'),
	onCompletion: field('\u{1F3C1}', '([a-zA-Z]+)'),
	dependsOn: field('⛔', '([a-zA-Z0-9-_]+(?: *, *[a-zA-Z0-9-_]+ *)*)'),
	id: field('\u{1F194}', '([a-zA-Z0-9-_]+)'),
} as const;

/** `- [ ] text`, `* [x] text`, `1. [/] text`, indented or inside a blockquote. */
const TASK_LINE = /^(?<indent>[\s>]*)(?<marker>[-*+]|\d+[.)])\s+\[(?<status>.)\]\s+(?<body>.*)$/u;

export interface TaskLine {
	indentation: string;
	marker: string;
	statusSymbol: string;
	body: string;
}

/** The parts of a task line, or null for a line that is not a task. */
export function splitTaskLine(line: string): TaskLine | null {
	const m = TASK_LINE.exec(line);
	if (!m?.groups) return null;
	return {
		indentation: m.groups.indent ?? '',
		marker: m.groups.marker ?? '-',
		statusSymbol: m.groups.status ?? ' ',
		body: m.groups.body ?? '',
	};
}

/** Tasks' own pattern: a hash after a space or at the start, up to a character that cannot be in a tag. */
const HASHTAG = /(^|\s)(#[^ !@#$%^&*(),.?":{}|<>]+)/gu;
const HASHTAG_AT_END = /(^|\s)(#[^ !@#$%^&*(),.?":{}|<>]+)$/u;
/** A block id written after the task, which links to it: ` ^abc-1`. */
const BLOCK_ID_AT_END = / \^([a-zA-Z0-9-]+)$/u;

/** Tags in a description, with the hashes. A `#` inside a word or a markdown heading is not a tag. */
export function findTags(description: string): string[] {
	const tags: string[] = [];
	for (const m of description.matchAll(HASHTAG)) {
		const tag = m[2];
		if (tag && tag.length > 1) tags.push(tag);
	}
	return tags;
}

/**
 * `statuses` maps a character to its meaning; the default set has the five most vaults use.
 * Returns null when the line is not a task.
 */
export function parseTaskLine(line: string, statuses: readonly StatusDef[] = DEFAULT_STATUSES): ParsedTask | null {
	const parts = splitTaskLine(line);
	if (!parts) return null;
	const status = statuses.find(s => s.symbol === parts.statusSymbol);

	const out: ParsedTask = {
		description: '',
		statusSymbol: parts.statusSymbol,
		statusName: status?.name ?? 'Unknown',
		statusType: status?.type ?? statusForUnknownSymbol(parts.statusSymbol),
		priority: 3,
		created: null, start: null, scheduled: null, due: null, done: null, cancelled: null,
		recurrence: null, onCompletion: null, id: null, dependsOn: [],
		tags: [], blockId: null,
	};

	// A trailing block id is not part of the description Tasks shows or matches.
	let rest = parts.body.trimEnd();
	const block = BLOCK_ID_AT_END.exec(rest);
	if (block) { out.blockId = block[1] ?? null; rest = rest.slice(0, block.index).trimEnd(); }

	// Peel fields off the end, a bounded number of passes, the way Tasks does. A tag at the end is set aside
	// like a field, so a date written before it is still found, and put back on the description afterwards.
	let trailingTags = '';
	for (let pass = 0; pass < 20; pass++) {
		let matched = false;
		const tag = HASHTAG_AT_END.exec(rest);
		if (tag) {
			matched = true;
			const text = tag[0].trim();
			trailingTags = trailingTags ? `${text} ${trailingTags}` : text;
			rest = rest.slice(0, tag.index).trimEnd();
		} else {
			for (const [key, re] of Object.entries(FIELDS) as [keyof typeof FIELDS, RegExp][]) {
				const m = re.exec(rest);
				if (!m) continue;
				matched = true;
				rest = rest.slice(0, m.index).trimEnd();
				const value = m[1] ?? '';
				if (key === 'priority') out.priority = PRIORITY_SYMBOLS[value] ?? 3;
				else if (key === 'recurrence') out.recurrence = value.trim();
				else if (key === 'onCompletion') out.onCompletion = value.trim();
				else if (key === 'id') out.id = value;
				else if (key === 'dependsOn') out.dependsOn = value.split(',').map(v => v.trim()).filter(Boolean);
				else out[key] = value;
				break;
			}
		}
		if (!matched) break;
	}
	if (trailingTags) rest = rest ? `${rest} ${trailingTags}` : trailingTags;
	out.description = rest.trim();
	out.tags = findTags(out.description);
	return out;
}

/** Tasks counts a task as done for these types, the others as not done. */
export const isDoneType = (t: StatusType): boolean => t === 'DONE' || t === 'CANCELLED' || t === 'NON_TASK';
