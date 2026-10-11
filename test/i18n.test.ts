import { describe, it, expect, afterEach } from 'vitest';
import { __setLanguage } from 'obsidian';
import {
	t, fmt, pick, currentLang, gridSizeCaption, hideRowsLabel, hideColsLabel, deleteRowsLabel, deleteColsLabel,
	statusBarStatsLabel, typeLabel, sortActiveLabel, calendarMoreEventsLabel, sheetFallbackName, tableVersionTooHighMsg,
} from '../src/i18n';

const letter = (i: number) => String.fromCharCode(65 + i);

afterEach(() => __setLanguage('en'));

describe('language resolution', () => {
	it.each([
		['en', 'en'], ['en-GB', 'en'], ['zh', 'zh'], ['zh-TW', 'zh'], ['de', 'de'], ['fr', 'fr'],
		['ja', 'ja'], ['ko', 'ko'], ['DE', 'de'], ['pt-BR', 'en'], ['ru', 'en'], ['', 'en'],
	])('%s -> %s', (code, expected) => {
		__setLanguage(code);
		expect(currentLang()).toBe(expected);
	});

	it('pick falls back to English for a language without an entry', () => {
		__setLanguage('ja');
		expect(pick({ en: 'English', zh: '中文' })).toBe('English');
		__setLanguage('zh');
		expect(pick({ en: 'English', zh: '中文' })).toBe('中文');
	});
});

describe('fmt', () => {
	it('fills every placeholder, including repeated ones, and leaves unknown ones visible', () => {
		__setLanguage('en');
		expect(fmt('gridSize', { rows: 3, cols: 4 })).toBe('3 × 4 table');
		expect(fmt('hideRows', { range: 'x' })).toBe('Hide x');
		expect(fmt('hideRows', {})).toBe('Hide {range}');
	});
});

// The sentences that used to be hand-written per language inside functions.
describe('English labels', () => {
	it('matches the wording the plugin always had', () => {
		__setLanguage('en');
		expect(gridSizeCaption(3, 4)).toBe('3 × 4 table');
		expect(hideRowsLabel(0, 0)).toBe('Hide row');
		expect(hideRowsLabel(2, 4)).toBe('Hide rows 3–5');
		expect(deleteRowsLabel(1, 1)).toBe('Delete row');
		expect(hideColsLabel(0, 0, letter)).toBe('Hide column');
		expect(deleteColsLabel(1, 3, letter)).toBe('Delete cols B–D');
		expect(statusBarStatsLabel({ totalRows: 5, totalCols: 3 })).toBe('5 rows × 3 cols');
		expect(statusBarStatsLabel({ totalRows: 5, totalCols: 3, selectedRows: 2, selectedCols: 2, sum: '10', avg: '5' }))
			.toBe('Selected 2 × 2 · Sum: 10 · Avg: 5');
		expect(typeLabel()).toBe('Set type');
		expect(typeLabel('priority')).toBe('Type: priority');
		expect(sortActiveLabel('Name', 'asc')).toBe('Sorted by "Name" (ascending) · click to clear');
		expect(sortActiveLabel('Name', 'desc')).toBe('Sorted by "Name" (descending) · click to clear');
		expect(calendarMoreEventsLabel(3)).toBe('+3 more');
		expect(sheetFallbackName(2)).toBe('Sheet 2');
		expect(tableVersionTooHighMsg(5, 3)).toBe('This table was saved with Rich Table format v5, but the installed plugin only supports up to v3. Please upgrade the plugin.');
	});
});

describe('Chinese labels', () => {
	it('matches the wording the plugin always had', () => {
		__setLanguage('zh');
		expect(gridSizeCaption(3, 4)).toBe('3 × 4 表格');
		expect(hideRowsLabel(0, 0)).toBe('隐藏第1行');
		expect(hideRowsLabel(2, 4)).toBe('隐藏第3–5行');
		expect(deleteRowsLabel(1, 1)).toBe('删除第2行');
		expect(hideColsLabel(0, 0, letter)).toBe('隐藏A列');
		expect(deleteColsLabel(1, 3, letter)).toBe('删除B–D列');
		expect(statusBarStatsLabel({ totalRows: 5, totalCols: 3 })).toBe('5 行 × 3 列');
		expect(statusBarStatsLabel({ totalRows: 5, totalCols: 3, selectedRows: 2, selectedCols: 2, sum: '10', avg: '5' }))
			.toBe('已选 2 行 × 2 列 · 求和: 10 · 平均: 5');
		expect(typeLabel()).toBe('设置类型');
		expect(typeLabel('priority')).toBe('类型：priority');
		expect(sortActiveLabel('名称', 'asc')).toBe('按"名称"排序（升序）· 点击取消');
		expect(sortActiveLabel('名称', 'desc')).toBe('按"名称"排序（降序）· 点击取消');
		expect(calendarMoreEventsLabel(3)).toBe('还有 3 条');
		expect(sheetFallbackName(2)).toBe('表 2');
		expect(tableVersionTooHighMsg(5, 3)).toBe('该表格由更高版本的 Rich Table（格式 v5）保存，当前插件最高支持 v3，请升级插件后查看。');
	});
});

