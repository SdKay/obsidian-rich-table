/**
 * v2 serializer.
 *
 * Outputs YAML front-matter only (deterministic — fixed field order,
 * stringifyYaml). The YAML is the sole data source; there is no generated
 * pipe-table mirror below it (removed — see "Backward compatibility" in
 * CLAUDE.md: `parseTable`'s `extractFrontmatter` only ever reads up to the
 * closing `---`, so an EXISTING note that still has a mirror below that line
 * keeps parsing exactly as before — the next write-back simply drops it).
 */

import { stringifyYaml } from 'obsidian';
import type { SheetDefV2, TableModelV2, WorkbookV3 } from './model';

export function serializeTable(model: TableModelV2): string {
	const obj: Record<string, unknown> = { version: 2, ...serializeModelFields(model) };
	return ['---', stringifyYaml(obj).trimEnd(), '---', ''].join('\n');
}

/**
 * Serializes a multi-sheet workbook — same YAML-only shape as `serializeTable`,
 * one level up (a `sheets:` array of per-sheet field sets instead of a single
 * set at the top level). Determinism (parse→serialize→parse→serialize
 * byte-stable, same Principle-3 guarantee `test/v2.roundtrip.test.ts` already
 * checks for single-sheet tables) is what keeps re-serializing every sheet on
 * every write-back safe — editing one sheet never perturbs another sheet's
 * YAML text, because `serializeModelFields`/`stringifyYaml` produce the same
 * output for the same data regardless of what else is in the array.
 */
export function serializeWorkbook(workbook: WorkbookV3): string {
	const obj: Record<string, unknown> = { version: 3 };
	if (workbook.title) obj.title = workbook.title;
	obj.active_sheet = workbook.activeSheetId;
	obj.sheets = workbook.sheets.map(serializeSheet);
	return ['---', stringifyYaml(obj).trimEnd(), '---', ''].join('\n');
}

function serializeSheet(sheet: SheetDefV2): Record<string, unknown> {
	const entry: Record<string, unknown> = { id: sheet.id };
	if (sheet.name) entry.name = sheet.name;
	if (sheet.tabColor) entry.tabColor = sheet.tabColor;
	if (sheet.tabTextColor) entry.tabTextColor = sheet.tabTextColor;
	Object.assign(entry, serializeModelFields(sheet));
	return entry;
}

// ── YAML block ────────────────────────────────────────────────────────────────

/** Builds every field of a single sheet's model EXCEPT `version` — shared by
 *  `serializeTable` (top-level object) and `serializeSheet` (one `sheets[]`
 *  entry) since a sheet's own data is exactly a single-sheet v2 table's data. */
function serializeModelFields(m: TableModelV2): Record<string, unknown> {
	const obj: Record<string, unknown> = {};

	if (m.title)   obj.title   = m.title;

	obj.columns = m.columns.map(c => {
		const entry: Record<string, unknown> = { id: c.id, name: c.name };
		if (c.hidden)  entry.hidden = true;
		if (c.type)    entry.type   = c.type;
		if (c.width)   entry.width  = c.width;
		if (c.align)   entry.align  = c.align;
		if (c.filter && c.filter.length > 0) entry.filter = c.filter;
		return entry;
	});

	obj.rows = m.rows.map(r => {
		const entry: Record<string, unknown> = { id: r.id };
		if (r.hidden)           entry.hidden = true;
		if (r.height && r.height > 0) entry.height = r.height;
		// Cells: only store non-empty values (sparse)
		const cells: Record<string, string> = {};
		for (const col of m.columns) {
			const v = r.cells[col.id] ?? '';
			if (v !== '') cells[col.id] = v;
		}
		entry.cells = cells;
		if (r.formulas && Object.keys(r.formulas).length > 0) entry.formulas = r.formulas;
		return entry;
	});

	if (m.merges.length > 0) {
		obj.merges = m.merges.map(mg => ({ anchor: mg.anchor, end: mg.end }));
	}

	if (m.styles.length > 0) {
		obj.styles = m.styles.map(s => {
			const e: Record<string, unknown> = { target: s.target };
			if (s.bg)     e.bg     = s.bg;
			if (s.color)  e.color  = s.color;
			if (s.bold)   e.bold   = true;
			if (s.italic) e.italic = true;
			if (s.size)   e.size   = s.size;
			return e;
		});
	}

	if (m.footer) obj.footer = m.footer;
	if (m.theme)  obj.theme  = m.theme;
	if (m.locked) obj.locked = true;
	if (m.collapsed) obj.collapsed = true;
	if (m.sort) obj.sort = { colId: m.sort.colId, dir: m.sort.dir };
	if (m.aggregate && m.aggregate.length > 0) obj.aggregate = m.aggregate;
	if (typeof m.freezeRows === 'number') obj.freezeRows = m.freezeRows;
	if (typeof m.freezeCols === 'number') obj.freezeCols = m.freezeCols;
	if (typeof m.viewWidth === 'number') obj.viewWidth = m.viewWidth;
	if (typeof m.viewHeight === 'number') obj.viewHeight = m.viewHeight;
	if (m.statusBarMode) obj.statusBarMode = m.statusBarMode;
	if (typeof m.statusBarScrollWidth === 'number') obj.statusBarScrollWidth = m.statusBarScrollWidth;
	if (m.views && m.views.length > 0) {
		obj.views = m.views.map(v => {
			const e: Record<string, unknown> = { id: v.id, type: v.type };
			// Absent = derive the display name from the column header at render
			// time — only written once the user explicitly renames the view.
			if (v.name) e.name = v.name;
			if (v.kanban) e.kanban = { groupByColId: v.kanban.groupByColId };
			if (v.calendar) e.calendar = { dateColId: v.calendar.dateColId };
			return e;
		});
		// Only meaningful alongside the views[] entries above.
		if (m.activeViewId) obj.activeViewId = m.activeViewId;
	}

	return obj;
}

// ── Markdown pipe-row formatting ────────────────────────────────────────────
// No longer used to build a mirror of the whole table (removed — see the file
// header comment); kept because "copy selection as Markdown"
// (renderClipboard.ts's copyRangeAsMarkdown) formats an arbitrary cell range
// into the same aligned-pipe-table shape.

/** Exported for reuse by the "copy as Markdown" clipboard action in renderer.ts. */
export function formatRow(cells: string[], widths: number[]): string {
	return '| ' + cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join(' | ') + ' |';
}

export function displayLen(s: string): number {
	// Rough CJK width estimate (each CJK char ≈ 2 monospace units)
	let len = 0;
	for (const ch of s) {
		len += ch.charCodeAt(0) > 0x2e7f ? 2 : 1;
	}
	return len;
}
