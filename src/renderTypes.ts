import type { StructuralOpV2 } from './operations';

// Shared adapter types used across the split renderer modules (renderer.ts,
// renderCell.ts, renderCellStyle.ts, renderPanel.ts, renderResize.ts, ...).
export type OpHandler         = (op: StructuralOpV2) => Promise<void>;
export type ToggleLockHandler = () => Promise<void>;

// Internal adapter types — same call-shape as v1 handlers, wired through OpHandler
export type CellChangeHandler    = (rowIdx: number, colIdx: number, value: string) => void;
export type ColTypeChangeHandler = (colIdx: number, colType: string | undefined) => void;
export type StructuralOpHandler  = (op: StructuralOpV2) => void;

/**
 * How a cell editor hands control back to keyboard navigation when it closes.
 * The editor knows WHICH cell it belongs to and WHY it's closing; only the
 * renderer knows the grid, so it's the renderer that resolves a direction into
 * an actual cell (via cellNav.ts) and moves the Selected highlight.
 *
 *  - 'stay' — Escape or Enter: this cell becomes Selected. Escape is the sole
 *    entry into Selected state from scratch, since a plain click goes to Editing
 *    and its mouseup clears any range behind it.
 *  - 'next' / 'prev' — Tab / Shift+Tab, or ←/→ once the caret sits at the first
 *    or last character: commit, then select the adjacent cell.
 *  - 'up' / 'down' — ↑/↓ once the caret sits at the start or end of the content.
 */
export type EditNavigateMove = 'next' | 'prev' | 'up' | 'down' | 'stay';
export type EditNavigateHandler = (rowIdx: number, colIdx: number, move: EditNavigateMove) => void;

/** Special column types handled with dedicated editors (not choice dropdowns). */
export const SPECIAL_TYPES = new Set(['date']);