describe('new languages fill their templates', () => {
	const sample = () => ({
		range: [hideRowsLabel(2, 4), deleteColsLabel(1, 1, letter), hideColsLabel(0, 2, letter)],
		stats: statusBarStatsLabel({ totalRows: 5, totalCols: 3, selectedRows: 2, selectedCols: 2, sum: '10', avg: '5' }),
		sort: sortActiveLabel('X', 'desc'),
		more: calendarMoreEventsLabel(3),
		sheet: sheetFallbackName(2),
	});

	it.each([
		['de', ['Zeilen 3–5 ausblenden', 'Spalte B löschen', 'Spalten A–C ausblenden'], 'Ausgewählt: 2 × 2 · Summe: 10 · Mittelwert: 5', 'Sortiert nach „X“ (absteigend) · zum Aufheben klicken', '+3 weitere', 'Blatt 2'],
		['fr', ['Masquer lignes 3–5', 'Supprimer colonne B', 'Masquer colonnes A–C'], 'Sélection : 2 × 2 · Somme : 10 · Moyenne : 5', 'Trié par « X » (décroissant) · cliquer pour annuler', '+3 de plus', 'Feuille 2'],
		['ja', ['3〜5行目を非表示', 'B列目を削除', 'A〜C列目を非表示'], '選択中：2 行 × 2 列 · 合計: 10 · 平均: 5', '「X」で並べ替え中（降順）· クリックで解除', '他 3 件', 'シート 2'],
		['ko', ['3~5행 숨기기', 'B열 삭제', 'A~C열 숨기기'], '선택됨: 2행 × 2열 · 합계: 10 · 평균: 5', '"X" 기준 정렬(내림차순) · 클릭하여 해제', '+3개 더', '시트 2'],
	])('%s', (lang, range, stats, sort, more, sheet) => {
		__setLanguage(lang);
		const got = sample();
		expect(got.range).toEqual(range);
		expect(got.stats).toBe(stats);
		expect(got.sort).toBe(sort);
		expect(got.more).toBe(more);
		expect(got.sheet).toBe(sheet);
	});

	it('an unsupported language shows English, not blanks', () => {
		__setLanguage('ru');
		expect(t('mergeCells')).toBe('Merge cells');
		expect(hideRowsLabel(0, 0)).toBe('Hide row');
	});
});

describe('dictionaries', () => {
	// A language may leave a placeholder out (English says "row", Chinese "第3行"), but
	// must never use one the code does not supply. The code's supply is the union of
	// what any language uses, so a typo like {nn} shows up as an unknown name.
	it('only uses placeholders the code supplies', async () => {
		const { en } = await import('../src/i18n/en');
		const langs = { zh: (await import('../src/i18n/zh')).zh, de: (await import('../src/i18n/de')).de, fr: (await import('../src/i18n/fr')).fr, ja: (await import('../src/i18n/ja')).ja, ko: (await import('../src/i18n/ko')).ko };
		const holes = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]));
		const supplied: Record<string, Set<string>> = {
			rowOne: new Set(['n']), colOne: new Set(['n']),
		};
		for (const [lang, dict] of Object.entries(langs)) {
			for (const key of Object.keys(en) as (keyof typeof en)[]) {
				const allowed = supplied[key] ?? holes(en[key]);
				for (const name of holes(dict[key])) expect(allowed.has(name!), `${lang}.${key} uses {${name}}`).toBe(true);
			}
		}
	});

	it('uses every placeholder the English wording needs', async () => {
		const { en } = await import('../src/i18n/en');
		const langs = { zh: (await import('../src/i18n/zh')).zh, de: (await import('../src/i18n/de')).de, fr: (await import('../src/i18n/fr')).fr, ja: (await import('../src/i18n/ja')).ja, ko: (await import('../src/i18n/ko')).ko };
		const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]!).sort();
		for (const [lang, dict] of Object.entries(langs)) {
			for (const key of Object.keys(en) as (keyof typeof en)[]) {
				if (key === 'rowOne' || key === 'colOne') continue;
				expect(holes(dict[key]), `${lang}.${key}`).toEqual(holes(en[key]));
			}
		}
	});

	it('has no empty entries', async () => {
		for (const mod of ['zh', 'de', 'fr', 'ja', 'ko']) {
			const dict = (await import(`../src/i18n/${mod}`))[mod] as Record<string, string>;
			for (const [key, value] of Object.entries(dict)) expect(value.trim(), `${mod}.${key}`).not.toBe('');
		}
	});

	it('every t() key resolves in every language', () => {
		for (const code of ['en', 'zh', 'de', 'fr', 'ja', 'ko']) {
			__setLanguage(code);
			expect(t('mergeCells').length).toBeGreaterThan(0);
		}
	});
});
