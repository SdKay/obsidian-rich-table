import { test, expect } from '../common/test-base';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * staticExport.ts: a rendered table as a page's worth of HTML. The page it is put into is a different width from the
 * note it was drawn in, so the requirement is about geometry there: the frame stays on the table whatever the width.
 */
const STYLES = fs.readFileSync(path.resolve('styles.css'), 'utf8');
const VARS = fs.readFileSync(path.resolve('test/e2e/common/obsidian-vars.css'), 'utf8');

const TABLE = (extra = '', locked = true) => `---\nversion: 2\n${locked ? 'locked: true\n' : ''}theme: grid\n${extra}columns:\n  - { id: c_a, name: 项 }\n  - { id: c_b, name: 值 }\nrows:\n  - { id: r_a, cells: { c_a: TCP 接收, c_b: 16.5 Mbps } }\n  - { id: r_b, cells: { c_a: TCP 发送, c_b: 16.8 Mbps } }\n---\n`;

/** Waits until the stylesheet has reached the table (the renderer marks the shell bt-settled a frame after it does). */
async function settled(page: Page): Promise<void> {
	await page.waitForFunction(() => Array.from(document.querySelectorAll('.bt-render-root-shell')).every(s => s.classList.contains('bt-settled')));
}

/** The exported markup of the table the page is showing. */
async function exportShown(page: Page): Promise<string> {
	await settled(page);
	return page.evaluate(() => {
		const R = window.RichTableReal as unknown as { exportSheetHtml(shell: HTMLElement): { html: string } };
		const shells = document.querySelectorAll('.bt-render-root-shell');
		return R.exportSheetHtml(shells[shells.length - 1] as HTMLElement).html;
	});
}

/** Puts exported markup in a page of the given width and reports where the frame and the table are. The page is built
 *  once per test (the stylesheet is large) and only its content and width change after that. */
async function placeIn(page: Page, html: string, width: number) {
	const css = await page.evaluate(() => (window.RichTableReal as unknown as { STATIC_EXPORT_CSS: string }).STATIC_EXPORT_CSS);
	await page.setViewportSize({ width, height: 700 });
	if (!(await page.evaluate(() => !!document.getElementById('export-page')))) {
		await page.setContent(`<!doctype html><meta charset=utf-8><style>${VARS}${STYLES}${css}body{margin:0;padding:8px;font-family:sans-serif}</style><div id="export-page"></div>`);
	}
	await page.evaluate(({ html, width }) => {
		const host = document.getElementById('export-page')!;
		host.style.width = `${width - 16}px`;
		host.innerHTML = html;
	}, { html, width });
	return page.evaluate(() => {
		const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
		const root = box('.bt-render-root'), table = box('.bt-table');
		const style = getComputedStyle(document.querySelector('.bt-render-root')!);
		return {
			left: table.left - root.left, right: root.right - table.right, top: table.top - root.top, bottom: root.bottom - table.bottom,
			visibility: getComputedStyle(document.querySelector('.bt-render-root-shell')!).visibility,
			borderWidth: parseFloat(style.borderTopWidth), borderStyle: style.borderTopStyle, paddingTop: parseFloat(style.paddingTop),
		};
	});
}

