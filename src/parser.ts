/**
 * v2 parser.  Reads ONLY the YAML front-matter; the pipe table mirror is
 * completely ignored (it is a generated read-only artifact).
 */

import { parseYaml } from 'obsidian';
import type {
	AggType,
	ColumnDefV2,
	MergeRangeV2,
	RowDefV2,
	SheetDefV2,
	StyleRuleV2,
	TableModelV2,
	ViewDefV2,
	WorkbookV3,
} from './model';
import { genId } from './idGen';

const AGG_TYPES: AggType[] = ['sum', 'avg', 'min', 'max', 'count'];

export function parseTable(source: string): TableModelV2 {
	const yaml = extractFrontmatter(source);
	return { version: 2, ...parseModelFields(yaml) };
}

/**
 * Parses the fields a single sheet's model is made of — everything
 * `TableModelV2` has except `version` itself. Shared by `parseTable` (reads
 * these fields from the top-level YAML object) and `parseWorkbook` (reads the
 * exact same fields from each entry of `sheets[]`) — a sheet's own data is
 * structurally identical to a single-sheet v2 table's, so there is nothing
 * multi-sheet-specific to special-case here.
 */
function parseModelFields(yaml: Record<string, unknown> | null): Omit<TableModelV2, 'version'> {
	const columns = parseColumns(yaml?.columns);
	const rows    = parseRows(yaml?.rows);
	const sort    = parseSort(yaml?.sort);
	const aggregate = parseAggregate(yaml?.aggregate);
	const views   = parseViews(yaml?.views);
	const freezeRows = parseFreezeCount(yaml?.freezeRows);
	const freezeCols = parseFreezeCount(yaml?.freezeCols);
	const viewWidth  = parseViewSize(yaml?.viewWidth);
	const viewHeight = parseViewSize(yaml?.viewHeight);

	return {
		columns,
		rows,
		merges:   parseMerges(yaml?.merges),
		styles:   parseStyles(yaml?.styles),
		...(typeof yaml?.title === 'string' ? { title: yaml.title } : {}),
		...(yaml?.footer ? { footer: parseFooter(yaml.footer) } : {}),
		...(typeof yaml?.theme === 'string' ? { theme: yaml.theme } : {}),
		...(yaml?.locked === true ? { locked: true } : {}),
		...(yaml?.collapsed === true ? { collapsed: true } : {}),
		...(sort ? { sort } : {}),
		...(aggregate.length > 0 ? { aggregate } : {}),
		...(views.length > 0 ? { views } : {}),
		...(freezeRows !== undefined ? { freezeRows } : {}),
		...(freezeCols !== undefined ? { freezeCols } : {}),
		...(viewWidth  !== undefined ? { viewWidth }  : {}),
		...(viewHeight !== undefined ? { viewHeight } : {}),
		// Only meaningful alongside a matching views[] entry — an activeViewId
		// pointing nowhere behaves exactly like it being absent (default table).
		...(typeof yaml?.activeViewId === 'string' && views.some(v => v.id === yaml.activeViewId)
			? { activeViewId: yaml.activeViewId } : {}),
	};
}

/**
 * Parses the multi-sheet workbook shape (`sheets:` array in the front
 * matter) — returns `null` when the source isn't in this shape at all (no
 * `sheets` array, or an empty one), which is exactly the structural signal
 * `parseSource` uses to fall back to the plain single-sheet `parseTable`
 * path. A v2 single-sheet table's front matter has `columns`/`rows` directly
 * and no `sheets` field, so the two shapes never collide.
 */
