/**
 * The columns a tasks table can show, and the text each one puts in a cell. Pure: no Obsidian, no DOM.
 */
import type { ParsedTask } from './taskParse';
import type { LocatedTask } from './taskRun';
import type { SortKey } from './taskQuery';

export interface TaskField {
	id: string;
	/** The column name a new column of this field starts with. */
	label: string;
	/** The Tasks sort line this field's column sorts by; absent when Tasks has none for it. */
	sort?: SortKey;
}

/** In the order they are offered. */
export const TASK_FIELDS: readonly TaskField[] = [
	{ id: 'status', label: 'Status', sort: 'status' },
	{ id: 'body', label: 'Task', sort: 'description' },
	{ id: 'due', label: 'Due', sort: 'due' },
	{ id: 'scheduled', label: 'Scheduled', sort: 'scheduled' },
	{ id: 'start', label: 'Start', sort: 'start' },
	{ id: 'created', label: 'Created', sort: 'created' },
	{ id: 'done', label: 'Done', sort: 'done' },
	{ id: 'priority', label: 'Priority', sort: 'priority' },
	{ id: 'tags', label: 'Tags', sort: 'tag' },
	{ id: 'recurrence', label: 'Repeats' },
	{ id: 'file', label: 'File', sort: 'filename' },
	{ id: 'path', label: 'Path', sort: 'path' },
	{ id: 'heading', label: 'Heading', sort: 'heading' },
	{ id: 'description', label: 'Description', sort: 'description' },
];

/** The columns a new tasks table starts with. */
export const DEFAULT_TASK_FIELDS: readonly string[] = ['status', 'body', 'due', 'priority', 'tags', 'file'];

export const fieldById = (id: string): TaskField | undefined => TASK_FIELDS.find(f => f.id === id);

const STATUS_MARK: Record<string, string> = {
	TODO: '☐', IN_PROGRESS: '◐', ON_HOLD: '⏸', DONE: '☑', CANCELLED: '☒', NON_TASK: '·',
};

const PRIORITY_MARK = ['\u{1F53A}', '⏫', '\u{1F53C}', '', '\u{1F53D}', '⏬'];

/**
 * A tag that is really an HTML colour, left behind by `<mark style="background: #00FFFF;">`. The semicolon is what
 * tells it from a tag a person typed: `#2026` and `#beef` are tags, `#00FFFF;` is not.
 */
const COLOUR_TAG = /^#[0-9a-fA-F]{3,8};$/;

/** The tags worth showing. Filtering by tag still sees all of them, as in Tasks. */
export const shownTags = (tags: readonly string[]): string[] => tags.filter(t => !COLOUR_TAG.test(t));

/** The description without its tags, which is what a person reads as the task. */
export function bodyOf(t: ParsedTask): string {
	let text = t.description;
	for (const tag of t.tags) text = text.replace(tag, '');
	return text.replace(/\s+/g, ' ').trim();
}

const base = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');

/** The text of one cell. An unknown field gives an empty cell rather than an error. */
export function fieldText(t: LocatedTask, field: string): string {
	switch (field) {
		case 'status': return STATUS_MARK[t.statusType] ?? '☐';
		case 'body': return bodyOf(t);
		case 'description': return t.description;
		case 'due': return t.due ?? '';
		case 'scheduled': return t.scheduled ?? '';
		case 'start': return t.start ?? '';
		case 'created': return t.created ?? '';
		case 'done': return t.done ?? '';
		case 'priority': return PRIORITY_MARK[t.priority] ?? '';
		case 'tags': return shownTags(t.tags).join(' ');
		case 'recurrence': return t.recurrence ?? '';
		case 'file': return base(t.path);
		case 'path': return t.path;
		case 'heading': return t.heading ?? '';
		default: return '';
	}
}
