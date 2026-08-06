import type { TableModelV2 } from './model';
import { scrollContentOffset } from './renderGeometry';
import { planFreeze, resolveFreeze, type CellSnapshot, type FreezePlan, type TableSnapshot } from './renderFreezePlan';

/**
 * Applies sticky positioning for frozen rows/columns (`model.freezeRows`/
 * `freezeCols`) — called from a rAF-coalesced ResizeObserver on `table`
 * (renderer.ts) on every geometry-affecting change (edit, resize, zoom), since
 * row heights and column widths can both change at any time and the sticky
 * offsets have to track them live.
 *
 * THREE STRICT PHASES, in this order:
 *   1. `clearFreeze` — remove everything a previous pass wrote.
 *   2. `snapshotTable` — read the DOM (offsets, the theme's own borders and
 *      shadows) into plain data. Only reads.
 *   3. `planFreeze` (renderFreezePlan.ts, pure) then `writePlan` — decide, then
 *      write. Neither reads the DOM.
 *
 * The phases exist because this used to be one function that read computed
 * styles and wrote the very same properties, so correctness rested on an
 * unenforced ordering — and that ordering had already been got wrong once, by
 * reading back a box-shadow this code had itself composed on the previous pass.
 * Split this way, reading a value we wrote is structurally impossible. It also
 * puts every decision in a pure function that unit tests can drive without a
 * browser (test/renderFreezePlan.test.ts), which is what the pixel-level e2e
 * suite could only cover end-to-end before.
 *
 * Both axes stick per CELL. Sticking the whole <tr> for row-freeze looks like a
 * free win (one sticky point per row instead of N) and is how this worked until
 * a measured bug ruled it out: position:sticky creates a stacking context
 * unconditionally, so a sticky <tr> is an atomic paint unit that covers any
 * rowSpan cell reaching into it from the row above. See the ROW-FREEZE STICKS
 * EACH CELL note in styles.css. Column-freeze was always per-cell anyway (<col>
 * elements can't be positioned), so both axes are now consistent.
 *
 * VISUAL MODEL: the frozen region keeps the theme's own gridlines, because a
 * border belongs to its cell and travels with it (the table is
 * border-collapse: separate, with one border per cell edge — see styles.css).
 * Only two things are synthetic: the block's outer top/left frame, since the
 * real one lives on <table> and scrolls away, and an elevation shadow at the
 * seam so the block reads as floating above what it covers. An earlier design
 * went much further and tried to replicate every theme's internal decoration
 * per cell; that was abandoned as fundamentally fragile (themes draw lines in
 * mutually-incompatible ways, and fractional device pixels made exact
 * replication impossible), and the switch to separate borders removed the need
 * entirely. Every override is inline with 'important' priority — the same
 * "inline beats any stylesheet rule's !important regardless of specificity"
 * guarantee this codebase already relies on for user per-cell styles
 * (applyResolvedStyle).
 */

function forceImportant(el: HTMLElement, prop: string, value: string): void {
	el.style.setProperty(prop, value, 'important');
}

/** Does the theme paint a real, visible border on this edge? */
function hasRealBorder(cs: CSSStyleDeclaration, side: 'bottom' | 'right'): boolean {
	const style = side === 'bottom' ? cs.borderBottomStyle : cs.borderRightStyle;
	const width = side === 'bottom' ? cs.borderBottomWidth : cs.borderRightWidth;
	const color = side === 'bottom' ? cs.borderBottomColor : cs.borderRightColor;
	const alpha = /rgba?\([^)]*?,\s*([\d.]+)\s*\)/.exec(color);
	return style !== 'none' && style !== 'hidden' && (parseFloat(width) || 0) > 0
		&& (alpha ? parseFloat(alpha[1] ?? '1') > 0.05 : true);
}

// ── Phase 1: clear ──────────────────────────────────────────────────────────

