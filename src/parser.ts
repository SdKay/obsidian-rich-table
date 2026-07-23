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
	StyleRuleV2,
	TableModelV2,
} from './model';

const AGG_TYPES: AggType[] = ['sum', 'avg', 'min', 'max', 'count'];

export function parseTable(source: string): TableModelV2 {
	const yaml = extractFrontmatter(source);

	const columns = parseColumns(yaml?.columns);
	const rows    = parseRows(yaml?.rows);
	const sort    = parseSort(yaml?.sort);
	const aggregate = parseAggregate(yaml?.aggregate);

	return {
		version:  2,
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
	};
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
