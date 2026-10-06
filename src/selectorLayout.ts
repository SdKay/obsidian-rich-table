/**
 * Selector strip layout constants — single source of truth for all dimensions
 * shared between the CSS custom properties on .bt-render-root and the JS
 * positioning calculations in renderer.ts.
 *
 * SEL_UNIT is the ONE width every left/right-side component (toolbar, row/col
 * selector, row/col adder, vertical scrollbar) is sized off of — the table's
 * left-right symmetry design treats all of them as interchangeable-width
 * strips. Previously the row/col selector split its own SEL_TOTAL (32px) into
 * a drag-grip zone (SEL_GRIP) plus a label zone (SEL_LABEL), because the strip
 * doubled as both a click-to-select target and a drag-reorder handle. Row/col
 * reordering moved to a keyboard shortcut (Alt+Shift+Arrow), so the strip is a
 * single click zone now — no grip sub-region left to reserve, and its full
 * width collapses to the same SEL_UNIT every other strip already uses.
 *
 * CSS counterpart (set on .bt-render-root): --bt-sel-unit
 */

/** Full width of the row selector / full height of the col selector, and the
 *  shared width of the toolbar, row/col adder, and vertical scrollbar (px). */
export const SEL_UNIT = 22;

/** Inset size for a selector's own row-number/column-letter label glyph and
 *  for the auto-fit button (px). Inset 4px from the full strip width. */
export const SEL_CELL = SEL_UNIT - 4; // 18

/** Left offset from table-left to auto-fit button left edge.
 *  Centers the button (width = SEL_CELL = 18) on the row-selector's own
 *  label glyphs:
 *    row-sel label center (from root) = tl - SEL_CELL/2 = tl - 9
 *    button width = SEL_CELL = 18  →  left = (tl - 9) - 9 = tl - 18
 *    18 = SEL_CELL                                                       */
export const AUTOFIT_OFFSET = SEL_CELL; // 18

/** Fixed gap between the view's top edge and its first content. Matches the 8px drag-handle zone on the opposite edge. */
export const VIEW_EDGE_GAP = 8;
