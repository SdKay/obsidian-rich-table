/**
 * Block parser. The block is YAML, optionally between `---` lines; see
 * `blockYaml` for what is read when they are there.
 */

import { parseYaml } from './yamlAdapter';
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
import { recomputeFormulas } from './formula';
import { ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT } from './operations';
import { CURRENT_TABLE_VERSION } from './tableVersion';

const AGG_TYPES: AggType[] = ['sum', 'avg', 'min', 'max', 'count'];

export function parseTable(source: string): TableModelV2 {
	const yaml = extractFrontmatter(source);
	const model: TableModelV2 = { version: 2, ...parseModelFields(yaml) };
	recomputeFormulas(model);
	return model;
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
	const tasks   = parseTasksSource(yaml?.tasks);
	const freezeRows = parseFreezeCount(yaml?.freezeRows);
	const freezeCols = parseFreezeCount(yaml?.freezeCols);
	const viewWidth  = parseViewSize(yaml?.viewWidth);
	const viewHeight = parseViewSize(yaml?.viewHeight);
	const statusBarScrollWidth = parseViewSize(yaml?.statusBarScrollWidth);
	const zoom = parseZoom(yaml?.zoom);

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
		...(yaml?.header === false ? { header: false as const } : {}),
		...(typeof yaml?.wrap === 'boolean' ? { wrap: yaml.wrap } : {}),
		...(sort ? { sort } : {}),
		...(aggregate.length > 0 ? { aggregate } : {}),
		...(views.length > 0 ? { views } : {}),
		...(freezeRows !== undefined ? { freezeRows } : {}),
		...(freezeCols !== undefined ? { freezeCols } : {}),
		...(viewWidth  !== undefined ? { viewWidth }  : {}),
		...(viewHeight !== undefined ? { viewHeight } : {}),
		...(yaml?.statusBarMode === 'pinned' || yaml?.statusBarMode === 'hover' ? { statusBarMode: yaml.statusBarMode } : {}),
		...(statusBarScrollWidth !== undefined ? { statusBarScrollWidth } : {}),
		...(zoom !== undefined ? { zoom } : {}),
		// Only meaningful alongside a matching views[] entry — an activeViewId
		// pointing nowhere behaves exactly like it being absent (default table).
		...(typeof yaml?.activeViewId === 'string' && views.some(v => v.id === yaml.activeViewId)
			? { activeViewId: yaml.activeViewId } : {}),
		...(parseXlsxSource(yaml?.xlsxSource) ? { xlsxSource: parseXlsxSource(yaml?.xlsxSource) } : {}),
		...(tasks ? { tasks } : {}),
	};
}

function parseTasksSource(raw: unknown): { query: string; groups?: boolean } | undefined {
	if (typeof raw !== 'object' || raw === null) return undefined;
	const v = raw as Record<string, unknown>;
	// An empty query is a real one: it finds every task.
	return typeof v.query === 'string' ? { query: v.query, ...(v.groups === true ? { groups: true } : {}) } : undefined;
}

function parseXlsxSource(raw: unknown): { path: string; sheet?: string } | undefined {
	if (typeof raw !== 'object' || raw === null) return undefined;
	const v = raw as Record<string, unknown>;
	if (typeof v.path !== 'string' || v.path === '') return undefined;
	return { path: v.path, ...(typeof v.sheet === 'string' ? { sheet: v.sheet } : {}) };
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
	recomputeFormulas(sheet);
	return sheet;
}

/** Single entry point for tableBlock.ts: dispatches to the workbook parser or
 *  the plain single-sheet parser based on which shape the source is actually
 *  in — see `parseWorkbook`'s doc comment for the structural detection rule. */
