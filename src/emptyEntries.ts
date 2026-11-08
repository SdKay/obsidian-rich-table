/**
 * The ways to begin a table in an empty block, one entry each. The guide (a row of buttons with a preview that follows
 * the pointer) knows nothing of what an entry does; an entry brings its own button, its own preview and what happens
 * when it is chosen. A new way to begin is a new entry, not a change to the guide.
 */
import type { TableModelV2 } from './model';

/** What the guide offers an entry once it has put the entry's button in place. */
export interface EntryContext {
	button: HTMLButtonElement;
	/** Writes the entry's choice into the note. Only the first call has any effect: a second would race the first. */
	insert(write: () => Promise<void>): void;
	/** Shows this entry's preview now. */
	showPreview(): void;
	/** Draws the entry's preview again from another model (a blank table at the size being hovered). */
	redraw(model: TableModelV2): void;
	/** Keeps the pointer from changing the preview until the returned function is called. */
	holdPreview(): () => void;
	/** Whether an insert has begun. */
	inserting(): boolean;
}

/** What an entry shows beside its button: a table, or a line of text where there is no table to show yet. */
export type EntryPreview = { model: TableModelV2 } | { hint: string };

export interface EmptyEntry {
	/** Names the entry's button and preview to each other. */
	key: string;
	label: string;
	preview: EntryPreview;
	/** Connects the button to what choosing it does. */
	bind(ctx: EntryContext): void;
}
