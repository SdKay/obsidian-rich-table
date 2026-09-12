import type { StructuralOpHandler } from './renderTypes';
import { ownCells, ownCols } from './renderOwnScope';

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

/**
 * Minimum column width any column may render at.
 *
 * A typed column used to reserve enough width for its WIDEST POSSIBLE option
 * label up front (~8px/char + 24px), regardless of what's actually shown —
 * reported as wasted, distracting padding around a short actual value (e.g.
 * "Done") in a column pre-sized for its type's longest label ("In
 * Progress"). Dropped in favor of starting every column at this same plain
 * floor and growing it reactively when a cell's value actually needs more
 * (see growColForChoiceValue below, called right where a choice cell's value
 * changes) — content that's actually there drives the width, not a
 * hypothetical worst case that may never occur in this table.
 */
export function colMinWidth(): number {
	return 40;
}

/**
 * Grows a choice column to fit the value a user just picked, if it's wider
 * than the column's current width — never shrinks. Called right after a
 * choice cell's pill is updated (renderCell.ts's menu `onClick`), reading
 * the pill's own already-updated `offsetWidth` synchronously (no need to
 * wait for the write-back/re-render round trip). Same measurement math as
 * autoFitAllColWidths's own pill branch, so a value that would trigger a
 * wider fit there triggers the same width here, just reactively instead of
 * on an explicit auto-fit action.
 *
 * A no-op for a column that's currently auto (col[data-auto], or no explicit
 * width at all because nothing in this table has one) — writing a width here
 * would turn it into a genuinely fixed column, when the point of "auto" is
 * that it doesn't need this reactive nudge at all: the next render's own
 * measurement pass (applyAutoColWidths) or, in an all-auto table, the
 * browser's own native table-layout:auto already picks up the wider pill on
 * its own.
 */