export function parseSource(source: string): TableModelV2 | WorkbookV3 {
	return parseWorkbook(source) ?? parseTable(source);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DELIMITER = /^---[ \t]*$/;
const OPENER = /^[ \t]*---[ \t]*$/;
const BLANK = /^[ \t]*$/;

/**
 * No byte-order mark, LF line breaks, and the indent every non-blank line shares taken off, so every line test
 * below sees the same lines whether or not the block sits under a list item. Moving all lines the same distance
 * changes nothing in YAML.
 */
function normalize(source: string): string {
	const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
	const indents = lines.filter(l => !BLANK.test(l)).map(l => /^[ \t]*/.exec(l)![0].length);
	const shared = indents.length === 0 ? 0 : Math.min(...indents);
	return (shared === 0 ? lines : lines.map(l => (BLANK.test(l) ? '' : l.slice(shared)))).join('\n');
}

/**
 * The YAML of a block. The `---` lines around it are optional: with an opening
 * one, the YAML ends at the next `---` at column 0 (an indented one is content,
 * such as a rule inside a block-scalar cell) and what follows is ignored, which
 * is where an older note keeps its pipe-table mirror.
 */
function blockYaml(source: string): string {
	const lines = normalize(source).split('\n');
	const open = lines.findIndex(l => !BLANK.test(l));
	if (open === -1 || !OPENER.test(lines[open] ?? '')) return lines.join('\n');
	const close = lines.findIndex((l, i) => i > open && DELIMITER.test(l));
	return lines.slice(open + 1, close === -1 ? undefined : close).join('\n');
}

function extractFrontmatter(source: string): Record<string, unknown> | null {
	const yaml: unknown = parseYaml(blockYaml(source));
	return isRecord(yaml) ? yaml : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export type BlockRead =
	| { kind: 'table'; version: number }
	| { kind: 'empty' }
	| { kind: 'too-new'; version: number }
	| { kind: 'unreadable'; yamlError?: string };

/**
 * What a block is, before parsing it: a table this build reads, an empty block,
 * one written by a newer build, or anything else. "Anything else" includes the
 * v1 format (a pipe table, with YAML whose columns have no ids above it), which
 * is no longer read; the caller shows it and never writes it.
 */
export function readBlock(source: string): BlockRead {
	if (normalize(source).split('\n').every(l => BLANK.test(l))) return { kind: 'empty' };
	let yaml: Record<string, unknown> | null;
	try { yaml = extractFrontmatter(source); } catch (err) {
		return { kind: 'unreadable', yamlError: (err instanceof Error ? err.message.split('\n')[0] : undefined) ?? 'unknown error' };
	}
	if (!yaml) return { kind: 'unreadable' };
	const version = yaml.version === undefined ? 2 : yaml.version;
	// A version that is not a whole number is not guessed at: written as `1`, it may be the old format.
	if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) return { kind: 'unreadable' };
	if (version > CURRENT_TABLE_VERSION) return { kind: 'too-new', version };
	if (version < 2) return { kind: 'unreadable' };
	return isTableYaml(yaml) ? { kind: 'table', version } : { kind: 'unreadable' };
}

function isTableYaml(yaml: Record<string, unknown>): boolean {
	if (Array.isArray(yaml.sheets) && yaml.sheets.some(s => isRecord(s) && typeof s.id === 'string')) return true;
	if (isRecord(yaml.xlsxSource) || isRecord(yaml.tasks)) return true;
	if (!Array.isArray(yaml.columns)) return false;
	if (yaml.rows !== undefined) return Array.isArray(yaml.rows);
	return yaml.columns.some(c => isRecord(c) && typeof c.id === 'string');
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
		if (typeof c.wrap === 'boolean')                         col.wrap   = c.wrap;
		if (c.align === 'left' || c.align === 'center' || c.align === 'right') col.align = c.align;
		if (Array.isArray(c.filter))                             col.filter = c.filter.map(v => String(v));
		if (typeof c.field === 'string' && c.field !== '')       col.field = c.field;
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
		if (typeof r.formulas === 'object' && r.formulas !== null) {
			const formulas: Record<string, string> = {};
			for (const [k, v] of Object.entries(r.formulas as Record<string, unknown>)) {
				if (typeof v !== 'string' || v === '') continue;
				// A leading == is a highlight; builds that treated it as a formula saved it here.
				if (v.startsWith('==')) cells[k] = v;
				else formulas[k] = v;
			}
			if (Object.keys(formulas).length > 0) row.formulas = formulas;
		}
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
		if (s.align === 'left' || s.align === 'center' || s.align === 'right') rule.align = s.align;
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

/** A hand-written `zoom: 100` (or one outside [ZOOM_MIN, ZOOM_MAX]) is
 *  clamped/normalized the same way the reducer's own `set-zoom` case does —
 *  YAML is user-editable text, so a note hand-edited to `zoom: 9999` should
 *  render exactly as if the zoom control itself had been clamped there,
 *  not silently accept an absurd value just because it bypassed the UI. */
function parseZoom(raw: unknown): number | undefined {
	if (typeof raw !== 'number' || !Number.isFinite(raw) || raw === ZOOM_DEFAULT) return undefined;
	return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, raw)));
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