function clearCell(el: HTMLElement): void {
	el.removeClass('bt-frozen-row');
	el.removeClass('bt-frozen-col');
	el.style.removeProperty('--bt-frozen-top');
	el.style.removeProperty('--bt-frozen-left');
	el.style.removeProperty('box-shadow');
	el.style.removeProperty('background-color');
	el.style.removeProperty('border-top-color');
	el.style.removeProperty('border-bottom-color');
	el.style.removeProperty('border-left-color');
	el.style.removeProperty('border-right-color');
}

function clearFreeze(table: HTMLTableElement): void {
	// Includes tr.bt-frozen-row, which no current build produces but a table
	// rendered in place by an older one still carries — clearCell is harmless on a
	// <tr>, and removing the class is what un-sticks it.
	table.querySelectorAll<HTMLElement>('.bt-frozen-row, .bt-frozen-col').forEach(clearCell);
	// Reset rather than re-override, so the reads in phase 2 see the theme's real
	// values: a previous pass left these 'transparent', and reading that back
	// would echo 'transparent' forever instead of the theme's border colour.
	table.style.removeProperty('border-top-color');
	table.style.removeProperty('border-left-color');
}

// ── Phase 2: read ───────────────────────────────────────────────────────────

/**
 * Reads everything the plan needs, and nothing more: only cells that are in a
 * frozen row or a frozen column are inspected, since getComputedStyle per cell
 * across a large table is the expensive part of this whole pass.
 */
function snapshotTable(
	table: HTMLTableElement, thead: HTMLElement, tbody: HTMLElement,
	freezeRows: number | undefined, freezeCols: number | undefined,
	cache?: ThemeCache,
): TableSnapshot<HTMLElement> {
	const tableStyle = getComputedStyle(table);
	// borderTopStyle/-LeftStyle guard against a theme with NO outer border:
	// computed border-color still resolves to some value even when unpainted, and
	// using that unrelated value would change every such theme's frozen frame as
	// a side effect nobody asked for. null falls through to the generic divider.
	const topColor = tableStyle.borderTopStyle !== 'none' ? tableStyle.borderTopColor : null;
	const leftColor = tableStyle.borderLeftStyle !== 'none' ? tableStyle.borderLeftColor : null;
	// The width matters as well as the colour: the frame is a box-shadow standing
	// in for a border, and a mismatched width is invisible along its own axis but
	// visibly misaligns where the two frame lines meet at the corner.
	// From cache when there is one: the table's own border is the value freeze
	// overrides to transparent, so reading it back on a pass that hasn't cleared
	// first measures our own write. See applyFreeze's note.
	const outer = cache?.outer ?? {
		topColor,
		topWidth: topColor !== null ? parseFloat(tableStyle.borderTopWidth) || 1 : 1,
		leftColor,
		leftWidth: leftColor !== null ? parseFloat(tableStyle.borderLeftWidth) || 1 : 1,
	};

	const tbodyShadowRaw = cache ? null : getComputedStyle(tbody).boxShadow;
	const snapshot: TableSnapshot<HTMLElement> = {
		rowOffsets: new Map(), colOffsets: new Map(), cells: [], outer,
		tbodyShadow: cache ? cache.tbodyShadow : (tbodyShadowRaw && tbodyShadowRaw !== 'none' ? tbodyShadowRaw : null),
	};
	if (freezeRows === undefined && freezeCols === undefined) return snapshot;

	if (freezeCols !== undefined) {
		for (const col of Array.from(table.querySelectorAll<HTMLElement>('col'))) {
			const ci = col.dataset.col !== undefined ? parseInt(col.dataset.col) : undefined;
			if (ci === undefined || ci >= freezeCols) continue;
			// Measured off the <col>, which is never sticky, so its rect is always the
			// column's true layout box even while its cells are stuck elsewhere.
			snapshot.colOffsets.set(ci, scrollContentOffset(col, 'x'));
		}
	}

	const rows = [...Array.from(thead.querySelectorAll<HTMLElement>('tr')), ...Array.from(tbody.querySelectorAll<HTMLElement>('tr'))]
		// Aggregate and hidden-row-indicator rows have no [data-row] cell and are
		// never frozen.
		.map(tr => ({ tr, idxAttr: tr.querySelector<HTMLElement>('[data-row]')?.dataset.row }))
		.filter((r): r is { tr: HTMLElement; idxAttr: string } => r.idxAttr !== undefined)
		.map(r => ({ tr: r.tr, rowIdx: parseInt(r.idxAttr) }));
	const lastDataRowIdx = rows.length ? rows[rows.length - 1]?.rowIdx : undefined;

	for (const { tr, rowIdx } of rows) {
		const frozenRow = freezeRows !== undefined && rowIdx <= freezeRows;
		// Safe to read the row's live rect: nothing has been written yet this pass,
		// and a sticky element never changes any other element's layout position.
		if (frozenRow) snapshot.rowOffsets.set(rowIdx, scrollContentOffset(tr, 'y'));

		for (const cell of Array.from(tr.children) as HTMLTableCellElement[]) {
			const colIdx = cell.dataset.col !== undefined ? parseInt(cell.dataset.col) : undefined;
			const frozenCol = colIdx !== undefined && snapshot.colOffsets.has(colIdx);
			if (!frozenRow && !frozenCol) continue;
			// Cached theme bits skip the getComputedStyle entirely — the expensive
			// part of this pass, and the only part a previous pass's writes could
			// have corrupted. A miss means a new element, which is safe to read.
			const cachedBits = cache?.bits.get(cell);
			const bits = cachedBits ?? (() => {
				const cs = getComputedStyle(cell);
				const shadow = cs.boxShadow;
				return {
					themeShadow: shadow && shadow !== 'none' ? shadow : null,
					hasRealBorder: { bottom: hasRealBorder(cs, 'bottom'), right: hasRealBorder(cs, 'right') },
				};
			})();
			snapshot.cells.push({
				ref: cell,
				rowIdx,
				colIdx,
				rowSpan: cell.rowSpan || 1,
				colSpan: cell.colSpan || 1,
				isHeader: cell.tagName === 'TH',
				isAgg: cell.hasClass('bt-agg-td'),
				inLastDataRow: rowIdx === lastDataRowIdx,
				themeShadow: bits.themeShadow,
				hasRealBorder: bits.hasRealBorder,
			} satisfies CellSnapshot<HTMLElement>);
		}
	}
	return snapshot;
}

