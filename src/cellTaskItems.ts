/**
 * The tasks a cell renders, found in the DOM. A task is its checkbox, `input.task-list-item-checkbox`: it stays in the
 * DOM when a theme or plugin hides it and draws a stand-in (`.task-state`) beside it, and the cell flattens its lists, so
 * the `li` around it is gone. The n-th checkbox is the n-th task line of the cell's text.
 */
import { isInsideNestedTable } from './renderOwnScope';

const CHECKBOX = 'input.task-list-item-checkbox';
const STAND_IN = '.task-state, .task-state-container';

/** The cell's own task checkboxes in document order, leaving out those of a table nested in it. */
export function taskBoxesOf(cell: HTMLElement): HTMLInputElement[] {
	return Array.from(cell.querySelectorAll<HTMLInputElement>(CHECKBOX)).filter(box => !isInsideNestedTable(box, cell));
}

/**
 * The checkbox of the task `target` presses: the checkbox itself, or the stand-in drawn beside a hidden one, which
 * follows the checkbox it stands in for. Null for a press anywhere else, the task's text included.
 */
export function taskBoxAt(target: EventTarget | null, cell: HTMLElement): HTMLInputElement | null {
	if (!(target instanceof Element)) return null;
	const boxes = taskBoxesOf(cell);
	const direct = target.closest<HTMLInputElement>(CHECKBOX);
	if (direct) return boxes.includes(direct) ? direct : null;
	const standIn = target.closest(STAND_IN);
	if (!standIn || !cell.contains(standIn)) return null;
	// The nearest checkbox before the stand-in in document order.
	let found: HTMLInputElement | null = null;
	for (const box of boxes) {
		if (box.compareDocumentPosition(standIn) & Node.DOCUMENT_POSITION_FOLLOWING) found = box;
		else break;
	}
	return found;
}
