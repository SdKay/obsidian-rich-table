import { test, expect } from '../common/test-base';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * blockExportProvider.ts: what another plugin gets when it asks for a `rich-table` block as HTML. Drives the provider
 * itself (not the table's own render path), with a page that already has the fixture's plugin stylesheet.
 */
const STYLES = fs.readFileSync(path.resolve('styles.css'), 'utf8');
const VARS = fs.readFileSync(path.resolve('test/e2e/common/obsidian-vars.css'), 'utf8');

const TABLE = (extra = '') => `---\nversion: 2\ntheme: grid\n${extra}columns:\n  - { id: c_a, name: 项 }\n  - { id: c_b, name: 值 }\nrows:\n  - { id: r_a, cells: { c_a: TCP 接收, c_b: 16.5 Mbps } }\n---\n`;
const BOOK = `---\nversion: 3\nactive_sheet: s_b\nsheets:\n  - id: s_a\n    name: 第一页\n    columns:\n      - { id: c_a, name: 项 }\n    rows:\n      - { id: r_a, cells: { c_a: first-sheet } }\n  - id: s_b\n    name: 第二页\n    tabColor: '#d9f0ff'\n    columns:\n      - { id: c_a, name: 项 }\n    rows:\n      - { id: r_a, cells: { c_a: second-sheet } }\n---\n`;

type Result = { ok: true; value: { html: string; css: { id: string; text: string }; variables: Record<string, string | null> } } | { ok: false; error: string };

/** Asks the provider, as another plugin would: with the source, the note it is in, and optionally the width. */
async function ask(page: Page, source: string, extra: { language?: string; width?: number } = {}): Promise<Result> {
	return page.evaluate(async ({ source, extra }) => {
		const R = window.RichTableReal as unknown as { createBlockExportProvider(host: unknown): { export(r: unknown): Promise<unknown> }; ChoiceRegistry: new (c: unknown[]) => unknown; ShimComponent: new () => { load(): void } };
		const w = window as unknown as { __btPlugin: { app: unknown } };
		const provider = R.createBlockExportProvider({
			app: w.__btPlugin.app,
			choiceRegistry: () => new R.ChoiceRegistry([]),
			newComponent: () => { const c = new R.ShimComponent(); c.load(); return c; },
		});
		return provider.export({ language: extra.language ?? 'rich-table', source, sourcePath: 'note.md', width: extra.width }) as Promise<Result>;
	}, { source, extra });
}

async function show(page: Page, html: string, css: string, width: number) {
	await page.setViewportSize({ width, height: 560 });
	await page.setContent(`<!doctype html><meta charset=utf-8><style>${VARS}${STYLES}${css}body{margin:0;padding:8px;font-family:sans-serif}</style><div style="width:${width - 16}px">${html}</div>`);
}

test.describe('block export provider', () => {
	test('says what it is: version, languages, and the version of its output', async ({ page, renderBlock }) => {
		await renderBlock(TABLE());
		const info = await page.evaluate(() => {
			const R = window.RichTableReal as unknown as { createBlockExportProvider(h: unknown): { apiVersion: number; languages: string[]; exportVersion: number } };
			const p = R.createBlockExportProvider({ app: {}, choiceRegistry: () => ({}), newComponent: () => ({}) });
			return { apiVersion: p.apiVersion, languages: p.languages, exportVersion: p.exportVersion };
		});
		expect(info).toEqual({ apiVersion: 1, languages: ['rich-table'], exportVersion: 1 });
	});

	test('gives a table as markup with its css, and the variables the page must provide', async ({ page, renderBlock }) => {
		await renderBlock(TABLE());
		const r = await ask(page, TABLE());
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.html).toContain('TCP 接收');
		for (const bad of ['<script', '--of-', 'bt-ctrl-col', 'bt-status-bar', 'bt-outer-frame', 'visibility: hidden']) expect(r.value.html, bad).not.toContain(bad);
		expect(r.value.css.id).toMatch(/\S/);
		expect(r.value.css.text).toContain('.bt-table');
		expect(Object.keys(r.value.variables)).toContain('--text-normal');
		expect(Object.keys(r.value.variables).filter(v => v.startsWith('--bt-'))).toEqual([]);
	});

	test('draws the table in the page it is put into, framed at any width', { tag: '@geometry' }, async ({ page, renderBlock }) => {
		await renderBlock(TABLE('zoom: 130\n'));
		const r = await ask(page, TABLE('zoom: 130\n'));
		if (!r.ok) throw new Error(r.error);
		for (const width of [420, 869]) {
			await show(page, r.value.html, r.value.css.text, width);
			const gap = await page.evaluate(() => {
				const root = document.querySelector('.bt-render-root')!.getBoundingClientRect(), table = document.querySelector('.bt-table')!.getBoundingClientRect();
				return { left: table.left - root.left, right: root.right - table.right, top: table.top - root.top };
			});
			expect(gap.left, `@${width}`).toBeLessThanOrEqual(1.5);
			expect(gap.right, `@${width}`).toBeLessThanOrEqual(1.5);
			expect(gap.top, `@${width}`).toBeLessThanOrEqual(1.5);
		}
	});

	test('gives a workbook with every sheet and its tabs, showing the active one first', async ({ page, renderBlock }) => {
		await renderBlock(TABLE());
		const r = await ask(page, BOOK);
		if (!r.ok) throw new Error(r.error);
		expect(r.value.html).toContain('first-sheet');
		expect(r.value.html).toContain('second-sheet');
		await show(page, r.value.html, r.value.css.text, 869);
		const state = await page.evaluate(() => ({
			shown: Array.from(document.querySelectorAll<HTMLElement>('.bt-export-panel')).map(p => getComputedStyle(p).display !== 'none'),
			tabs: Array.from(document.querySelectorAll('label.bt-sheet-tab')).map(t => t.textContent),
		}));
		expect(state.shown).toEqual([false, true]);
		expect(state.tabs).toEqual(['第一页', '第二页']);
		await page.locator('label.bt-sheet-tab').nth(0).click();
		expect(await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.bt-export-panel')).map(p => getComputedStyle(p).display !== 'none'))).toEqual([true, false]);
	});

	test('keeps no room reserved for the hover strips, whichever way the table was drawn', async ({ page, renderBlock }) => {
		await renderBlock(TABLE());
		for (const extra of ['', 'locked: true\n', 'title: 标题\n', 'locked: true\ntitle: 标题\nfreezeCols: 1\n']) {
			const r = await ask(page, TABLE(extra));
			if (!r.ok) throw new Error(r.error);
			expect(r.value.html, `with "${extra.trim()}"`).not.toMatch(/--bt-sel-pad/);
		}
	});

	test('two exports of workbooks in one page do not share their switches', async ({ page, renderBlock }) => {
		await renderBlock(TABLE());
		const a = await ask(page, BOOK), b = await ask(page, BOOK);
		if (!a.ok || !b.ok) throw new Error('export failed');
		await show(page, a.value.html + b.value.html, a.value.css.text, 869);
		await page.locator('label.bt-sheet-tab').nth(0).click();
		const books = await page.evaluate(() => Array.from(document.querySelectorAll('.bt-export-book')).map(book => Array.from(book.querySelectorAll<HTMLElement>('.bt-export-panel')).map(p => getComputedStyle(p).display !== 'none')));
		expect(books).toEqual([[true, false], [false, true]]);
	});

	test.describe('a block it cannot show comes back as an error, never as an exception', () => {
		for (const [name, source, language, message] of [
			['empty', '  \n', undefined, /empty/i],
			['written by a newer version', 'version: 99\ncolumns: []\nrows: []\n', undefined, /newer/i],
			['a pipe table, which is not YAML', '| a | b |\n|---|---|\n| 1 | 2 |\n', undefined, /could not be read|not a table/i],
			['valid YAML that is not a table', 'title: just a title\nauthor: someone\n', undefined, /not a table/i],
			['broken yaml', 'version: 2\ncolumns: [oops\n', undefined, /could not be read/i],
			['another language', TABLE(), 'mermaid', /does not export/i],
			['a table with no column', 'version: 2\ncolumns: []\nrows: []\n', undefined, /no table/i],
		] as const) {
			test(name, async ({ page, renderBlock }) => {
				await renderBlock(TABLE());
				const r = await ask(page, source, { language });
				expect(r.ok).toBe(false);
				if (!r.ok) expect(r.error).toMatch(message);
			});
		}
	});

	test('unloads the component it draws with, whether the export worked or not', async ({ page, renderBlock }) => {
		await renderBlock(TABLE());
		const counts = await page.evaluate(async ({ good, bad }) => {
			const R = window.RichTableReal as unknown as { createBlockExportProvider(h: unknown): { export(r: unknown): Promise<unknown> }; ChoiceRegistry: new (c: unknown[]) => unknown; ShimComponent: new () => { load(): void; unload(): void } };
			const w = window as unknown as { __btPlugin: { app: unknown } };
			let made = 0, unloaded = 0;
			const provider = R.createBlockExportProvider({
				app: w.__btPlugin.app,
				choiceRegistry: () => new R.ChoiceRegistry([]),
				newComponent: () => { made++; const c = new R.ShimComponent(); const unload = c.unload.bind(c); c.unload = () => { unloaded++; unload(); }; c.load(); return c; },
			});
			for (const source of [good, bad]) await provider.export({ language: 'rich-table', source, sourcePath: 'note.md' });
			return { made, unloaded };
		}, { good: TABLE(), bad: 'version: 2\ncolumns: [oops\n' });
		// The block that cannot be read never gets as far as drawing, so only the first one makes a component.
		expect(counts.unloaded).toBe(counts.made);
		expect(counts.made).toBeGreaterThan(0);
	});

	test('turns a failure while drawing into an error, and still cleans up', async ({ page, renderBlock }) => {
		await renderBlock(TABLE());
		const out = await page.evaluate(async (source) => {
			const R = window.RichTableReal as unknown as { createBlockExportProvider(h: unknown): { export(r: unknown): Promise<unknown> }; ShimComponent: new () => { load(): void } };
			const w = window as unknown as { __btPlugin: { app: unknown } };
			const provider = R.createBlockExportProvider({
				app: w.__btPlugin.app,
				choiceRegistry: () => { throw new Error('registry exploded'); },
				newComponent: () => { const c = new R.ShimComponent(); c.load(); return c; },
			});
			let threw = false, result: unknown = null;
			try { result = await provider.export({ language: 'rich-table', source, sourcePath: 'note.md' }); } catch { threw = true; }
			return { threw, result, hosts: document.querySelectorAll('.bt-export-host').length };
		}, TABLE());
		expect(out.threw, 'the provider never throws').toBe(false);
		expect(out.result).toEqual({ ok: false, error: expect.stringContaining('registry exploded') });
		expect(out.hosts).toBe(0);
	});

	test('reads a block that sits under a list item, indent and all', async ({ page, renderBlock }) => {
		await renderBlock(TABLE());
		const indented = TABLE().split('\n').map(l => (l ? '    ' + l : l)).join('\n');
		const r = await ask(page, indented);
		expect(r.ok).toBe(true);
	});

	test('leaves nothing behind in the page, and does not touch a table already shown', async ({ page, renderBlock }) => {
		await renderBlock(TABLE());
		await page.waitForFunction(() => Array.from(document.querySelectorAll('.bt-render-root-shell')).every(s => s.classList.contains('bt-settled')));
		const snapshot = () => page.evaluate(() => ({ shells: document.querySelectorAll('.bt-render-root-shell').length, hosts: document.querySelectorAll('.bt-export-host').length, html: document.querySelector('.bt-render-root-shell')!.outerHTML }));
		const before = await snapshot();
		await ask(page, BOOK);
		await ask(page, 'version: 99\ncolumns: []\nrows: []\n');
		expect(await snapshot()).toEqual(before);
	});

	test('draws each sheet at its own zoom and size, as the note does', async ({ page, renderBlock }) => {
		await renderBlock(TABLE());
		const book = `---\nversion: 3\nsheets:\n  - id: s_a\n    name: A\n    zoom: 130\n    columns:\n      - { id: c_a, name: 项 }\n    rows:\n      - { id: r_a, cells: { c_a: x } }\n  - id: s_b\n    name: B\n    zoom: 80\n    columns:\n      - { id: c_a, name: 项 }\n    rows:\n      - { id: r_a, cells: { c_a: x } }\n---\n`;
		const r = await ask(page, book);
		if (!r.ok) throw new Error(r.error);
		expect(r.value.html).toMatch(/zoom:\s*1\.3/);
		expect(r.value.html).toMatch(/zoom:\s*0\.8/);
	});
});
