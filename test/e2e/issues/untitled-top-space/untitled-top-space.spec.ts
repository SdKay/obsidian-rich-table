import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// The view always keeps a fixed 8px gap above its first content (title or
// column-selector strip), the same size as the drag-handle zone on the opposite
// edge; with no title the editable table's column-selector strip sits below it.
const top = async (page: import('@playwright/test').Page) => {
	const frame = (await page.locator('.bt-outer-frame').boundingBox())!;
	const body = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
	return Math.round(body.y - frame.y);
};

test('an editable untitled table has the gap plus the selector strip above the body', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }] }));
	expect(await top(page)).toBe(8 + 22);
});

test('a locked untitled table has just the gap above the body', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }], locked: true }));
	expect(await top(page)).toBe(8);
});

test('a titled table keeps the same gap above its title', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }], title: 'T' } as never));
	const frame = (await page.locator('.bt-outer-frame').boundingBox())!;
	const title = (await page.locator('.bt-table-title').boundingBox())!;
	expect(Math.round(title.y - frame.y)).toBe(8);
});

// Reading view (editing off) has no strips at all, but keeps the same gap.
for (const [name, extra, bodyTop, titleTop] of [
	['untitled', {}, 8, null],
	['titled', { title: 'T' }, 32, 8],
] as const)
	test(`a read-only (reading view) ${name} table keeps the same top gap`, { tag: '@geometry' }, async ({ page, renderBlock }) => {
		await renderBlock(tableSource({ widths: [60, 60], rows: [{ 0: 'a', 1: 'b' }], ...extra } as never), { settings: { allowReadingViewEdit: false } });
		const r = await page.evaluate(async () => {
			const w = window as unknown as Record<string, any>;
			const container = document.createElement('div');
			const host = document.createElement('div');
			host.className = 'markdown-reading-view';
			document.body.appendChild(host);
			host.appendChild(container);
			const block = new w.RichTableReal.TableBlock(container, w.__btSource, w.__btPlugin, w.__btNote, { getSectionInfo: () => null }, 'rv-gap.md:1');
			block.load();
			await new Promise(res => setTimeout(res, 800));
			const f = container.querySelector('.bt-outer-frame')!.getBoundingClientRect();
			const body = container.querySelector('.bt-table-wrapper')!.getBoundingClientRect();
			const title = container.querySelector('.bt-table-title')?.getBoundingClientRect();
			return { strips: !!container.querySelector('.bt-col-selector'), bodyTop: Math.round(body.top - f.top), titleTop: title ? Math.round(title.top - f.top) : null };
		});
		expect(r.strips).toBe(false);
		expect(r.bodyTop).toBe(bodyTop);
		expect(r.titleTop).toBe(titleTop);
	});

// A host stylesheet that pads every div (Obsidian themes do) must not remove the gap.
for (const [name, extra, bodyTop] of [
	['editable untitled', {}, 30],
	['locked untitled', { locked: true }, 8],
	['editable titled', { title: 'T' }, 32],
] as const)
	test(`a host stylesheet padding every div cannot remove the top gap (${name})`, { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }], ...extra } as never));
		await page.evaluate(() => document.getElementById('root')?.classList.add('markdown-rendered'));
		await page.addStyleTag({ content: '.markdown-rendered div { padding-top: 0; }' });
		const body = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
		const frame = (await page.locator('.bt-outer-frame').boundingBox())!;
		expect(Math.round(body.y - frame.y)).toBe(bodyTop);
	});