// ── Phase 3: write ──────────────────────────────────────────────────────────

function writePlan(table: HTMLTableElement, plan: FreezePlan<HTMLElement>): void {
	for (const [prop, value] of Object.entries(plan.table)) forceImportant(table, prop, value);
	for (const cell of plan.cells) {
		for (const cls of cell.classes) cell.ref.addClass(cls);
		if (Object.keys(cell.vars).length) cell.ref.setCssProps(cell.vars);
		// Only the border's COLOUR is ever touched, never its width: `border: none`
		// drops the width, which changes the table's rendered size, which re-fires
		// the ResizeObserver that called this — with renderer.ts's own observer
		// joining in, the two ping-ponged every frame and pinned the main thread.
		// Zeroing the colour is no layout change at all, and the frame line drawn
		// over it means nothing doubles up. Asserted in the baseline e2e suite
		// ("turning freeze on changes no layout geometry").
		for (const side of cell.hideBorders) forceImportant(cell.ref, `border-${side}-color`, 'transparent');
		if (cell.background !== null) forceImportant(cell.ref, 'background-color', cell.background);
		// One property, so every line is composed into a single comma-separated
		// value — in the order the plan listed them, which is the paint order.
		if (cell.shadow.length) forceImportant(cell.ref, 'box-shadow', cell.shadow.join(', '));
	}
}

/** What the THEME contributes, for one table. Everything here is a value our own
 * writes would corrupt if read back, which is precisely why the read has to
 * happen before any write — and why caching it is what lets a repeat pass avoid
 * reading at all. */
interface ThemeCache {
	/** Which theme this was measured under; anything else invalidates it. */
	themeSig: string;
	outer: TableSnapshot<HTMLElement>['outer'];
	tbodyShadow: string | null;
	/** Per cell. A Map (not a WeakMap) so invalidating the table drops all of it
	 *  at once; it can't outlive the table, since every key is a descendant. */
	bits: Map<HTMLElement, Pick<CellSnapshot<HTMLElement>, 'themeShadow' | 'hasRealBorder'>>;
	/** The last plan actually written, for skipping an identical rewrite. */
	written: { key: string; refs: HTMLElement[] } | null;
}

