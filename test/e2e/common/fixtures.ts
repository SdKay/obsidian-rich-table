/**
 * Builds `rich-table` v2 source for tests, so a spec describes the SHAPE it
 * needs (how many columns, where the merges are, what's frozen) instead of
 * carrying a slab of YAML.
 *
 * Every spec here renders through the real `parseSource`, so the source it
 * feeds in has to be genuinely valid — including the `---` delimiters, which
 * `parseTable` requires and whose absence silently yields an empty model
 * (0 columns, 0 rows) that then renders as an empty table and passes any
 * assertion that doesn't check for content.
 */

export interface TableSpec {
	/**
	 * Column widths in px, in order. `id` is `c_<index>`, `name` is A, B, C…
	 * Pass 0 for a column to leave its width unset — a table with no widths at
	 * all is an AUTO-LAYOUT table, which is a materially different case: the
	 * browser derives every column width from content, so anything that changes a
	 * cell's box (padding, border width) changes measured geometry, whereas with
	 * explicit widths `table-layout: fixed` pins them and hides such a change.
	 */
	widths: number[];
	/**
	 * Per-column `type`, positional and sparse — `['', 'date']` types only the
	 * second column. A typed column renders through a completely different branch
	 * of renderDataCell (a date picker, or a choice pill with its own menu) rather
	 * than the plain text editor, so anything asserting on cell interaction needs
	 * to be able to ask for one.
	 */
	types?: (string | undefined)[];
	/**
	 * One entry per row, mapping column index → cell text. `id` is `r_<index>`.
	 * A row's omitted columns are empty.
	 */
	rows: Record<number, string>[];
	/** `[anchorRow, anchorCol, endRow, endCol]`, all 0-based DATA row indices. */
	merges?: [number, number, number, number][];
	/** `{ target, bg }` with target already in v2 grammar (e.g. `r_0.c_1`). */
	styles?: { target: string; bg: string }[];
	theme?: string;
	freezeRows?: number;
	freezeCols?: number;
	viewWidth?: number;
	viewHeight?: number;
	locked?: boolean;
}

export function tableSource(spec: TableSpec): string {
	const lines: string[] = ['---', 'version: 2', 'columns:'];
	spec.widths.forEach((w, i) => {
		const name = String.fromCharCode(65 + i);
		const parts = [`id: c_${i}`, `name: ${name}`];
		if (w > 0) parts.push(`width: ${w}`);
		const type = spec.types?.[i];
		if (type) parts.push(`type: ${type}`);
		lines.push(`  - { ${parts.join(', ')} }`);
	});
	lines.push('rows:');
	spec.rows.forEach((cells, i) => {
		const body = Object.entries(cells).map(([ci, text]) => `c_${ci}: ${text}`).join(', ');
		lines.push(`  - { id: r_${i}, cells: { ${body} } }`);
	});
	if (spec.merges?.length) {
		lines.push('merges:');
		for (const [ar, ac, er, ec] of spec.merges) {
			lines.push(`  - { anchor: r_${ar}.c_${ac}, end: r_${er}.c_${ec} }`);
		}
	}
	if (spec.styles?.length) {
		lines.push('styles:');
		for (const s of spec.styles) lines.push(`  - { target: "${s.target}", bg: "${s.bg}" }`);
	}
	for (const [key, value] of [
		['theme', spec.theme], ['freezeRows', spec.freezeRows], ['freezeCols', spec.freezeCols],
		['viewWidth', spec.viewWidth], ['viewHeight', spec.viewHeight], ['locked', spec.locked],
	] as const) {
		if (value !== undefined) lines.push(`${key}: ${value}`);
	}
	// The generated mirror below the front matter is never parsed back (see
	// CLAUDE.md), so a header-only stub is enough — but the delimiter itself is
	// required, hence this rather than omitting the block.
	lines.push('---', `| ${spec.widths.map((_, i) => String.fromCharCode(65 + i)).join(' | ')} |`,
		`| ${spec.widths.map(() => '---').join(' | ')} |`, '');
	return lines.join('\n');
}

/**
 * A table that is deliberately larger than its own view on both axes, so it
 * genuinely scrolls — without which a frozen cell's position:sticky never
 * engages and any assertion about the frozen region is vacuous.
 */
export function scrollableTable(extra: Partial<TableSpec> = {}): string {
	return tableSource({
		widths: [54, 44, 44, 44, 44, 44, 44, 44],
		rows: [
			{ 0: 'a1', 2: 'c1', 3: 'd1', 5: 'f1', 7: 'h1' },
			{ 0: 'a2', 1: 'b2', 4: 'e2', 6: 'g2' },
			{ 0: 'a3', 3: 'd3', 5: 'f3' },
			{ 0: 'a4', 2: 'c4', 4: 'e4', 7: 'h4' },
			{ 0: 'a5', 1: 'b5', 3: 'd5', 6: 'g5' },
			{ 0: 'a6', 2: 'c6', 5: 'f6', 7: 'h6' },
		],
		viewWidth: 190,
		viewHeight: 150,
		...extra,
	});
}

/**
 * An AUTO-LAYOUT scrollable table: no column widths at all, so the browser
 * derives them from content and any change to a cell's box shows up as changed
 * geometry. This is the configuration the freeze/resize ResizeObserver feedback
 * loop actually hung in, and the only one where a layout-invariance assertion
 * has teeth — with explicit widths, `table-layout: fixed` pins every column and
 * a padding or border-width change measures identical.
 */
export function autoLayoutTable(extra: Partial<TableSpec> = {}): string {
	const text = 'wide cell text';
	return tableSource({
		widths: [0, 0, 0, 0, 0, 0],
		rows: Array.from({ length: 6 }, (_, r) =>
			Object.fromEntries(Array.from({ length: 6 }, (_, c) => [c, `${text} r${r}c${c}`]))),
		viewWidth: 200,
		viewHeight: 150,
		...extra,
	});
}