export function growColForChoiceValue(cellEl: HTMLElement, colId: string, pill: HTMLElement, onStructuralOp: StructuralOpHandler): void {
	const table = cellEl.closest('table');
	const colIdxAttr = cellEl.dataset.col;
	if (!table || colIdxAttr === undefined) return;
	const colEl = table.querySelector<HTMLElement>(`col[data-col="${colIdxAttr}"]`);
	// table-layout:fixed only gets set when at least one column has an explicit
	// width (renderer.ts's hasExplicitWidths) — an all-auto table stays plain
	// table-layout:auto and needs no help from here either.
	if (!colEl || colEl.dataset.auto || (table as HTMLElement).style.tableLayout !== 'fixed') return;

	const currentWidth = parseInt(colEl.style.width) || cellEl.getBoundingClientRect().width;
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
 * Auto-fit every column's width in one pass. Measures each cell in place: toggles
 * white-space:nowrap on its content to get the intrinsic single-line width, then
 * restores it. Interleaving those writes and reads across every cell in every
 * column would force one synchronous layout per cell (classic layout thrashing),
 * which gets dramatically slower under heavy theme CSS (animations, gradients,
 * filters make every forced layout more expensive) — so this is strictly phased
 * instead: add every nowrap class first, read every width in one batch, then
 * remove every class, so the browser only needs one layout pass for the whole
 * table regardless of how many columns/cells are involved.
 */
export function autoFitAllColWidths(
	tbl: HTMLElement,
	cols: { colIdx: number; minW: number }[],
): Map<number, number> {
	const results = new Map<number, number>();
	for (const { colIdx, minW } of cols) results.set(colIdx, minW);

	const pills:        { colIdx: number; el: HTMLElement }[] = [];
	const medias:       { colIdx: number; el: HTMLElement }[] = [];
	const textSpans:    { colIdx: number; el: HTMLElement }[] = [];
	const nowrapEls:    { colIdx: number; el: HTMLElement }[] = [];
	const nestedTables: { colIdx: number; el: HTMLElement }[] = [];

	// Phase 1 — classify cells and apply the one write each nowrap target needs. No reads yet.
	for (const { colIdx } of cols) {
		const cells = ownCells(tbl).filter(e => e.dataset.col === String(colIdx));
		for (const cell of cells) {
			if ((cell.tagName === 'TD' || cell.tagName === 'TH') && (cell as HTMLTableCellElement).colSpan > 1) continue;

			// A nested rich-table block, rendered as its own .bt-render-root — its
			// .bt-table-wrapper has `max-width: 100%` (styles.css), capping its own
			// offsetWidth/clientWidth down to whatever the OUTER cell already
			// happens to be, so either would just measure the cap and never grow
			// the column to fit. scrollWidth is the wrapper's true content width
			// regardless of that cap. Checked before the header-text/pill/media
			// branches below — a nested table has its own header text/pills/svg
			// deep inside it that would otherwise satisfy one of those branches
			// first and measure just that one inner piece. No write needed here:
			// scrollWidth isn't affected by white-space, so nothing to toggle.
			const nestedWrapper = cell.querySelector<HTMLElement>('.bt-render-root .bt-table-wrapper');
			if (nestedWrapper) { nestedTables.push({ colIdx, el: nestedWrapper }); continue; }

			// Header cell text span — checked BEFORE pill/media below: a header
			// cell's own SVG icons (the filter button, the live-sort indicator)
			// would otherwise match the
			// media check first and get measured instead of the actual header
			// text, capping the "fit" at whatever tiny width an icon has. Force
			// nowrap before reading offsetWidth below — if the column is already
			// too narrow, the header text is already wrapped, and offsetWidth on
			// a wrapped inline span reports the widest wrapped line, not the
			// text's true natural width.
			const textSpan = cell.querySelector<HTMLElement>('.bt-th-text');
			if (textSpan) { textSpan.addClass('bt-nowrap-measure'); textSpans.push({ colIdx, el: textSpan }); continue; }
			const pill = cell.querySelector<HTMLElement>('.bt-choice');
			if (pill) { pills.push({ colIdx, el: pill }); continue; }
			// Rendered diagram/embed (mermaid/plantuml, an inline <svg> with its own
			// width/viewBox — a <canvas>-based renderer looks the same here). These
			// size themselves from their own attributes, not text flow: forcing
			// white-space:nowrap on an ancestor (the generic text branch below)
			// does nothing for them. No write needed here either: unlike text, an
			// svg/canvas's own box isn't affected by white-space, so nothing to
			// toggle. Data cells only — a header cell never reaches here, having
			// already continued above.
			const media = cell.querySelector<HTMLElement>('svg, canvas');
			if (media) { medias.push({ colIdx, el: media }); continue; }
			const text = cell.textContent?.trim() ?? '';
			if (!text) continue;
			const pEls = Array.from(cell.querySelectorAll<HTMLElement>('p'));
			const targets = pEls.length > 0 ? pEls : [cell];
			for (const target of targets) {
				target.addClass('bt-nowrap-measure');
				nowrapEls.push({ colIdx, el: target });
			}
		}
	}

	// Phase 2 — read everything. No writes are interleaved here, so the browser
	// computes layout once (lazily, on the first read below) and reuses it for the rest.
	const view = activeDocument.defaultView;
	const grow = (colIdx: number, w: number) => {
		results.set(colIdx, Math.max(results.get(colIdx) ?? 0, w));
	};
	const padBorder = (cell: HTMLElement) => {
		const style = view ? view.getComputedStyle(cell) : null;
		return {
			padH:    style ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) : 24,
			borderH: style ? parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) : 2,
		};
	};
	for (const { colIdx, el } of nestedTables) {
		const { padH, borderH } = padBorder(el.closest<HTMLElement>('td, th') ?? el);
		grow(colIdx, el.scrollWidth + padH + borderH);
	}
	for (const { colIdx, el } of pills) {
		const { padH, borderH } = padBorder(el.closest<HTMLElement>('td, th') ?? el);
		grow(colIdx, el.offsetWidth + PILL_MEASURE_BUFFER + padH + borderH);
	}
	for (const { colIdx, el } of medias) {
		const { padH, borderH } = padBorder(el.closest<HTMLElement>('td, th') ?? el);
		grow(colIdx, el.getBoundingClientRect().width + padH + borderH);
	}
	for (const { colIdx, el } of textSpans) {
		const { padH, borderH } = padBorder(el.closest<HTMLElement>('td, th') ?? el);
		// Buffer by one letter-spacing unit — engines don't consistently include
		// the trailing letter-spacing after the last character in the measured
		// width, so a theme with non-zero letter-spacing (e.g. plain's bold
		// header text) can measure a hair short of what's actually needed.
		const style = view ? view.getComputedStyle(el) : null;
		const letterSpacing = style ? parseFloat(style.letterSpacing) || 0 : 0;
		grow(colIdx, el.offsetWidth + letterSpacing + padH + borderH);
	}
	for (const { colIdx, el } of nowrapEls) {
		const { padH, borderH } = padBorder(el.closest<HTMLElement>('td, th') ?? el);
		const range = activeDocument.createRange();
		range.selectNodeContents(el);
		const rw = range.getBoundingClientRect().width;
		if (rw > 0) grow(colIdx, rw + padH + borderH);
	}

	// Phase 3 — cleanup writes.
	for (const { el } of nowrapEls) el.removeClass('bt-nowrap-measure');
	for (const { el } of textSpans) el.removeClass('bt-nowrap-measure');

	for (const [colIdx, w] of results) results.set(colIdx, Math.ceil(w));
	return results;
}

