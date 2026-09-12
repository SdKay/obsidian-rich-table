/**
 * A nested rich-table block (one embedded inside a cell of another) renders
 * a genuine `<table>`/`<colgroup>`/`<tr>` structure that is still, physically,
 * a DOM descendant of the OUTER table's own `<table>` element — just several
 * levels deep, through an intermediate `<td>`. `querySelectorAll` has no
 * concept of "stop at the next table boundary": `outerTable.querySelectorAll
 * ('col')` returns the nested table's own `<col>` elements too, and code that
 * assumed "every match belongs to me" (column-letter labeling, row/col
 * selector strips, freeze-row measurement, drag-select highlighting, ...)
 * silently double-counted or mis-highlighted once nesting became possible —
 * reported as duplicate column letters (A B C D C D) once a cell actually
 * contained a nested table.
 *
 * These three helpers scope every such query to the table's own DIRECT
 * structure via `:scope >`, which a nested `<table>` can never satisfy no
 * matter how deep it's nested (its own `<tr>`/`<col>` are descendants of an
 * intermediate `<td>`/`<table>`, never direct children of the OUTER table's
 * own `<thead>`/`<tbody>`/`<colgroup>`). Every DOM query in this codebase
 * that means "this table's own cells/rows/columns" should go through one of
 * these instead of a raw `querySelectorAll` call.
 */

/** This table's own data/header cells — `<td>`/`<th>` carrying both
 *  `data-row` and `data-col`, direct descendants of its own thead/tbody rows.
 *  Matches either tag in either section: a header-anchored merge reaching
 *  into data rows hosts those rows inside `<thead>` too (see
 *  computeHeaderRowSpan) — real `.bt-td` cells, not `.bt-th` — so thead can't
 *  be assumed to hold only `<th>`. */
export function ownCells(table: HTMLElement): HTMLElement[] {
	return Array.from(table.querySelectorAll<HTMLElement>(
		':scope > :is(thead, tbody) > tr > :is(td, th)[data-row][data-col]',
	));
}

/** This table's own `<col>` elements, direct children of its own `<colgroup>`. */
export function ownCols(table: HTMLElement): HTMLElement[] {
	return Array.from(table.querySelectorAll<HTMLElement>(':scope > colgroup > col'));
}

/** A thead/tbody's own `<tr>` rows — direct children only. */
export function ownRows(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>(':scope > tr'));
}

/**
 * True if `el`'s nearest `.bt-render-root` ancestor is exactly `root` — i.e.
 * `el` belongs to THIS table instance, not a nested one rendered inside one
 * of its own cells. For queries starting from a `.bt-render-root` container
 * itself (not a `<table>`, so the `:scope >` structural helpers above don't
 * apply) — e.g. tableBlock.ts checking whether ITS OWN hover strips/selection
 * are showing, which must not pick up a nested table's identical classes.
 */
export function belongsToRoot(el: Element, root: Element): boolean {
	return el.closest('.bt-render-root') === root;
}

/**
 * True if `node` sits inside a nested rich-table rendered within `boundary`
 * itself — i.e. there's a `.bt-render-root` strictly between `node` and
 * `boundary`. Unlike `belongsToRoot`, `node.closest('.bt-render-root')` is no
 * good here: `boundary` (a cell's own content container) is itself always
 * inside the OUTER table's `.bt-render-root`, so `closest` from a plain
 * (non-nested) node would still find that outer root and incorrectly read as
 * "nested".
 */
export function isInsideNestedTable(node: Element, boundary: Element): boolean {
	let cur = node.parentElement;
	while (cur && cur !== boundary) {
		if (cur.classList.contains('bt-render-root')) return true;
		cur = cur.parentElement;
	}
	return false;
}