export function parseWorkbook(source: string): WorkbookV3 | null {
	const yaml = extractFrontmatter(source);
	if (!yaml || !Array.isArray(yaml.sheets) || yaml.sheets.length === 0) return null;

	const existingIds = new Set<string>();
	const sheets = yaml.sheets
		.map(raw => parseSheet(raw, existingIds))
		.filter((s): s is SheetDefV2 => s !== null);
	if (sheets.length === 0) return null;

	const activeSheetId = typeof yaml.active_sheet === 'string' && sheets.some(s => s.id === yaml.active_sheet)
		? yaml.active_sheet
		: sheets[0]!.id; // a workbook always has SOME active sheet — no "default" to fall back to

	return {
		version: 3,
		...(typeof yaml.title === 'string' ? { title: yaml.title } : {}),
		activeSheetId,
		sheets,
	};
}

/**
 * Parses one `sheets[]` entry. A malformed entry (not an object, or missing
 * `id`) is dropped silently rather than failing the whole workbook — same
 * "one bad entry doesn't take down the rest" leniency `parseColumns`/
 * `parseRows`/etc. already apply to their own array elements. A DUPLICATE id
 * (two sheets sharing one id, e.g. from hand-editing) is silently
 * re-generated rather than rejected outright — consistent with this
 * codebase's existing "clear/fix the problem, don't refuse to render over a
 * fixable issue" precedent (dangling activeViewId, dangling kanban/calendar
 * column refs).
 */
function parseSheet(raw: unknown, existingIds: Set<string>): SheetDefV2 | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const v = raw as Record<string, unknown>;
	if (typeof v.id !== 'string') return null;
	const id = existingIds.has(v.id) ? genId('s', existingIds) : v.id;
	existingIds.add(id);

	const sheet: SheetDefV2 = { id, version: 2, ...parseModelFields(v) };
	if (typeof v.name === 'string') sheet.name = v.name;
	if (typeof v.tabColor === 'string') sheet.tabColor = v.tabColor;
	if (typeof v.tabTextColor === 'string') sheet.tabTextColor = v.tabTextColor;
	return sheet;
}

/** Single entry point for tableBlock.ts: dispatches to the workbook parser or
 *  the plain single-sheet parser based on which shape the source is actually
 *  in — see `parseWorkbook`'s doc comment for the structural detection rule. */
export function parseSource(source: string): TableModelV2 | WorkbookV3 {
	return parseWorkbook(source) ?? parseTable(source);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractFrontmatter(source: string): Record<string, unknown> | null {
	const lines = source.split('\n');
	if (lines[0]?.trim() !== '---') return null;
	const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
	if (closeIdx === -1) return null;
	const yamlStr = lines.slice(1, closeIdx).join('\n');
	return (parseYaml(yamlStr) as Record<string, unknown>) ?? null;
}

function parseColumns(raw: unknown): ColumnDefV2[] {
	if (!Array.isArray(raw)) return [];
	return raw.map(item => {
		if (typeof item !== 'object' || item === null) return null;
		const c = item as Record<string, unknown>;
		if (typeof c.id !== 'string' || typeof c.name !== 'string') return null;
		const col: ColumnDefV2 = { id: c.id, name: c.name };
		if (c.hidden === true)                                   col.hidden = true;
		if (typeof c.type  === 'string')                         col.type   = c.type;
		if (typeof c.width === 'number')                         col.width  = c.width;
		if (c.align === 'left' || c.align === 'center' || c.align === 'right') col.align = c.align;
		if (Array.isArray(c.filter))                             col.filter = c.filter.map(v => String(v));
		return col;
	}).filter((c): c is ColumnDefV2 => c !== null);
}

function parseRows(raw: unknown): RowDefV2[] {
	if (!Array.isArray(raw)) return [];
	return raw.map(item => {
		if (typeof item !== 'object' || item === null) return null;
		const r = item as Record<string, unknown>;
		if (typeof r.id !== 'string') return null;
		const cells: Record<string, string> = {};
		if (typeof r.cells === 'object' && r.cells !== null) {
			for (const [k, v] of Object.entries(r.cells as Record<string, unknown>)) {
				cells[k] = typeof v === 'string' ? v : (v == null ? '' : JSON.stringify(v));
			}
		}
		const row: RowDefV2 = { id: r.id, cells };
		if (r.hidden === true)          row.hidden = true;
		if (typeof r.height === 'number' && r.height > 0) row.height = r.height;
		return row;
	}).filter((r): r is RowDefV2 => r !== null);
}

function parseMerges(raw: unknown): MergeRangeV2[] {
	if (!Array.isArray(raw)) return [];
	return raw.map(item => {
		if (typeof item !== 'object' || item === null) return null;
		const m = item as Record<string, unknown>;
		if (typeof m.anchor !== 'string' || typeof m.end !== 'string') return null;
		return { anchor: m.anchor, end: m.end };
	}).filter((m): m is MergeRangeV2 => m !== null);
}

function parseStyles(raw: unknown): StyleRuleV2[] {
	if (!Array.isArray(raw)) return [];
	return raw.map(item => {
		if (typeof item !== 'object' || item === null) return null;
		const s = item as Record<string, unknown>;
		if (typeof s.target !== 'string') return null;
		const rule: StyleRuleV2 = { target: s.target };
		if (typeof s.bg    === 'string')  rule.bg    = s.bg;
		if (typeof s.color === 'string')  rule.color = s.color;
		if (s.bold   === true)            rule.bold   = true;
		if (s.italic === true)            rule.italic = true;
		if (typeof s.size  === 'number')  rule.size  = s.size;
		return rule;
	}).filter((r): r is StyleRuleV2 => r !== null);
}

function parseFooter(raw: unknown): string | string[] {
	if (typeof raw === 'string') return raw;
	if (Array.isArray(raw)) return raw.map(l => String(l));
	return String(raw);
}

function parseSort(raw: unknown): { colId: string; dir: 'asc' | 'desc' } | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const s = raw as Record<string, unknown>;
	if (typeof s.colId !== 'string') return null;
	if (s.dir !== 'asc' && s.dir !== 'desc') return null;
	return { colId: s.colId, dir: s.dir };
}

