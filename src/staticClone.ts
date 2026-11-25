/**
 * What a copy of a rendered table keeps when it leaves the note as something to look at, a picture (tableSnapshot.ts)
 * or a page (staticExport.ts): the table, with none of the parts that only work while it is being edited.
 */

/** Hover-only chrome, scroll affordances, and the bars about the table rather than in it. `.bt-sheet-tabbar` is named
 *  on its own because a sheet drawn as a kanban or calendar has no status bar to hold it. */
export const STRIP_SELECTORS = [
	'.bt-ctrl-col',
	'.bt-col-selector',
	'.bt-row-selector',
	'.bt-edge-add-row',
	'.bt-edge-add-col',
	'.bt-view-resize-r',
	'.bt-view-resize-br',
	'.bt-view-resize-b',
	'.bt-view-scroll',
	'.bt-status-bar',
	'.bt-sheet-tabbar',
].join(', ');

/**
 * Cuts a detached copy of `root` down to the table: the chrome is removed, the room reserved for the hover strips is
 * given back (it has no purpose once the strips are gone, and an untitled table also clears Obsidian's floating block
 * toolbar with an extra 28px), and the view's fixed size is lifted, by `expandClass`, so the whole table shows. Only ever
 * call it on a clone: it takes things off that the live table needs.
 */
export function stripToTable(clone: HTMLElement, expandClass = 'bt-snapshot-expanded'): HTMLElement | null {
	clone.querySelectorAll(STRIP_SELECTORS).forEach(el => el.remove());
	clone.style.removeProperty('--bt-sel-pad');
	clone.style.removeProperty('--bt-sel-pad-left');
	clone.style.removeProperty('--bt-sel-pad-right');
	const wrapper = clone.querySelector<HTMLElement>('.bt-table-wrapper');
	if (wrapper) {
		wrapper.classList.remove('bt-view-fixed-w', 'bt-view-fixed-h');
		wrapper.classList.add(expandClass);
	}
	return wrapper;
}
