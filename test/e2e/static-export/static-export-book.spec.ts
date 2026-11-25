import { test, expect } from '../common/test-base';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * staticExport.ts, a workbook: every sheet is drawn once and the page switches between them with CSS alone.
 */
const STYLES = fs.readFileSync(path.resolve('styles.css'), 'utf8');
const VARS = fs.readFileSync(path.resolve('test/e2e/common/obsidian-vars.css'), 'utf8');

const sheet = (zoom: number, rows: string[][]) => `---\nversion: 2\nlocked: true\ntheme: grid\nzoom: ${zoom}\ncolumns:\n  - { id: c_a, name: 项 }\n  - { id: c_b, name: 值 }\nrows:\n${rows.map((r, i) => `  - { id: r_${i}, cells: { c_a: ${r[0]}, c_b: ${r[1]} } }`).join('\n')}\n---\n`;

interface Spec { id: string; name: string; zoom: number; rows: string[][]; tabColor?: string }
const SHEETS: Spec[] = [
	{ id: 's_a', name: '第一页', zoom: 130, rows: [['TCP 接收', '16.5 Mbps'], ['TCP 发送', '16.8 Mbps']] },
	{ id: 's_b', name: '第二页，名字长一点', zoom: 100, rows: [['SRAM text / 剩余 heap', '2.2 KB / 4545 KB'], ['UDP 接收（灌 30 Mbps）', '20.2 Mbps，丢 32%'], ['第三行', '1']], tabColor: '#d9f0ff' },
	{ id: 's_c', name: '第三页', zoom: 80, rows: [['只有一行', 'x']] },
];

/** Draws each sheet in the page, takes the shell of each, and exports them as one workbook. */
async function exportBook(page: Page, renderBlock: (src: string) => Promise<unknown>, opts: { idPrefix: string; activeSheetId?: string }) {
	const shells: string[] = [];
	for (const s of SHEETS) {
		await renderBlock(sheet(s.zoom, s.rows));
		await page.waitForFunction(() => Array.from(document.querySelectorAll('.bt-render-root-shell')).every(e => e.classList.contains('bt-settled')));
		shells.push(await page.evaluate(() => { const all = document.querySelectorAll('.bt-render-root-shell'); return all[all.length - 1]!.outerHTML; }));
	}
	return page.evaluate(({ shells, specs, opts }) => {
		const R = window.RichTableReal as unknown as { exportWorkbookHtml(sheets: { id: string; name: string; tabColor?: string; shell: HTMLElement }[], opts: { idPrefix: string; activeSheetId?: string }): { html: string } };
		const sheets = specs.map((s, i) => { const host = document.createElement('div'); host.innerHTML = shells[i]!; return { id: s.id, name: s.name, tabColor: s.tabColor, shell: host.firstElementChild as HTMLElement }; });
		return R.exportWorkbookHtml(sheets, opts).html;
	}, { shells, specs: SHEETS, opts });
}

async function open(page: Page, html: string, width: number) {
	const css = await page.evaluate(() => (window.RichTableReal as unknown as { STATIC_EXPORT_CSS: string }).STATIC_EXPORT_CSS);
	await page.setViewportSize({ width, height: 560 });
	await page.setContent(`<!doctype html><meta charset=utf-8><style>${VARS}${STYLES}${css}body{margin:0;padding:8px;font-family:sans-serif}</style><div id="page" style="width:${width - 16}px">${html}</div>`);
}

const shown = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.bt-export-panel')).map(p => getComputedStyle(p).display !== 'none'));

