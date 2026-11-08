/**
 * One note's text to its tasks, with where each one is. Pure, so a result depends on the text and nothing else.
 */
import { parseTaskLine, splitTaskLine, DEFAULT_STATUSES, type StatusDef } from './taskParse';
import type { LocatedTask } from './taskRun';

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/;
const FRONTMATTER_END = /^(---|\.\.\.)\s*$/;

/** The width of the leading whitespace, a tab counting as four columns like a list in Obsidian. */
const indentOf = (s: string): number => s.replace(/\t/g, '    ').length - s.replace(/\t/g, '    ').trimStart().length;

/** Every task in `text`, in order. Code blocks and front-matter are skipped, as Tasks does. */
export function scanTasks(path: string, text: string, statuses: readonly StatusDef[] = DEFAULT_STATUSES): LocatedTask[] {
	const lines = text.split('\n');
	const out: LocatedTask[] = [];
	let start = 0;
	if (lines[0]?.trim() === '---') {
		const end = lines.findIndex((l, i) => i > 0 && FRONTMATTER_END.test(l));
		if (end > 0) start = end + 1;
	}
	let fence: string | null = null;
	let heading: string | null = null;
	// Indents of the list items above the current one that are still open: a task nested under one is a sub-item.
	let open: number[] = [];

	for (let i = start; i < lines.length; i++) {
		const line = lines[i] ?? '';
		const f = FENCE.exec(line);
		if (f) { fence = fence === null ? f[1]! : fence === f[1] ? null : fence; continue; }
		if (fence !== null) continue;

		const h = HEADING.exec(line);
		if (h) { heading = (h[1] ?? '').trim() || null; open = []; continue; }

		const item = splitTaskLine(line);
		if (!item) {
			// A list line that is not a task still opens a level; a blank or plain line closes nothing.
			const bullet = /^([\s>]*)([-*+]|\d+[.)])\s/.exec(line);
			if (bullet) {
				const ind = indentOf(bullet[1]!.replace(/>/g, ''));
				open = open.filter(o => o < ind);
				open.push(ind);
			}
			continue;
		}
		const ind = indentOf(item.indentation.replace(/>/g, ''));
		open = open.filter(o => o < ind);
		const isSubItem = open.length > 0;
		open.push(ind);

		const task = parseTaskLine(line, statuses);
		if (task) out.push({ ...task, path, line: i, heading, isSubItem });
	}
	return out;
}

/** Every task of every note, kept per note so a change to one note costs the rescan of that note. */
export class TaskIndex {
	private readonly byPath = new Map<string, LocatedTask[]>();

	/** Replaces the tasks of `path`; no tasks removes the entry. */
	set(path: string, tasks: LocatedTask[]): void {
		if (tasks.length === 0) this.byPath.delete(path);
		else this.byPath.set(path, tasks);
	}

	delete(path: string): void { this.byPath.delete(path); }

	rename(from: string, to: string): void {
		const tasks = this.byPath.get(from);
		if (!tasks) return;
		this.byPath.delete(from);
		this.byPath.set(to, tasks.map(t => ({ ...t, path: to })));
	}

	clear(): void { this.byPath.clear(); }

	/** All tasks, in a stable order (by path, then line). */
	all(): LocatedTask[] {
		return [...this.byPath.keys()].sort().flatMap(p => this.byPath.get(p) ?? []);
	}

	get size(): number {
		let n = 0;
		for (const tasks of this.byPath.values()) n += tasks.length;
		return n;
	}
}
