import type { StructuralOpHandler } from './renderTypes';
import { ownCols } from './renderOwnScope';
import { COL_MIN_WIDTH } from './wrap';
import { measureZoomFactor, reserveSelectorLeftPad, applyOuterFrame } from './renderGeometry';
import { shellStyled, whenStylesReady } from './stylesReady';

/**
 * Extra headroom added on top of a choice pill's measured `offsetWidth`. The
 * browser's final layout pass can round a hair wider than what JS measures
 * (sub-pixel snapping differs between measurement and the eventual render,
 * most visible with monospace fonts) — same class of discrepancy as the
 * letter-spacing buffer used for header text below, but a pill has no single
 * attributable CSS property to size the buffer from, so a flat margin is used
 * instead. Without it, a pill can come out 1px narrower than its cell needs,
 * which — if anything upstream (theme/Obsidian CSS) applies overflow
 * clipping to table cells — shows up as a stray ellipsis right after an
 * otherwise fully-visible pill.
 */
const PILL_MEASURE_BUFFER = 2;

/** The narrowest a column with a width of its own may be. */
export function colMinWidth(): number {
	return COL_MIN_WIDTH;
}

/** A column's width as drawn, in logical px, read off its <col>. */
export function colWidthOf(colEl: HTMLElement, zoom: number): number {
	return colEl.getBoundingClientRect().width / zoom;
}

/**
 * Lays the table out with fixed widths, every column held at the width it is drawn at now, and returns what lays it
 * out as before. A drag changes one column at a time; with fixed widths each move is one column's change, where an
 * auto layout would measure every cell again.
 */
export function freezeColWidths(table: HTMLElement, zoom: number): () => void {
	const cols = ownCols(table);
	const widths = cols.map(c => colWidthOf(c, zoom));
	cols.forEach((c, i) => c.style.setProperty('width', `${widths[i]}px`));
	table.style.setProperty('width', `${table.getBoundingClientRect().width / zoom}px`);
	table.addClass('bt-cols-frozen');
	return () => {
		for (const c of cols) c.style.removeProperty('width');
		table.style.removeProperty('width');
		table.removeClass('bt-cols-frozen');
	};
}

/** Changes one column of a table laid out by `freezeColWidths`; the table grows or shrinks by the same amount. */
export function setFrozenColWidth(table: HTMLElement, colEl: HTMLElement, width: number): void {
	const before = parseFloat(colEl.style.width) || 0;
	colEl.style.setProperty('width', `${width}px`);
	const tableW = parseFloat(table.style.width) || 0;
	table.style.setProperty('width', `${tableW + width - before}px`);
}

/**
 * Grows a column with a width of its own to fit the value just picked in one of its cells, if it is wider than the
 * column — never shrinks. A column without a width needs no help: the browser already sizes it to its content.
 */
export function growColForChoiceValue(cellEl: HTMLElement, colId: string, pill: HTMLElement, onStructuralOp: StructuralOpHandler, zoom = 1): void {
	if (!cellEl.hasClass('bt-col-fixed')) return;
	const currentWidth = cellEl.getBoundingClientRect().width / zoom;
	const view = activeDocument.defaultView;
	const style = view ? view.getComputedStyle(cellEl) : null;
	const padH = style ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) : 24;
	const borderH = style ? parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) : 2;
	const needed = Math.ceil(pill.offsetWidth + PILL_MEASURE_BUFFER + padH + borderH);
	if (needed > currentWidth) {
		onStructuralOp({ type: 'set-col-width', colId, width: needed });
	}
}

