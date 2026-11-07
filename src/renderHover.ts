/**
 * The highlight of the row and the column under the pointer, drawn as an inset shadow so it follows merged cells.
 * It is not drawn while the note scrolls cells past a still pointer, nor while a range is being selected.
 */
import type { Component } from 'obsidian';
import { isNoteScrolling } from './noteScroll';

export interface RenderHoverContext {
	component: Component;
	table: HTMLTableElement;
	sel: { start: { row: number; col: number } | null };
	clearSel: () => void;
	/** Read when the pointer moves: the selection panel opens and closes after this is set up. */
	isSelectionPanelOpen: () => boolean;
	removeSelectionPanel: () => void;
}

export function renderHover(ctx: RenderHoverContext): { resetHover: () => void } {
	const { component, table, sel, clearSel, isSelectionPanelOpen, removeSelectionPanel } = ctx;
	// ── Row/cell hover highlight (merge-aware) ──────────────────────────────
	// Can't be native CSS :hover: a rowspanned cell's <td> physically lives in only
	// the FIRST <tr> it visually spans, so `tr:hover` alone can never light up
	// the rows underneath it.
	//
	// Modeled as a horizontal sweep through the hovered cell's own row band
	// (just its own row if unmerged, or every row a rowspanned hovered cell
	// itself covers): every cell IN that band gets fully row-highlighted
	// (including any OTHER column's merge that happens to live there, which
	// paints its own full height automatically via its rowSpan) — but a merge
	// anchored OUTSIDE the band that merely reaches INTO it (from an earlier
	// row, since a covered row never has its own <td> for that column) only
	// gets itself highlighted, not its entire row. This was tried first as a
	// transitive "two rows are joined if ANY column's merge covers both, and
	// that can chain" union-find — reported as lighting up the entire table,
	// since two independent merges that each touch the hovered row (one from
	// above, one anchored at it) chained into one another's neighbors too.
	// The sweep only ever looks at the ORIGINAL band, once, with no chaining.
	//
	// Tint applied via inline box-shadow, NOT a CSS class + background rule
	// (the original design) — reported: hovering a frozen cell, or any cell
	// with a user-set per-cell background color, showed no hover tint at all.
	// Root cause: both a frozen cell's opaque fill (renderFreeze.ts's opaqueBg)
	// and a per-cell custom color (applyResolvedStyle) set `background-color`
	// inline with 'important' priority, which always beats a STYLESHEET rule's
	// own !important regardless of specificity — the exact "inline beats any
	// stylesheet !important" invariant this codebase already relies on
	// elsewhere, just working against the hover tint here instead of for it.
	// box-shadow sidesteps this categorically: an inset shadow paints in a
	// later layer than background regardless of who set the background or
	// with what priority, so it's visible no matter what's underneath.
	// hoverShadowBase caches each touched cell's box-shadow *before* hovering
	// touched it (its exact inline value, '' if none) so clearHover can put it
	// back verbatim — needed because a frozen cell's own frame-line shadow, or
	// a theme's own box-shadow decoration (e.g. academic's toprule/midrule),
	// would otherwise be clobbered by the hover layer and never restored.
	const HOVER_CELL_SHADOW = 'inset 0 0 0 999px var(--background-modifier-hover)';
	const HOVER_ROW_SHADOW  = 'inset 0 0 0 999px color-mix(in srgb, var(--background-modifier-hover) 50%, transparent)';
	const hoverShadowBase = new Map<HTMLElement, string>();
	const setHoverShadow = (el: HTMLElement, layer: string) => {
		// A cell being actively edited already gets its own outline (see the
		// selection-highlight CSS) and its editor's own opaque background only
		// covers its OWN content box, not necessarily the full <td> (a `<td>`'s
		// height is "auto" — a plain child's `height:100%` doesn't resolve
		// against a row height some OTHER cell stretched, confirmed by direct
		// measurement) — so tinting it here left a grey band showing around a
		// smaller white patch (reported: editing a cell while still hovering it
		// showed a grey cell with a white rectangle inside). Matches Excel too:
		// a cell mid-edit doesn't also show a hover tint.
		if (el.hasClass('bt-editing')) return;
		if (!hoverShadowBase.has(el)) hoverShadowBase.set(el, el.style.getPropertyValue('box-shadow'));
		// Combine with whatever's currently cascading (the cell's own inline
		// value if it has one, else a theme's stylesheet-level box-shadow) —
		// not just the cached inline base — so a theme's decoration also isn't
		// erased for the duration of the hover itself, not only after it ends.
		const computed = getComputedStyle(el).boxShadow;
		const base = computed && computed !== 'none' ? computed : '';
		el.style.setProperty('box-shadow', base ? `${layer}, ${base}` : layer, 'important');
	};
	const clearHover = () => {
		hoverShadowBase.forEach((inlineBase, el) => {
			if (inlineBase) el.style.setProperty('box-shadow', inlineBase, 'important');
			else el.style.removeProperty('box-shadow');
		});
		hoverShadowBase.clear();
	};
	let lastHoverCell: HTMLTableCellElement | null = null;
	// Clears the highlight and forgets the cell it was on, so the next move onto that same cell draws it again.
	// The two only make sense together; moving to another cell clears the highlight alone, having just recorded it.
	const resetHover = () => { lastHoverCell = null; clearHover(); };
	table.addEventListener('mouseover', (evt: MouseEvent) => {
		// The note scrolling cells past a resting cursor is not the user pointing at them.
		if (isNoteScrolling()) return;
		const cell = (evt.target as HTMLElement).closest<HTMLTableCellElement>('.bt-td, .bt-th');
		if (cell === lastHoverCell) return; // moving within the same cell's own nested content
		lastHoverCell = cell;
		clearHover();
		if (!cell) return;
		setHoverShadow(cell, HOVER_CELL_SHADOW);
		const tr = cell.closest<HTMLElement>('tr');
		const container = tr?.parentElement;
		if (!tr || !container) return;
		const trs = Array.from(container.children) as HTMLElement[];
		const bandStart = trs.indexOf(tr);
		if (bandStart < 0) return;
		const bandEnd = bandStart + (cell.rowSpan || 1) - 1;

		trs.forEach((t, i) => {
			if (i >= bandStart && i <= bandEnd) {
				// Fully in the sweep's own band — every cell in this row lights up
				// (the hovered cell itself already has the stronger cell-tint above).
				t.querySelectorAll<HTMLElement>(':scope > .bt-td, :scope > .bt-th')
					.forEach(c => { if (c !== cell) setHoverShadow(c, HOVER_ROW_SHADOW); });
				return;
			}
			// Outside the band — only a cell whose OWN span reaches into the band
			// (an earlier row's merge extending down into it) gets highlighted,
			// and only that one cell, since the sweep doesn't otherwise touch this row.
			Array.from(t.children).forEach(c => {
				const el = c as HTMLTableCellElement;
				if (!el.matches('.bt-td, .bt-th')) return;
				const end = i + (el.rowSpan || 1) - 1;
				if (end >= bandStart && i <= bandEnd) setHoverShadow(el, HOVER_ROW_SHADOW);
			});
		});
	});
	table.addEventListener('mouseleave', resetHover);

	// Click outside the table clears selection and panel. ctrlCol counts as
	// part of the table's own UI (same as the panel itself) — it sits outside
	// .bt-table-wrapper in the DOM, so without this a click on one of its own
	// buttons (e.g. select-all, below) would bubble here and immediately
	// clear the very selection/panel that button just opened.
	component.registerDomEvent(activeDocument, 'click', (evt: MouseEvent) => {
		if (!isSelectionPanelOpen() && !sel.start) return;
		if (!(evt.target as HTMLElement).closest('.bt-table-wrapper, .bt-cell-panel, .bt-ctrl-col')) {
			removeSelectionPanel();
			clearSel();
		}
	});
	return { resetHover };
}
