import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// With "allow editing in reading view" off, a table in reading view must stay
// read-only even when Obsidian attaches the block's container to the DOM
// AFTER the code-block processor (and its first animation frame) has run —
// reading view does that for lazily rendered sections.
const SOURCE = tableSource({ widths: [60, 60], rows: [{ 0: 'a', 1: 'b' }] });

async function mountDetachedThenAttach(page: import('@playwright/test').Page, hostClass: string): Promise<boolean> {
	return page.evaluate(async (hostClass) => {
		const w = window as unknown as Record<string, any>;
		const container = document.createElement('div');
		const ctx = { getSectionInfo: () => null };
		const block = new w.RichTableReal.TableBlock(container, w.__btSource, w.__btPlugin, w.__btNote, ctx, 'gate.md:1');
		block.load();
		await new Promise(r => setTimeout(r, 300));
		const host = document.createElement('div');
		host.className = hostClass;
		document.body.appendChild(host);
		host.appendChild(container);
		await new Promise(r => setTimeout(r, 700));
		return container.querySelector('.bt-col-selector') !== null;
	}, hostClass);
}

test('a container attached to reading view late stays read-only', async ({ page, renderBlock }) => {
	await renderBlock(SOURCE, { settings: { allowReadingViewEdit: false } });
	expect(await mountDetachedThenAttach(page, 'markdown-reading-view')).toBe(false);
});

test('a container attached late outside reading view becomes editable', async ({ page, renderBlock }) => {
	await renderBlock(SOURCE, { settings: { allowReadingViewEdit: false } });
	expect(await mountDetachedThenAttach(page, 'markdown-source-view')).toBe(true);
});

test('with the setting on, a late-attached reading-view table is editable', async ({ page, renderBlock }) => {
	await renderBlock(SOURCE, { settings: { allowReadingViewEdit: true } });
	expect(await mountDetachedThenAttach(page, 'markdown-reading-view')).toBe(true);
});
