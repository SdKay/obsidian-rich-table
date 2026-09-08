import type { StructuralOpHandler } from './renderTypes';

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
 * autoFitColWidth's own pill branch, so a value that would trigger a wider
 * fit there triggers the same width here, just reactively instead of on an
 * explicit auto-fit action.
 */
export function growColForChoiceValue(cellEl: HTMLElement, colId: string, pill: HTMLElement, onStructuralOp: StructuralOpHandler): void {
	const table = cellEl.closest('table');
	const colIdxAttr = cellEl.dataset.col;
	if (!table || colIdxAttr === undefined) return;
	const colEl = table.querySelector<HTMLElement>(`col[data-col="${colIdxAttr}"]`);
	if (!colEl) return;

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
 * Auto-fit a column's width to the widest content among its cells. Measures each
 * cell in place: toggles white-space:nowrap on its content to get the intrinsic
 * single-line width, then restores it. For a single column this read-after-write
 * per cell is cheap; auto-fitting every column at once uses autoFitAllColWidths
 * instead, which batches the same measurement to avoid forcing a reflow per cell.
 */
export function autoFitColWidth(tbl: HTMLElement, colIdx: number, minW: number): number {
	const cells = Array.from(tbl.querySelectorAll<HTMLElement>(`[data-col="${colIdx}"]`));
	if (cells.length === 0) return minW;

	let max = minW;
	for (const cell of cells) {
		// Skip cells that span multiple columns — their content is shared across columns
		// and would inflate the auto-fit width of just this one column.
		if (cell.tagName === 'TD' || cell.tagName === 'TH') {
			if ((cell as HTMLTableCellElement).colSpan > 1) continue;
		}

		const view = activeDocument.defaultView;
		const style = view ? view.getComputedStyle(cell) : null;
		// Horizontal padding of the cell
		const padH = style
			? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
			: 24;
		// Border width contribution (border-collapse: collapse, ~1px each side)
		const borderH = style
			? parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)
			: 2;

		// 1. Header cell: measure the inline text span (not the cell itself), and
		//    do this BEFORE the pill/media checks below — checked first
		//    specifically because it's unambiguous (only a header cell ever has
		//    .bt-th-text) and because a header cell also carries its own SVG
		//    icons (the filter button, the live-sort indicator), which the
		//    media check below would otherwise match FIRST and measure instead
		//    of the header's actual text — reported as double-click auto-fit
		//    doing nothing on a real column: the filter icon's few px, plus
		//    padding, never exceeded the column's existing/minimum width, so
		//    the "fit" came out identical to what was already there. Never
		//    reproduced in this repo's own e2e suite because its setIcon() shim
		//    only sets a data-icon attribute, never a real <svg> — see
		//    obsidian-shim.ts.
		//    cell.scrollWidth == clientWidth == current column width for table-cell
		//    elements — useless. The inline span's offsetWidth is the actual text width —
		//    but only once it's forced to one line first: if the column is already too
		//    narrow, the header text is already wrapped, and offsetWidth on a wrapped
		//    inline span reports the widest wrapped line, not the text's true natural
		//    width, which would just confirm the too-narrow width forever.
		const textSpan = cell.querySelector<HTMLElement>('.bt-th-text');
		if (textSpan) {
			textSpan.addClass('bt-nowrap-measure');
			const w = textSpan.offsetWidth;
			textSpan.removeClass('bt-nowrap-measure');
			// Buffer by one letter-spacing unit — engines don't consistently include the
			// trailing letter-spacing after the last character in the measured width, so a
			// theme with non-zero letter-spacing (e.g. plain's bold header text) can measure
			// a hair short of what's actually needed to avoid wrapping.
			const spanStyle = view ? view.getComputedStyle(textSpan) : null;
			const letterSpacing = spanStyle ? parseFloat(spanStyle.letterSpacing) || 0 : 0;
			max = Math.max(max, w + letterSpacing + padH + borderH);
			continue;
		}

		// 2. Typed cell: pill is inline-flex with white-space:nowrap;
		//    offsetWidth is the natural pill width regardless of cell clipping.
		const pill = cell.querySelector<HTMLElement>('.bt-choice');
		if (pill) {
			max = Math.max(max, pill.offsetWidth + PILL_MEASURE_BUFFER + padH + borderH);
			continue;
		}

		// 2b. Rendered diagram/embed (e.g. a mermaid/plantuml code block, which
		//     renders to an inline <svg> with its own width/viewBox — a <canvas>-
		//     based renderer looks the same to auto-fit). These size themselves
		//     from their own attributes, not text flow: forcing white-space:nowrap
		//     on an ancestor (the generic text branch below) does nothing for them,
		//     and measuring via Range.getBoundingClientRect() is unreliable once the
		//     range crosses into SVG's separate DOM namespace. Read the element's
		//     own rendered box directly instead. Data cells only — a header cell
		//     never reaches here, having already continued above.
		const media = cell.querySelector<HTMLElement>('svg, canvas');
		if (media) {
			max = Math.max(max, media.getBoundingClientRect().width + padH + borderH);
			continue;
		}

		// 3. Data cell with text: measure natural single-line width.
		//    Two compounding problems:
		//    a) Selecting the cell itself returns the block <p>'s layout width (= cell width).
		//       Fix: select the *contents* of each <p> (inline nodes only).
		//    b) If text is already wrapping, inline line-boxes span the full content area,
		//       so their union rect width still equals the cell width — no auto-fit effect.
		//       Fix: temporarily set white-space:nowrap on the <p> to collapse to one line,
		//       measure the natural width, then restore.
		const text = cell.textContent?.trim() ?? '';
		if (text) {
			const pEls = Array.from(cell.querySelectorAll<HTMLElement>('p'));
			const targets: HTMLElement[] = pEls.length > 0 ? pEls : [cell];
			for (const target of targets) {
				target.addClass('bt-nowrap-measure');
				const range = activeDocument.createRange();
				range.selectNodeContents(target);
				const rw = range.getBoundingClientRect().width;
				target.removeClass('bt-nowrap-measure');
				if (rw > 0) max = Math.max(max, rw + padH + borderH);
			}
		}
		// Empty data cell: skip — its scrollWidth == current cell width,
		// using it would cause the column to grow on every double-click.
	}
	return Math.ceil(max);
}

