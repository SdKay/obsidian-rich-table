import { test, expect } from '../common/test-base';
import { EXPORT_CLASSES } from '../../../src/staticExportClasses';

/**
 * The export's stylesheet is cut from styles.css by the classes a static export can contain (esbuild.config.mjs). The
 * list of those classes is written down in src/staticExportClasses.ts; this checks it against what exports really hold.
 * A class missing from the list loses its rules from the export; a class listed that no export holds only adds weight.
 */
const cols = `columns:\n  - { id: c_a, name: 项 }\n  - { id: c_s, name: 状态, type: task-status }\n  - { id: c_p, name: 优先级, type: priority }\n  - { id: c_r, name: 评分, type: rating }\n  - { id: c_b, name: 完成, type: boolean }\n  - { id: c_d, name: 日期, type: date }\n`;
const rows = `rows:\n  - { id: r_1, cells: { c_a: '**粗** *斜* ==高亮== [链接](https://x.y) [[笔记]] \`code\`', c_s: todo, c_p: high, c_r: '3', c_b: 'true', c_d: '2026-11-10' } }\n  - { id: r_2, cells: { c_a: "- 列表一\\n- 列表二", c_s: done, c_p: low, c_r: '5', c_b: 'false', c_d: '2026-11-12' } }\n`;
const head = (x: string) => `---\nversion: 2\nlocked: true\n${x}${cols}${rows}`;

/** One table per feature that draws something of its own. Add a case when a feature adds markup an export can hold. */
const CASES: Record<string, string> = {
	table: head('') + '---\n',
	grid: head('theme: grid\n') + '---\n',
	academic: head('theme: academic\n') + '---\n',
	titled: head('title: 标题\nfooter: 页脚\n') + '---\n',
	merged: head('') + `merges:\n  - { anchor: r_1.c_a, end: r_1.c_s }\nstyles:\n  - { target: r_1.c_a, bold: true, bg: '#fee' }\n---\n`,
	frozen: head('freezeRows: 1\nfreezeCols: 1\n') + '---\n',
	headerless: head('header: false\n') + '---\n',
	summary: head('aggregate: [{ colId: c_r, type: sum }]\n') + '---\n',
	kanban: head('') + `views:\n  - { id: v_k, type: kanban, name: K, kanban: { groupByColId: c_s } }\nactiveViewId: v_k\n---\n`,
	calendar: head('') + `views:\n  - { id: v_c, type: calendar, name: C, calendar: { dateColId: c_d } }\nactiveViewId: v_c\n---\n`,
};

test('the class list matches what the exports of a representative set of tables contain', async ({ page, renderBlock }) => {
	test.setTimeout(120_000);
	const seen = new Set<string>();
	for (const src of Object.values(CASES)) {
		await renderBlock(src);
		await page.waitForFunction(() => Array.from(document.querySelectorAll('.bt-render-root-shell')).every(s => s.classList.contains('bt-settled')));
		const classes = await page.evaluate(() => {
			const all = document.querySelectorAll('.bt-render-root-shell');
			const html = (window.RichTableReal as unknown as { exportSheetHtml(s: HTMLElement): { html: string } }).exportSheetHtml(all[all.length - 1] as HTMLElement).html;
			const host = document.createElement('div');
			host.innerHTML = html;
			const set = new Set<string>();
			host.querySelectorAll('*').forEach(e => e.classList.forEach(c => set.add(c)));
			return Array.from(set);
		});
		classes.forEach(c => seen.add(c));
	}
	// A workbook adds markup of its own: the panels, the radios and the tab bar.
	await renderBlock(CASES.table!);
	await page.waitForFunction(() => Array.from(document.querySelectorAll('.bt-render-root-shell')).every(s => s.classList.contains('bt-settled')));
	const book = await page.evaluate(() => {
		const R = window.RichTableReal as unknown as { exportWorkbookHtml(s: { id: string; name: string; tabColor?: string; shell: HTMLElement }[], o: { idPrefix: string }): { html: string } };
		const all = document.querySelectorAll('.bt-render-root-shell');
		const shell = all[all.length - 1] as HTMLElement;
		const html = R.exportWorkbookHtml([{ id: 'a', name: 'A', shell }, { id: 'b', name: 'B', tabColor: '#abcdef', shell }], { idPrefix: 'probe' }).html;
		const host = document.createElement('div');
		host.innerHTML = html;
		const set = new Set<string>();
		host.querySelectorAll('*').forEach(e => e.classList.forEach(c => set.add(c)));
		return Array.from(set);
	});
	book.forEach(c => seen.add(c));
	const listed = new Set(EXPORT_CLASSES);
	expect(Array.from(seen).filter(c => !listed.has(c)).sort(), 'classes in an export but not in EXPORT_CLASSES').toEqual([]);
	expect(EXPORT_CLASSES.filter(c => !seen.has(c)).sort(), 'classes in EXPORT_CLASSES that no export holds').toEqual([]);
});
