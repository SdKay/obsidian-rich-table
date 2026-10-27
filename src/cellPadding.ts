/** Space in px between a cell's text and its top and bottom border. */
export const CELL_PADDING_Y_RANGE = { min: 0, max: 16 } as const;
export const DEFAULT_CELL_PADDING_Y = 4;

/** The padding a stored value stands for: a whole number inside the range, else the default. */
export function cellPaddingOf(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CELL_PADDING_Y;
	return Math.min(CELL_PADDING_Y_RANGE.max, Math.max(CELL_PADDING_Y_RANGE.min, Math.round(value)));
}

/** Publishes the setting for the stylesheet, on every window. Cells read it as --bt-cell-pad-y. */
export function applyCellPadding(value: unknown): void {
	const px = `${cellPaddingOf(value)}px`;
	for (const doc of new Set([activeDocument, document])) doc.body.style.setProperty('--bt-cell-pad-y', px);
}