function parseAggregate(raw: unknown): AggType[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter((v): v is AggType => AGG_TYPES.includes(v as AggType));
}

/** Shape-only validation (non-negative integer) — matches this parser's own
 *  convention elsewhere of not cross-checking against other fields (e.g.
 *  parseSort never checks colId still names a real column either); whether
 *  a given count would split a merge is the reducer/render layer's concern
 *  (see canFreezeRows/canFreezeCols, operations.ts), not the parser's. */
function parseFreezeCount(raw: unknown): number | undefined {
	return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : undefined;
}

// Manual view width/height in px — a positive finite number, else undefined
// (= auto). Rounded to an integer so a dragged fractional value serializes cleanly.
function parseViewSize(raw: unknown): number | undefined {
	return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : undefined;
}

function parseViews(raw: unknown): ViewDefV2[] {
	if (!Array.isArray(raw)) return [];
	return raw.map(item => {
		if (typeof item !== 'object' || item === null) return null;
		const v = item as Record<string, unknown>;
		if (typeof v.id !== 'string') return null;
		if (v.type !== 'table' && v.type !== 'kanban' && v.type !== 'calendar') return null;
		const view: ViewDefV2 = { id: v.id, type: v.type };
		// Absent = derive the display name from the group-by/date column's current
		// header at render time (see ViewDefV2's doc comment, model.ts).
		if (typeof v.name === 'string') view.name = v.name;
		if (v.type === 'kanban' && typeof v.kanban === 'object' && v.kanban !== null) {
			const groupByColId = (v.kanban as Record<string, unknown>).groupByColId;
			if (typeof groupByColId === 'string') view.kanban = { groupByColId };
		}
		if (v.type === 'calendar' && typeof v.calendar === 'object' && v.calendar !== null) {
			const dateColId = (v.calendar as Record<string, unknown>).dateColId;
			if (typeof dateColId === 'string') view.calendar = { dateColId };
		}
		return view;
	}).filter((v): v is ViewDefV2 => v !== null);
}
