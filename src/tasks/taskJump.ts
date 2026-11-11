/**
 * Where a click on a task's row goes: the note the task is in, at its line. Pure; the caller hands the result to
 * Obsidian's `workspace.openLinkText`.
 */
import type { RowSource } from './taskTable';

export interface JumpTarget {
	linktext: string;
	sourcePath: string;
	/** What the modifier keys ask for (this tab, a new tab, a split, a window), as for any link. */
	where: string | boolean;
	/** Obsidian scrolls to and marks `eState.line`. It ignores a 0, and a note opens at its top anyway. */
	state: { eState: { line: number } };
}

export function jumpTo(task: RowSource, fromNote: string, where: string | boolean): JumpTarget {
	return { linktext: task.path, sourcePath: fromNote, where, state: { eState: { line: task.line } } };
}
