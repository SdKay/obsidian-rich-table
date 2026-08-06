import type { TableModelV2 } from './model';
import { canFreezeRows, canFreezeCols } from './operations';
import { cellEffectiveStyle } from './renderCellStyle';

/**
 * The DECIDING half of frozen rows/columns: given a snapshot of what the table
 * currently measures, work out every style override the frozen region needs.
 * Pure — it reads no DOM and writes none, so it is directly unit-testable and,
 * more importantly, it cannot read back a value it wrote itself.
 *
 * That last point is why this file exists. The single function this replaced
 * both read computed styles and wrote the very same properties, so it depended
 * on an exact ordering — clear our own overrides, THEN read the theme's values,
 * THEN write — with nothing enforcing it. That ordering had already been got
 * wrong once (reading back a box-shadow this code had itself composed on the
 * previous pass, and compounding it). Split in two, the hazard is structurally
 * impossible: `renderFreeze.ts` reads the DOM into a snapshot, this decides, and
 * only then does anything get written.
 *
 * `Ref` is whatever the caller uses to identify a cell — an HTMLElement in the
 * plugin, a plain string in tests. It's opaque here and passed straight through.
 */

/** A cell as measured, before anything has been written to it this pass. */
export interface CellSnapshot<Ref> {
	ref: Ref;
	/** 0 = header row, 1..N = data rows in display order. */
	rowIdx: number;
	/** From data-col. Undefined for cells that aren't column-addressed (e.g. a hidden-column indicator). */
	colIdx: number | undefined;
	rowSpan: number;
	colSpan: number;
	isHeader: boolean;
	/** An aggregate row's cell — it has its own opaque, meaningful background. */
	isAgg: boolean;
	/** Whether this cell is in the last data row (a theme may draw the table's bottom rule on <tbody>). */
	inLastDataRow: boolean;
	/** The cell's cascaded box-shadow BEFORE we compose ours onto it, or null if none. */
	themeShadow: string | null;
	/** Whether the theme paints a real border on each edge that can be a frozen boundary. */
	hasRealBorder: { bottom: boolean; right: boolean };
}

export interface TableSnapshot<Ref> {
	/** Frozen rows, by row index → the row's own offset within the scroll content. */
	rowOffsets: Map<number, number>;
	/** Frozen columns, by column index → the column's own offset within the scroll content. */
	colOffsets: Map<number, number>;
	/** Every cell that is in a frozen row or a frozen column. */
	cells: CellSnapshot<Ref>[];
	/** The table's own outer border, read while it's still the theme's value. */
	outer: {
		topColor: string | null;
		topWidth: number;
		leftColor: string | null;
		leftWidth: number;
	};
	/** <tbody>'s own box-shadow, if the theme draws the table's bottom rule there. */
	tbodyShadow: string | null;
}

export interface CellWrite<Ref> {
	ref: Ref;
	classes: string[];
	/** CSS custom properties (sticky offsets). */
	vars: Record<string, string>;
	/** Edges whose border-color to make transparent (never the width — see below). */
	hideBorders: ('top' | 'bottom' | 'left' | 'right')[];
	/** The background to force opaque, or null to leave the cell's own alone. */
	background: string | null;
	/** box-shadow layers in paint order; empty means don't touch box-shadow. */
	shadow: string[];
}

export interface FreezePlan<Ref> {
	/** Inline overrides for <table> itself. */
	table: Record<string, string>;
	cells: CellWrite<Ref>[];
	/** The validated counts actually applied — undefined where freeze is off or invalid. */
	freezeRows: number | undefined;
	freezeCols: number | undefined;
}

/** The frozen block's frame/seam line, when the theme draws nothing there itself. */
const LINE = 'var(--bt-frozen-divider, var(--background-modifier-border))';

/**
 * Which rows/columns are frozen, after re-validating against the model.
 *
 * Re-validated rather than trusted: every path that SETS these already checks
 * canFreezeRows/canFreezeCols, so this only matters for hand-edited YAML — but
 * a merge crossing a freeze boundary makes the whole feature ill-defined, so it
 * must not be applied on the strength of the stored number alone.
 */
export function resolveFreeze(model: TableModelV2): { freezeRows: number | undefined; freezeCols: number | undefined } {
	return {
		freezeRows: model.freezeRows !== undefined && canFreezeRows(model, model.freezeRows) ? model.freezeRows : undefined,
		freezeCols: model.freezeCols !== undefined && canFreezeCols(model, model.freezeCols) ? model.freezeCols : undefined,
	};
}