/**
 * Auto-fit every column's width in one pass. autoFitColWidth measures a single column
 * by toggling white-space:nowrap and reading the result per cell — interleaving those
 * writes and reads across every cell in every column forces one synchronous layout per
 * cell (classic layout thrashing), which gets dramatically slower under heavy theme CSS
 * (animations, gradients, filters make every forced layout more expensive). This does
 * the same measurement but strictly phased — add every nowrap class first, read every
 * width in one batch, then remove every class — so the browser only needs one layout
 * pass for the whole table instead of one per cell.
 */
export function autoFitAllColWidths(
	tbl: HTMLElement,
	cols: { colIdx: number; minW: number }[],
): Map<number, number> {
	const results = new Map<number, number>();
	for (const { colIdx, minW } of cols) results.set(colIdx, minW);

	const pills:      { colIdx: number; el: HTMLElement }[] = [];
	const medias:     { colIdx: number; el: HTMLElement }[] = [];
	const textSpans:  { colIdx: number; el: HTMLElement }[] = [];
	const nowrapEls:  { colIdx: number; el: HTMLElement }[] = [];

	// Phase 1 — classify cells and apply the one write each nowrap target needs. No reads yet.
	for (const { colIdx } of cols) {
		const cells = Array.from(tbl.querySelectorAll<HTMLElement>(`[data-col="${colIdx}"]`));
		for (const cell of cells) {
			if ((cell.tagName === 'TD' || cell.tagName === 'TH') && (cell as HTMLTableCellElement).colSpan > 1) continue;

			// Header cell text span — checked BEFORE pill/media below, and for the
			// same reason autoFitColWidth does: a header cell's own SVG icons (the
			// filter button, the live-sort indicator) would otherwise match the
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
			// Rendered diagram/embed (mermaid/plantuml) — see autoFitColWidth's own
			// comment for why this needs its own branch instead of the generic
			// nowrap+Range text path below. No write needed: unlike text, an svg/
			// canvas's own box isn't affected by white-space, so nothing to toggle.
			// Data cells only — a header cell never reaches here, having already
			// continued above.
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
		// Buffer by one letter-spacing unit — see autoFitColWidth's header-cell comment.
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

/** A column's right edge, in px offset from the table's own left border edge, summing <col> widths in DOM order. */
export function colRightX(tbl: HTMLElement, colIdx: number): number {
	let x = 0;
	for (const c of Array.from(tbl.querySelectorAll<HTMLElement>('col'))) {
		x += parseInt(c.style.width) || 0;
		if (c.dataset.col !== undefined && parseInt(c.dataset.col) === colIdx) break;
	}
	return x;
}

/** Auto-fit a row's height to its content by measuring cells without a forced height. */
export function autoFitRowHeight(tbl: HTMLElement, rowIdx: number, minH: number): number {
	const cells = Array.from(tbl.querySelectorAll<HTMLElement>(`[data-row="${rowIdx}"]`));
	if (cells.length === 0) return minH;
	// Exclude rowspan > 1 cells: their offsetHeight spans multiple rows so measuring
	// them would inflate the single-row height (same guard as bindResizeHandle).
	const single = cells.filter(c => (c as HTMLTableCellElement).rowSpan <= 1);
	const targets = single.length > 0 ? single : cells;
	// Temporarily clear the forced height so cells collapse to content, measure, restore.
	const saved = cells.map(c => c.style.getPropertyValue('--bt-row-height'));
	cells.forEach(c => c.style.removeProperty('--bt-row-height'));
	let max = minH;
	for (const c of targets) max = Math.max(max, c.offsetHeight);
	cells.forEach((c, i) => { const s = saved[i]; if (s) c.style.setProperty('--bt-row-height', s); });
	return Math.ceil(max);
}