/**
 * Widens cell text's line-height just enough to stop adjacent lines' inline
 * `code` backgrounds from visually overlapping — reported for a multi-line
 * cell where both the line above and the line below contain inline code.
 * Obsidian's own inline-code styling (background, padding) is theme/snippet
 * territory this plugin has no fixed value for: a `<code>` element's own
 * rendered height (font metrics + vertical padding) can exceed its line's
 * `line-height`, and when it does, the code's background paints past its own
 * line's box into the next one — two such lines stacked directly on top of
 * each other collide.
 *
 * Rather than guessing a fixed line-height generous enough for every theme
 * (wasting vertical space on the overwhelming majority of tables that never
 * hit this at all), measure whatever `code` element actually rendered and
 * widen line-height only enough to fit IT — a single failed querySelector,
 * no-op for a table with no inline code anywhere. One measurement for the
 * whole table, not per cell: the code element's rendered metrics come from
 * the active theme/font context, which every cell in this table shares
 * (short of an unusual per-cell font-size override), so there is nothing
 * further to learn from checking a second one.
 *
 * Must run after the table is attached to a live, painted document
 * (getBoundingClientRect/getComputedStyle on a still-detached tree reads zero).
 */
export function applyCodeLineHeightFix(table: HTMLElement): void {
	const code = table.querySelector<HTMLElement>('.bt-td code, .bt-th code');
	if (!code) return;
	const line = code.closest('p') ?? code.parentElement;
	if (!line) return;
	// Measured back off `table` itself: this runs after attach, with no access to the renderer's own zoom.
	const zoom = measureZoomFactor(table);
	// Measure the line's TRUE rendered height via a plain, padding-free probe
	// inserted right next to the code element, in the same line box — reading
	// `line-height` off computed style is unreliable here: its computed value
	// can be a bare unitless number ("1.5") or the literal keyword "normal",
	// neither a px height on its own, and correctly resolving either needs the
	// exact font metrics anyway. A probe measures the browser's ACTUAL used
	// value directly, regardless of how it was specified — and specifically
	// does NOT grow to contain the (taller) code element, which is exactly
	// the mechanism behind the overlap this function fixes.
	// U+00A0 (non-breaking space), not a plain space or empty string — CSS
	// collapses a text node that's only regular whitespace, which wouldn't
	// reliably generate a line box at all (same reasoning as the empty-cell
	// height fix elsewhere in this codebase). The probe is removed
	// synchronously, in the same tick, well before the next paint.
	const probe = createSpan({ text: ' ' });
	code.after(probe);
	// Both operands below are visual (getBoundingClientRect); the comparison
	// between them is unit-consistent either way, but the value actually
	// WRITTEN (--bt-cell-line-height, consumed as logical line-height) needs
	// dividing by zoom — same correction shape as scrollContentOffset's own
	// (renderGeometry.ts's NO_ZOOM doc comment).
	const currentLineHeight = probe.getBoundingClientRect().height;
	probe.remove();
	if (!currentLineHeight) return;
	const codeHeight = code.getBoundingClientRect().height;
	if (codeHeight <= currentLineHeight) return; // already fits — the common case for most themes
	table.style.setProperty('--bt-cell-line-height', `${codeHeight / zoom}px`);
}

/** A column's right edge, in logical px from the table's own left border edge. */
export function colRightX(tbl: HTMLElement, colIdx: number, zoom = 1): number {
	const colEl = ownCols(tbl).find(c => c.dataset.col === String(colIdx));
	if (!colEl) return 0;
	return (colEl.getBoundingClientRect().right - tbl.getBoundingClientRect().left) / zoom;
}

/**
 * The layout fixes a freshly rendered table needs once it is attached to the live DOM
 * (they read real geometry, which a detached tree reports as 0). Order matters.
 * Covers every table and root under `container`, nested ones included. They measure what the
 * stylesheet decides (padding, fonts), so they wait for it: see stylesReady.ts.
 */
export function settleRenderedTables(container: HTMLElement): void {
	const shells = Array.from(container.querySelectorAll<HTMLElement>('.bt-render-root-shell'));
	whenStylesReady(() => settleNow(container), {
		isReady: () => shells.every(shellStyled),
		nextFrame: fn => { window.requestAnimationFrame(fn); },
	});
}

function settleNow(container: HTMLElement): void {
	container.querySelectorAll<HTMLElement>('table.bt-table').forEach(applyCodeLineHeightFix);
	container.querySelectorAll<HTMLElement>('.bt-render-root').forEach(reserveSelectorLeftPad);
	container.querySelectorAll<HTMLElement>('.bt-render-root').forEach(applyOuterFrame);
}
