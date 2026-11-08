/** Where a floating panel goes above or below the element it was opened from. Pure. */

export interface PanelPlaceInput {
	anchorTop: number;
	anchorBottom: number;
	/** The panel's height, at most the viewport's less its margins. */
	height: number;
	viewportHeight: number;
}

export interface PanelPlace {
	top: number;
	/** A height the panel must not exceed (it scrolls inside), or null to leave it as it is. */
	maxHeight: number | null;
}

/** Space kept between the panel and the edges of the window. */
const EDGE = 8;
/** Space kept between the panel and its anchor. */
const GAP = 4;

/**
 * Below the anchor, else above it. When it fits neither way, on the side with more room, shortened to fit and
 * scrolling inside. It never covers the anchor: a long press on a selected strip has to land on the strip.
 */
export function placePanel({ anchorTop, anchorBottom, height, viewportHeight }: PanelPlaceInput): PanelPlace {
	const below = anchorBottom + GAP;
	const roomBelow = viewportHeight - EDGE - below;
	if (height <= roomBelow) return { top: below, maxHeight: null };
	const roomAbove = anchorTop - GAP - EDGE;
	if (height <= roomAbove) return { top: anchorTop - GAP - height, maxHeight: null };
	if (roomBelow >= roomAbove) return { top: below, maxHeight: Math.max(0, roomBelow) };
	return { top: EDGE, maxHeight: Math.max(0, roomAbove) };
}
