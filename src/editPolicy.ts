/**
 * What the user may do to a table right now. Separate from what the table's source can do (a task
 * table has no rows to edit whatever the user is allowed): this is only about the user's situation.
 *
 * Three facts decide it, and none of them belongs to the data source:
 *  - the surface the table is on: live preview or reading view (the setting can allow editing in the latter),
 *  - whether the table is locked, which is the user's own choice and is saved in the note,
 *  - whether the table is in an old format that must be upgraded before it is touched.
 */
import type { OpEffect } from './opEffect';

export interface PolicyInput {
	surface: 'live' | 'reading';
	/** The setting that lets a table in reading view be edited. */
	readingEdit: boolean;
	locked: boolean;
	/** A table in an older format is shown but not changed until the user upgrades it. */
	legacy: boolean;
	/** A block with nothing in it yet: there is no table to change. */
	empty: boolean;
}

export interface EditPolicy {
	/** Whether an operation of this kind may be carried out. */
	permits(effect: OpEffect): boolean;
	/** Whether the table's data and look may be changed at all. */
	readonly editable: boolean;
}

export function editPolicy(input: PolicyInput): EditPolicy {
	const { surface, readingEdit, locked, legacy, empty } = input;
	const editable = !empty && !legacy && !locked && (surface === 'live' || readingEdit);
	// Locking is itself a change to the note, so it is a live-preview action only, never from reading view.
	const mayToggleLock = !empty && !legacy && surface === 'live';
	// Another sheet can be opened on a locked table; an empty or old-format one has nothing to open.
	const mayNavigate = !empty && !legacy;

	const permits = (effect: OpEffect): boolean => {
		switch (effect) {
			case 'content':
			case 'structure':
			case 'look':
			case 'derived':
				return editable;
			case 'state':
				return mayToggleLock;
			case 'navigate':
				return mayNavigate;
		}
	};
	return { permits, editable };
}