const themeCache = new WeakMap<HTMLTableElement, ThemeCache>();

/**
 * Identifies the active theme cheaply. A theme switch applies instantly to the
 * DOM without a re-render (see the set-theme note in CLAUDE.md), so the same
 * table element can outlive the values measured under the old theme — without
 * this check the frozen region would keep painting the previous theme's frame.
 */
function themeSignature(table: HTMLTableElement): string {
	return table.closest<HTMLElement>('.bt-render-root')?.className ?? '';
}

/** Everything about a plan that matters to the DOM, as a comparable string. */
function planKey(plan: FreezePlan<HTMLElement>): string {
	return JSON.stringify([
		plan.table,
		plan.cells.map(c => [c.classes, c.vars, c.hideBorders, c.background, c.shadow]),
	]);
}

export function applyFreeze(table: HTMLTableElement, thead: HTMLElement, tbody: HTMLElement, model: TableModelV2): void {
	const { freezeRows, freezeCols } = resolveFreeze(model);
	const sig = themeSignature(table);
	let cache = themeCache.get(table);
	if (cache && cache.themeSig !== sig) cache = undefined; // theme changed → re-measure

	// A pass with no cache must CLEAR before it reads, so it measures the theme's
	// own values rather than this code's previous output. A cached pass reads no
	// theme value at all (they all come from the cache) and therefore doesn't need
	// to — it reads only geometry, which our writes never affect, since applyFreeze
	// changes no layout (asserted by the baseline e2e suite).
	//
	// Getting this split wrong is not hypothetical: an earlier version skipped the
	// clear on a cached pass while still reading the table's own border colour for
	// the frame line, so it measured the `transparent` it had written itself and
	// painted the frame in it. That reproduced as the table's outer border vanishing
	// during a column-width or row-height drag — the one situation where a pass
	// both reuses the cache and has a new geometry to write.
	if (!cache) clearFreeze(table);
	const snapshot = snapshotTable(table, thead, tbody, freezeRows, freezeCols, cache);
	const plan = planFreeze(snapshot, model);

	// IDEMPOTENCE. This runs from a ResizeObserver on every geometry-affecting
	// change and used to rewrite every inline style on every frozen cell each time
	// — measured at hundreds of style mutations on a SINGLE cell just from moving
	// the pointer across the table. Every one of those is a style recalc, and a
	// write visible to anything observing the table is exactly the fuel a
	// ResizeObserver feedback loop runs on; this codebase has already had one such
	// loop pin the main thread. With nothing to change there is nothing to gain
	// from writing, so the steady state is now a pure read.
	//
	// Element identity is compared too, not just values: after a table rebuild the
	// plan can be value-identical while every ref is a new element with none of it
	// applied.
	const key = planKey(plan);
	const refs = plan.cells.map(c => c.ref);
	const written = cache?.written;
	const unchanged = written !== null && written !== undefined
		&& written.key === key
		&& written.refs.length === refs.length
		&& written.refs.every((r, i) => r === refs[i]);

	if (!unchanged) {
		// Drop the previous pass's overrides first — a cell that is no longer frozen
		// has to lose them entirely, not just stop being updated.
		if (cache) clearFreeze(table);
		writePlan(table, plan);
	}

	const bits = new Map<HTMLElement, Pick<CellSnapshot<HTMLElement>, 'themeShadow' | 'hasRealBorder'>>();
	for (const cell of snapshot.cells) {
		bits.set(cell.ref, { themeShadow: cell.themeShadow, hasRealBorder: cell.hasRealBorder });
	}
	themeCache.set(table, {
		themeSig: sig,
		outer: snapshot.outer,
		tbodyShadow: snapshot.tbodyShadow,
		bits,
		written: unchanged ? written : { key, refs },
	});
}