test.describe('static export of a sheet', () => {
	test('the frame stays on the table at every page width, at zoom 100 and at zoom 130 @geometry', { tag: '@geometry' }, async ({ page, renderBlock }) => {
		for (const zoom of ['', 'zoom: 130\n']) {
			await renderBlock(TABLE(zoom));
			const html = await exportShown(page);
			const seen = [];
			for (const width of [420, 869, 1400]) seen.push(await placeIn(page, html, width));
			for (const m of seen) {
				// The border is 1px; nothing else may sit between the frame and the table.
				expect(m.left, `zoom "${zoom}" left gap`).toBeLessThanOrEqual(1.5);
				expect(m.right, `zoom "${zoom}" right gap`).toBeLessThanOrEqual(1.5);
				expect(m.top, `zoom "${zoom}" top gap: no room kept for the hover strips`).toBeLessThanOrEqual(1.5);
				expect(m.bottom, `zoom "${zoom}" bottom gap`).toBeLessThanOrEqual(1.5);
				expect(m.visibility).toBe('visible');
			}
			expect(seen[0]!.left).toBeCloseTo(seen[2]!.left, 1);
		}
	});

	test('draws a visible frame of its own around the table', async ({ page, renderBlock }) => {
		await renderBlock(TABLE());
		const m = await placeIn(page, await exportShown(page), 869);
		expect(m.borderStyle).toBe('solid');
		expect(m.borderWidth).toBeGreaterThan(0);
	});

	test('gives back the room an editable table keeps for its hover strips @geometry', { tag: '@geometry' }, async ({ page, renderBlock }) => {
		await renderBlock(TABLE('', false));
		await settled(page);
		// The page's own container carries the class too, so the table's root is looked up through its shell.
		const live = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.bt-render-root-shell > .bt-render-root')!).paddingTop));
		expect(live, 'fixture check: the editable table reserves room at the top').toBeGreaterThan(0);
		const m = await placeIn(page, await exportShown(page), 869);
		expect(m.paddingTop).toBe(0);
		expect(m.top).toBeLessThanOrEqual(1.5);
	});

	test('a page rule that pads every div cannot put the room back', async ({ page, renderBlock }) => {
		await renderBlock(TABLE('', false));
		const html = await exportShown(page);
		const css = await page.evaluate(() => (window.RichTableReal as unknown as { STATIC_EXPORT_CSS: string }).STATIC_EXPORT_CSS);
		await page.setContent(`<!doctype html><meta charset=utf-8><style>${VARS}${STYLES}.markdown-rendered div{padding-top:40px}${css}</style><div class="markdown-rendered">${html}</div>`);
		expect(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.bt-render-root')!).paddingTop))).toBe(0);
	});

	test('holds its frame and gives back the room even when the plugin\'s stylesheet comes after it and the export kept the reservation', async ({ page, renderBlock }) => {
		await renderBlock(TABLE('', false));
		const html = (await exportShown(page)).replace('class="bt-render-root bt-theme-grid bt-has-strips"', 'class="bt-render-root bt-theme-grid bt-has-strips" style="--bt-sel-pad: 30px;"');
		expect(html, 'fixture check: the reservation is back in the markup').toContain('--bt-sel-pad: 30px');
		const css = await page.evaluate(() => (window.RichTableReal as unknown as { STATIC_EXPORT_CSS: string }).STATIC_EXPORT_CSS);
		await page.setContent(`<!doctype html><meta charset=utf-8><style>${css}${VARS}${STYLES}</style><div>${html}</div>`);
		const m = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.bt-render-root')!); return { pad: parseFloat(s.paddingTop), border: parseFloat(s.borderTopWidth), width: s.width }; });
		expect(m.pad).toBe(0);
		expect(m.border).toBeGreaterThan(0);
	});

	test('names none of the properties the live table writes from measurements, nor the room it reserves', async ({ page, renderBlock }) => {
		await renderBlock(TABLE('', false));
		const html = await exportShown(page);
		for (const name of ['--of-l', '--of-t', '--of-w', '--of-h', '--sb-pinned', '--cc-top', '--cc-left', '--cc-maxh', '--strip-height', '--bt-sel-pad']) {
			expect(html, name).not.toContain(name);
		}
	});

	test('carries no number measured on the screen it was drawn on', async ({ page, renderBlock }) => {
		await renderBlock(TABLE('zoom: 130\n'));
		const html = await exportShown(page);
		for (const name of ['--of-', '--sb-pinned', '--cc-', '--strip-height', 'bt-outer-frame', 'bt-view-resize', 'bt-status-bar', 'bt-ctrl-col', 'bt-col-selector', 'bt-row-selector']) {
			expect(html, name).not.toContain(name);
		}
		expect(html).not.toContain('visibility: hidden');
		expect(html).not.toContain('<script');
	});

	test('keeps the table, its zoom and its theme', async ({ page, renderBlock }) => {
		await renderBlock(TABLE('zoom: 130\n'));
		const html = await exportShown(page);
		expect(html).toContain('TCP 接收');
		expect(html).toContain('bt-theme-grid');
		expect(html).toMatch(/zoom:\s*1\.3/);
	});

	test('does not change the table it was made from', async ({ page, renderBlock }) => {
		await renderBlock(TABLE());
		await settled(page);
		const before = await page.evaluate(() => document.querySelector('.bt-render-root-shell')!.outerHTML);
		await exportShown(page);
		expect(await page.evaluate(() => document.querySelector('.bt-render-root-shell')!.outerHTML)).toBe(before);
	});

	test('a table with frozen rows and columns exports whole, with its rows in order and the frame still on it @geometry', { tag: '@geometry' }, async ({ page, renderBlock }) => {
		const rows = Array.from({ length: 30 }, (_, i) => `  - { id: r_${i}, cells: { c_a: row-${i}, c_b: v${i} } }`).join('\n');
		await renderBlock(`---\nversion: 2\nlocked: true\nfreezeRows: 2\nfreezeCols: 1\nviewHeight: 140\ncolumns:\n  - { id: c_a, name: 项 }\n  - { id: c_b, name: 值 }\nrows:\n${rows}\n---\n`);
		const html = await exportShown(page);
		const m = await placeIn(page, html, 869);
		expect(m.left).toBeLessThanOrEqual(1.5);
		expect(m.right).toBeLessThanOrEqual(1.5);
		const order = await page.evaluate(() => Array.from(document.querySelectorAll('.bt-table tbody tr')).map(tr => tr.querySelector('td')?.textContent));
		expect(order).toEqual(Array.from({ length: 30 }, (_, i) => `row-${i}`));
		// Rows do not overlap: each starts at or below the bottom of the one before it.
		const overlap = await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.bt-table tbody tr')).map(tr => tr.getBoundingClientRect()); return r.some((b, i) => i > 0 && b.top < r[i - 1]!.bottom - 0.5); });
		expect(overlap).toBe(false);
	});

	test('shows the whole of a table taller than its view', { tag: '@geometry' }, async ({ page, renderBlock }) => {
		const rows = Array.from({ length: 60 }, (_, i) => `  - { id: r_${i}, cells: { c_a: row-${i}, c_b: x } }`).join('\n');
		await renderBlock(`---\nversion: 2\nlocked: true\nviewHeight: 120\ncolumns:\n  - { id: c_a, name: 项 }\n  - { id: c_b, name: 值 }\nrows:\n${rows}\n---\n`);
		const html = await exportShown(page);
		await placeIn(page, html, 869);
		const m = await page.evaluate(() => {
			const wrapper = document.querySelector('.bt-table-wrapper') as HTMLElement;
			return { client: wrapper.clientHeight, scroll: wrapper.scrollHeight, last: document.body.textContent!.includes('row-59') };
		});
		expect(m.last).toBe(true);
		expect(m.client, 'the view is not clipped to its viewHeight').toBeGreaterThanOrEqual(m.scroll - 1);
	});
});