test.describe('static export of a workbook', () => {
	test('shows the active sheet first, and the clicked one after', async ({ page, renderBlock }) => {
		const html = await exportBook(page, renderBlock, { idPrefix: 'wb1', activeSheetId: 's_b' });
		await open(page, html, 869);
		expect(await shown(page)).toEqual([false, true, false]);
		for (const i of [0, 2, 1]) {
			await page.locator('label.bt-sheet-tab').nth(i).click();
			expect(await shown(page), `after clicking tab ${i}`).toEqual([0, 1, 2].map(k => k === i));
		}
	});

	test('shows the first sheet when none is named', async ({ page, renderBlock }) => {
		await open(page, await exportBook(page, renderBlock, { idPrefix: 'wb2' }), 869);
		expect(await shown(page)).toEqual([true, false, false]);
	});

	test('keeps each sheet\'s own zoom and size, with the frame on its table at any page width @geometry', { tag: '@geometry' }, async ({ page, renderBlock }) => {
		const html = await exportBook(page, renderBlock, { idPrefix: 'wb3', activeSheetId: 's_a' });
		const widths: number[] = [];
		for (const pageWidth of [420, 869]) {
			await open(page, html, pageWidth);
			for (let i = 0; i < SHEETS.length; i++) {
				await page.locator('label.bt-sheet-tab').nth(i).click();
				const m = await page.evaluate((i) => {
					const panel = document.querySelectorAll('.bt-export-panel')[i]!;
					const root = panel.querySelector('.bt-render-root')!.getBoundingClientRect(), table = panel.querySelector('.bt-table')!.getBoundingClientRect();
					return { left: table.left - root.left, right: root.right - table.right, width: Math.round(table.width) };
				}, i);
				expect(m.left, `sheet ${i} @${pageWidth}`).toBeLessThanOrEqual(1.5);
				expect(m.right, `sheet ${i} @${pageWidth}`).toBeLessThanOrEqual(1.5);
				if (pageWidth === 869) widths.push(m.width);
			}
		}
		expect(new Set(widths).size, 'each sheet keeps its own size').toBe(SHEETS.length);
	});

	test('draws the tabs with the plugin\'s own tab class and each sheet\'s colour', async ({ page, renderBlock }) => {
		await open(page, await exportBook(page, renderBlock, { idPrefix: 'wb4', activeSheetId: 's_b' }), 869);
		const tabs = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('label.bt-sheet-tab')).map(t => ({ text: t.textContent, bg: t.style.getPropertyValue('--bt-sheet-tab-bg') })));
		expect(tabs.map(t => t.text)).toEqual(SHEETS.map(s => s.name));
		expect(tabs[1]!.bg).toBe('#d9f0ff');
	});

	test('the tab of the shown sheet looks selected, and the look follows the click', async ({ page, renderBlock }) => {
		await open(page, await exportBook(page, renderBlock, { idPrefix: 'wb5', activeSheetId: 's_a' }), 869);
		const weights = () => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('label.bt-sheet-tab')).map(t => getComputedStyle(t).fontWeight));
		const first = await weights();
		expect(first[0], 'the shown sheet\'s tab is set apart from the others').not.toBe(first[1]);
		expect(first[1]).toBe(first[2]);
		await page.locator('label.bt-sheet-tab').nth(2).click();
		const after = await weights();
		expect(after[2]).toBe(first[0]);
		expect(after[0]).toBe(first[1]);
	});

	test('two workbooks in one page switch independently', async ({ page, renderBlock }) => {
		const a = await exportBook(page, renderBlock, { idPrefix: 'wbA', activeSheetId: 's_a' });
		const b = await exportBook(page, renderBlock, { idPrefix: 'wbB', activeSheetId: 's_c' });
		await open(page, a + b, 869);
		await page.locator('#wbA-1').evaluate(el => (el.parentElement!.querySelector('label[for="wbA-1"]') as HTMLElement).click());
		const panels = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.bt-export-book')).map(book => Array.from(book.querySelectorAll<HTMLElement>('.bt-export-panel')).map(p => getComputedStyle(p).display !== 'none')));
		expect(panels).toEqual([[false, true, false], [false, false, true]]);
	});

	test('carries no script and no measured number', async ({ page, renderBlock }) => {
		const html = await exportBook(page, renderBlock, { idPrefix: 'wb6' });
		for (const bad of ['<script', '--of-', '--sb-pinned', 'bt-status-bar', 'bt-outer-frame', 'visibility: hidden']) expect(html, bad).not.toContain(bad);
	});
});
