/**
 * Selector strip layout constants — single source of truth for all dimensions
 * shared between the CSS custom properties on .bt-render-root and the JS
 * positioning calculations in renderer.ts.
 *
 * CSS counterparts (set on .bt-render-root):
 *   --bt-sel-total  SEL_TOTAL
 *   --bt-sel-grip   SEL_GRIP
 *   --bt-sel-label  SEL_LABEL
 *   --bt-sel-cell   SEL_CELL
 */

/** Full width of the row selector / full height of the col selector (px). */
export const SEL_TOTAL = 32;

/** Drag-grip zone: leftmost strip of row selector / topmost strip of col selector (px). */
export const SEL_GRIP = 10;

/** Label-cell zone (row numbers / col letters) = SEL_TOTAL - SEL_GRIP (px). */
export const SEL_LABEL = SEL_TOTAL - SEL_GRIP; // 22

/** Height of col-selector label cells / width of row-selector label cells (px).
 *  Inset 4px from the label zone: SEL_LABEL - 4. */
export const SEL_CELL = SEL_LABEL - 4; // 18

/** Left offset from table-left to auto-fit button left edge.
 *  Centers the button (width = SEL_CELL = 18) on the row-selector label cells:
 *    row-sel label cell center (from root) = tl - SEL_CELL/2 = tl - 9
 *    button width = SEL_CELL = 18  →  left = (tl - 9) - 9 = tl - 18
 *    18 = SEL_CELL                                                       */
export const AUTOFIT_OFFSET = SEL_CELL; // 18