/**
 * Pins every column the renderer left unmeasured (col[data-auto], set in
 * renderer.ts's colgroup build — a column with no width of its own,
 * coexisting with a sibling that DOES have one, so the whole table is
 * table-layout:fixed and every <col> needs an explicit px width) to its own
 * actual current content width, and corrects the table's overall width to
 * match. Must run after the table is attached to a live, painted document —
 * autoFitAllColWidths reads real layout (offsetWidth/getBoundingClientRect),
 * which a still-detached or not-yet-reflowed table can't provide — see
 * tableBlock.ts's render(), which calls this right after its own atomic
 * DOM swap and forced reflow.
 *
 * The data-auto marker is intentionally NOT removed after measuring: this
 * whole <colgroup> is rebuilt from scratch on every render (freshly derived
 * from the model's current column widths each time), and growColForChoiceValue
 * (above) needs to keep telling an auto column apart from a genuinely fixed
 * one for as long as this particular rendered table lives, not just up to
 * the first measurement.
 *
 * A no-op when nothing is marked — the common case, since an all-auto table
 * (no column has an explicit width at all) never sets table-layout:fixed in
 * the first place and needs no help from here; native table-layout:auto
 * already tracks content on its own, for free.
 */
export function applyAutoColWidths(table: HTMLElement): void {
	const autoCols = Array.from(table.querySelectorAll<HTMLElement>('col[data-auto]'))
		.map(colEl => ({ colEl, colIdx: parseInt(colEl.dataset.col ?? '-1') }))
		.filter((c): c is { colEl: HTMLElement; colIdx: number } => c.colIdx >= 0);
	if (autoCols.length === 0) return;

	const fits = autoFitAllColWidths(table, autoCols.map(c => ({ colIdx: c.colIdx, minW: colMinWidth() })));
	for (const { colEl, colIdx } of autoCols) {
		colEl.style.setProperty('width', `${fits.get(colIdx) ?? colMinWidth()}px`);
	}

	const totalWidth = Array.from(table.querySelectorAll<HTMLElement>('col'))
		.reduce((sum, c) => sum + (parseInt(c.style.width) || 0), 0);
	table.style.setProperty('width', `${totalWidth}px`);
}

/** A column's right edge, in px offset from the table's own left border edge, summing <col> widths in DOM order. */
export function colRightX(tbl: HTMLElement, colIdx: number): number {
	let x = 0;
	for (const c of ownCols(tbl)) {
		x += parseInt(c.style.width) || 0;
		if (c.dataset.col !== undefined && parseInt(c.dataset.col) === colIdx) break;
	}
	return x;
}
