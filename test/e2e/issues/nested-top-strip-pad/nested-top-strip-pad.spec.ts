import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported: a nested rich-table's cell had a large block of blank space
// above the table's own content. Root cause: TOP_STRIP_PAD (renderer.ts)
// reserves extra clearance for Obsidian's own block-hover "</>" edit-source
// toolbar, which floats over a genuine top-level code block's top-right
// corner — an untitled table gets +28px on top of the base 32px specifically
// for this. That toolbar structurally cannot float over a NESTED table (a
// ```rich-table``` fence rendered inside a cell via a recursive
// MarkdownRenderer.render() call is not a hoverable block of Obsidian's own
// editor at all), so the +28px there is reserving clearance for something
// that can never happen — pure wasted space, most visible once a small
// nested table's own cell shrinks to fit content. This is the one place
// nested-ness is allowed to change anything (confirmed with the user): it's
// answering an objective environmental fact (can Obsidian's toolbar ever
// appear here), not a rendering preference — every other aspect of a nested
// table's rendering is deliberately identical to a top-level one.
const UNTITLED = tableSource({ widths: [80], rows: [{ 0: 'x' }] });

test('a nested (untitled) table skips the extra top clearance a top-level untitled table reserves', async ({ page, renderFull }) => {
	await renderFull(UNTITLED, { cacheKey: 'test.md:nested-abc' });
	const pad = await page.locator('.bt-render-root').evaluate(el =>
		parseFloat((el as HTMLElement).style.getPropertyValue('--bt-sel-pad')) || 0);
	// 32px = SEL_TOTAL alone (selectorLayout.ts) — no +28px block-hover-toolbar
	// clearance, unlike the same untitled table at the top level below.
	expect(pad).toBe(32);
});

test('an untitled top-level table still reserves the extra clearance', async ({ page, renderFull }) => {
	await renderFull(UNTITLED);
	const pad = await page.locator('.bt-render-root').evaluate(el =>
		parseFloat((el as HTMLElement).style.getPropertyValue('--bt-sel-pad')) || 0);
	expect(pad).toBe(60);
});