export function planFreeze<Ref>(snapshot: TableSnapshot<Ref>, model: TableModelV2): FreezePlan<Ref> {
	const { freezeRows, freezeCols } = resolveFreeze(model);
	const plan: FreezePlan<Ref> = { table: {}, cells: [], freezeRows, freezeCols };

	// The table's own outer top/left border is on <table>, which is not sticky, so
	// it scrolls away with the table box as soon as frozen content sticks. The
	// frozen block draws its own frame line instead, so suppress the real one to
	// avoid a doubled line at rest.
	if (freezeRows !== undefined) plan.table['border-top-color'] = 'transparent';
	if (freezeCols !== undefined) plan.table['border-left-color'] = 'transparent';
	if (freezeRows === undefined && freezeCols === undefined) return plan;

	const { topColor, topWidth, leftColor, leftWidth } = snapshot.outer;
	// A theme with a real, visible outer border (grid's bold 2px frame) used to
	// have it replaced by the generic divider — reported as "the left border
	// disappeared" once column freeze was on, which is effectively what happened.
	// Reproducing the table's own resolved border colour instead works for any
	// theme with no per-theme configuration. --bt-frozen-divider still wins if
	// set, since the var() fallback only applies when it's unset.
	const LINE_TOP = `var(--bt-frozen-divider, ${topColor ?? 'var(--background-modifier-border)'})`;
	const LINE_LEFT = `var(--bt-frozen-divider, ${leftColor ?? 'var(--background-modifier-border)'})`;

	const writes = new Map<Ref, CellWrite<Ref>>();
	const write = (cell: CellSnapshot<Ref>): CellWrite<Ref> => {
		let w = writes.get(cell.ref);
		if (!w) {
			w = { ref: cell.ref, classes: [], vars: {}, hideBorders: [], background: null, shadow: [] };
			// The theme's own box-shadow becomes the first layer, so our lines
			// compose on top instead of replacing it: box-shadow is a single
			// property, and academic draws its horizontal rules with it, which
			// vanished on exactly the cells where we added a line of our own.
			if (cell.themeShadow) w.shadow.push(cell.themeShadow);
			writes.set(cell.ref, w);
			plan.cells.push(w);
		}
		return w;
	};

	// A frozen cell must be opaque so scrolling content can't show through — but
	// which colour is the user's business, not ours: a per-cell background set by
	// the user has to win, since this runs on every geometry change and would
	// otherwise overwrite it every time. Aggregate rows already have their own
	// opaque, meaningful background.
	const opaqueBg = (cell: CellSnapshot<Ref>): string | null => {
		if (cell.isAgg) return null;
		const custom = cell.colIdx !== undefined ? cellEffectiveStyle(model, cell.rowIdx, cell.colIdx).bg : undefined;
		if (custom) return custom;
		return cell.isHeader
			? 'var(--bt-frozen-header-bg, var(--background-secondary))'
			: 'var(--bt-frozen-bg, var(--background-primary))';
	};

	// ── Row freeze ───────────────────────────────────────────────────────────
	if (freezeRows !== undefined) {
		for (const cell of snapshot.cells) {
			const top = snapshot.rowOffsets.get(cell.rowIdx);
			if (top === undefined) continue; // not in a frozen row
			const w = write(cell);
			// Per cell, never on the <tr>: position:sticky creates a stacking
			// context unconditionally, so a sticky row is an atomic paint unit that
			// covers a row-spanning cell reaching into it from the row above.
			w.classes.push('bt-frozen-row');
			w.vars['--bt-frozen-top'] = `${top}px`;
			w.background = opaqueBg(cell);

			// The first frozen row's TOP is the block's outer frame — drawn OUTSET so
			// it fills the strip the table's own (now suppressed) border vacated,
			// rather than landing one border-width inside the block.
			if (cell.rowIdx === 0) {
				w.hideBorders.push('top');
				w.shadow.push(`0 -${topWidth}px 0 0 ${LINE_TOP}`);
				// Two spread-less outset lines each cover only the strip directly
				// above / directly left of their cell, leaving the diagonal square
				// where they meet uncovered. Only meaningful when both axes are
				// frozen — without column freeze there is no left strip to complete.
				if (cell.colIdx === 0 && freezeCols !== undefined) {
					w.shadow.push(`-${leftWidth}px -${topWidth}px 0 0 ${LINE_TOP}`);
				}
			}

			// A merged cell exists in the DOM only at its anchor, so the anchor's own
			// row index is the wrong test for "is this cell's TRUE bottom edge the
			// band's last row" — a merge anchored above the boundary and spanning
			// into it would never get the boundary treatment at all.
			if (cell.rowIdx + cell.rowSpan - 1 === freezeRows) {
				// The boundary LINE is the cell's own real border, which travels with
				// it now that borders belong to cells; synthesized only for a theme
				// that draws none, or the block and the scrolling region would read as
				// merged. Replacing a real border here was itself a bug: it swapped a
				// near-black themed rule for a pale grey one, a pixel out of place.
				if (!cell.hasRealBorder.bottom) w.shadow.push(`0 1px 0 0 ${LINE}`);
				// Elevation, so the block reads as floating above what it covers.
				w.shadow.push('var(--bt-frozen-row-shadow, inset 0 -6px 6px -6px rgba(0, 0, 0, 0.3))');
			}
		}
	}

	// ── Column freeze ────────────────────────────────────────────────────────
	if (freezeCols !== undefined) {
		for (const cell of snapshot.cells) {
			if (cell.colIdx === undefined) continue;
			const left = snapshot.colOffsets.get(cell.colIdx);
			if (left === undefined) continue; // not in a frozen column
			const w = write(cell);
			w.classes.push('bt-frozen-col');
			w.vars['--bt-frozen-left'] = `${left}px`;
			w.background = opaqueBg(cell);

			if (cell.colIdx === 0) {
				w.hideBorders.push('left');
				w.shadow.push(`-${leftWidth}px 0 0 0 ${LINE_LEFT}`);
			}

			// A theme may draw the table's bottom rule as a box-shadow on <tbody>
			// rather than on the cells (academic's bottomrule). The opaque frozen
			// cells paint over it, and it can't be read from a cell since box-shadow
			// isn't inherited — so redraw it on the last data row's frozen cells.
			// Frozen rows are always the top rows, so this only concerns columns.
			if (cell.inLastDataRow && snapshot.tbodyShadow) w.shadow.push(snapshot.tbodyShadow);

			// Column mirror of the rowSpan reasoning above.
			if (cell.colIdx + cell.colSpan - 1 === freezeCols - 1) {
				if (!cell.hasRealBorder.right) w.shadow.push(`1px 0 0 0 ${LINE}`);
				w.shadow.push('var(--bt-frozen-col-shadow, inset -6px 0 6px -6px rgba(0, 0, 0, 0.3))');
			}
		}
	}

	return plan;
}
