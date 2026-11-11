/**
 * What a press on a cell starts: a range of cells, or the browser's own text selection.
 *
 * A table whose cells can be edited selects a range (the editor and the panel hang on it), whatever else is held. One
 * whose cells cannot (it is locked, shown in a view that does not edit, or its rows are found rather than written)
 * lets a drag select the text under it, as in a note, because a range leads nowhere there. Alt makes it a range, so
 * copying cells as a table stays possible.
 */
export function dragSelectsRange(cellsEditable: boolean, altKey: boolean): boolean {
	return cellsEditable || altKey;
}
