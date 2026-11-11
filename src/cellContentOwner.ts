/**
 * Who a pointer press inside a cell belongs to. Rendered cell content can carry its own controls (a task's checkbox,
 * a link, a nested table); a press on one is that control's, and the cell around it must not start editing or a
 * selection from it.
 */

/** Controls the browser or Obsidian gives their own behaviour on press. */
const CONTROLS = 'input, button, select, textarea, summary, a[href], a.internal-link, a.external-link, .task-state, .task-state-container';

/**
 * True when `target` is, or sits inside, content of `cell` that handles the press itself: a control, or a nested table
 * (which has its own cells to activate and select). A press on the cell's own text or padding is the cell's.
 */
export function contentOwnsPress(target: EventTarget | null, cell: Element): boolean {
	if (!(target instanceof Element) || !cell.contains(target)) return false;
	if (target.closest(CONTROLS) && cell.contains(target.closest(CONTROLS))) return true;
	// A nested table is a `.bt-render-root` strictly inside the cell; the cell's own table root is outside it.
	const nested = target.closest('.bt-render-root');
	return nested !== null && cell.contains(nested);
}
