/**
 * How wide a column may get while one of its cells is being edited.
 * A fixed-width column keeps its width; an auto column follows its text but
 * stops where the view ends. Where the text no longer fits, the editor wraps.
 */
export interface EditWidthInput {
	/** Width the text needs on one line, cell padding and border included. */
	needed: number;
	/** The column's width right now. */
	current: number;
	/** Fixed columns do not follow their text. */
	fixed: boolean;
	/** Room from the column's left edge to the right edge of the view. */
	room: number;
}

export interface EditWidth {
	/** The width to give the column. */
	width: number;
	/** Whether the text wraps inside it. */
	wrap: boolean;
}

export function editWidth({ needed, current, fixed, room }: EditWidthInput): EditWidth {
	if (fixed) return { width: current, wrap: needed > current };
	// Within the view the column only ever widens, so it does not twitch while typing;
	// one that is wider than the view already is brought back to it.
	const floor = Math.min(current, room);
	if (needed <= room) return { width: Math.max(floor, needed), wrap: false };
	return { width: room, wrap: true };
}
