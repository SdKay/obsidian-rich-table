import { getLanguage } from 'obsidian';
import type { CtrlColButtonId } from '../model';
import { en, type Dict } from './en';
import { zh } from './zh';
import { de } from './de';
import { fr } from './fr';
import { ja } from './ja';
import { ko } from './ko';

/** Adding a language: add `src/i18n/<code>.ts` (typed `Dict`) and one line here. */
const DICTS: Record<string, Dict> = { en, zh, de, fr, ja, ko };

/** The Obsidian UI language reduced to a key of DICTS; anything unsupported is English. */
export function currentLang(): string {
	const code = getLanguage().toLowerCase().split(/[-_]/)[0] ?? 'en';
	return code in DICTS ? code : 'en';
}

export type I18nKey = keyof typeof en;

export function t(key: I18nKey): string {
	return (DICTS[currentLang()] ?? en)[key];
}

/** Fills `{name}` placeholders in the translated string for `key`. */
export function fmt(key: I18nKey, vars: Record<string, string | number>): string {
	return t(key).replace(/\{(\w+)\}/g, (whole, name: string) => String(vars[name] ?? whole));
}

/** Picks the value for the current language, falling back to English. */
export function pick<T>(byLang: { en: T } & Record<string, T | undefined>): T {
	return byLang[currentLang()] ?? byLang.en;
}

// ── Dynamic labels ────────────────────────────────────────────────────────────

export function tableVersionTooHighMsg(tableV: number, curV: number): string {
	return fmt('tableVersionTooHigh', { tableV, curV });
}

export function gridSizeCaption(rows: number, cols: number): string {
	return fmt('gridSize', { rows, cols });
}

const rowRangeLabel = (r1: number, r2: number): string =>
	r1 === r2 ? fmt('rowOne', { n: r1 + 1 }) : fmt('rowRange', { from: r1 + 1, to: r2 + 1 });

const colRangeLabel = (c1: number, c2: number, letter: (i: number) => string): string =>
	c1 === c2 ? fmt('colOne', { n: letter(c1) }) : fmt('colRange', { from: letter(c1), to: letter(c2) });

export const hideRowsLabel   = (r1: number, r2: number) => fmt('hideRows', { range: rowRangeLabel(r1, r2) });
export const deleteRowsLabel = (r1: number, r2: number) => fmt('deleteRows', { range: rowRangeLabel(r1, r2) });
export const hideColsLabel   = (c1: number, c2: number, letter: (i: number) => string) => fmt('hideCols', { range: colRangeLabel(c1, c2, letter) });
export const deleteColsLabel = (c1: number, c2: number, letter: (i: number) => string) => fmt('deleteCols', { range: colRangeLabel(c1, c2, letter) });

/** Status bar text: the table's totals, or (during a multi-cell selection) the
 *  selected size plus sum/avg when the selection has numbers. Parts are joined
 *  with " · ", which reads the same in every supported language. */
export function statusBarStatsLabel(stats: {
	totalRows: number; totalCols: number;
	selectedRows?: number; selectedCols?: number;
	sum?: string; avg?: string;
}): string {
	const parts = [stats.selectedRows !== undefined
		? fmt('statsSelected', { rows: stats.selectedRows, cols: stats.selectedCols ?? 0 })
		: fmt('statsTotal', { rows: stats.totalRows, cols: stats.totalCols })];
	if (stats.sum !== undefined) parts.push(fmt('statsSum', { sum: stats.sum }), fmt('statsAvg', { avg: stats.avg ?? '' }));
	return parts.join(' · ');
}

export function typeLabel(currentType?: string): string {
	return currentType ? fmt('typeWithName', { type: currentType }) : t('setType');
}

export const collapsedRowsLabel = (): string => t('collapsedHint');

export function aggLabel(agg: 'sum' | 'avg' | 'min' | 'max' | 'count'): string {
	const KEYS = { sum: 'aggSum', avg: 'aggAvg', min: 'aggMin', max: 'aggMax', count: 'aggCount' } as const;
	return t(KEYS[agg]);
}

export function sortActiveLabel(colName: string, dir: 'asc' | 'desc'): string {
	return fmt(dir === 'asc' ? 'sortedAsc' : 'sortedDesc', { name: colName });
}

export function calendarMoreEventsLabel(n: number): string {
	return fmt('calendarMore', { n });
}

/** A sheet with no explicit `name` is labeled by its 1-based position. */
export function sheetFallbackName(oneBasedIndex: number): string {
	return fmt('sheetFallback', { n: oneBasedIndex });
}

/** Settings tab label for one ctrlCol button checkbox. */
export function ctrlColButtonLabel(id: CtrlColButtonId): string {
	const KEYS: { [K in CtrlColButtonId]: I18nKey } = {
		openExternal: 'ctrlColBtnOpenExternal',
		detachXlsx:   'ctrlColBtnDetachXlsx',
		lock:         'ctrlColBtnLock',
		autoFit:      'ctrlColBtnAutoFit',
		transpose:    'ctrlColBtnTranspose',
		selectAll:    'ctrlColBtnSelectAll',
		theme:        'ctrlColBtnTheme',
		aggregate:    'ctrlColBtnAggregate',
		collapse:     'ctrlColBtnCollapse',
		viewSettings: 'ctrlColBtnViewSettings',
		views:        'ctrlColBtnViews',
		newSheet:     'ctrlColBtnNewSheet',
		snapshot:     'ctrlColBtnSnapshot',
		exportXlsx:   'ctrlColBtnExportXlsx',
	};
	return t(KEYS[id]);
}

/** Settings tab heading label for one of the three ctrlCol scenarios. */
export function ctrlColScenarioLabel(scenario: 'locked' | 'unlocked' | 'xlsxRef'): string {
	return t(scenario === 'locked' ? 'ctrlColScenarioLocked' : scenario === 'unlocked' ? 'ctrlColScenarioUnlocked' : 'ctrlColScenarioXlsxRef');
}
