import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

test.describe('table footer — manual line breaks and width cap', () => {
	// Reported ("脚注似乎不能支持手动换行") — turned out to be a key-binding
	// mismatch, not a missing feature: the multi-line footer editor had Enter
	// insert a newline and Shift+Enter commit, the reverse of the cell
	// editor's own convention (renderCell.ts: Enter commits, Shift+Enter
	// inserts a newline). A user reaching for Shift+Enter out of habit
	// committed instead of adding a line, reading as "no manual line breaks".
	// enterLineEdit's multi-line branch (renderEditMode.ts) now matches.
	test('Shift+Enter inserts a line break in the footer editor; plain Enter commits', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100], rows: [{ 0: 'x' }], footer: 'line1' }));
		const footer = page.locator('.bt-table-footer');
		await footer.click();
		const textarea = page.locator('textarea.bt-inline-editor-multi');
		await textarea.waitFor({ state: 'visible' });
		await textarea.press('End');
		await textarea.press('Shift+Enter');
		await textarea.type('line2');
		expect(await textarea.inputValue()).toBe('line1\nline2');

		await textarea.press('Enter');
		await expect.poll(() => page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps))
			.toEqual([{ type: 'set-footer', footer: ['line1', 'line2'] }]);
	});

	// A single non-empty line, even after entering multi-line edit mode,
	// collapses back to a plain string on save (renderFooter's own
	// `parts.length === 1 ? parts[0] : parts` branch) — not a bug, this is
	// the model staying a plain string until the user actually adds a second
	// line, matching how it was authored.
	test('editing without adding a line break keeps the footer a plain string', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100], rows: [{ 0: 'x' }], footer: 'line1' }));
		const footer = page.locator('.bt-table-footer');
		await footer.click();
		const textarea = page.locator('textarea.bt-inline-editor-multi');
		await textarea.waitFor({ state: 'visible' });
		await textarea.press('End');
		await textarea.type(' more');
		await textarea.press('Enter');
		await expect.poll(() => page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps))
			.toEqual([{ type: 'set-footer', footer: 'line1 more' }]);
	});

	// Both authoring paths for a genuinely multi-line footer already worked
	// before this fix (the bug was only in the UI editor's key binding) —
	// a YAML array, and a YAML block-scalar string with embedded \n, both
	// split into separate .bt-table-footer-line divs (renderFooter's own
	// `rawLines.flatMap(l => l.split('\n'))`).
	test('a footer authored as a YAML array renders one line per entry', async ({ page, renderBlock }) => {
		const SOURCE = `---
version: 2
columns:
  - { id: c_0, name: A, width: 100 }
rows:
  - { id: r_0, cells: { c_0: "1" } }
footer:
  - line1
  - line2
---
`;
		await renderBlock(SOURCE);
		const lines = page.locator('.bt-table-footer-line');
		await expect(lines).toHaveCount(2);
		expect(await lines.nth(0).textContent()).toBe('line1');
		expect(await lines.nth(1).textContent()).toBe('line2');
	});

	// Reported ("脚注的最大宽度应该不超过表格本身的宽度，超过之后应该自动换行，
	// 表格宽度调整，也应该随之调整"): .bt-table-footer used to have no width
	// constraint at all, so a footer line longer than the table's own content
	// widened .bt-table-wrapper (width: max-content) to fit it — confirmed
	// working-as-designed in an earlier fix, but the user's own follow-up ask
	// is the opposite: the footer should never widen the table, only wrap.
	// positionFooter (renderer.ts) caps --bt-footer-max-width to contentRow's
	// (table + addColBtn) own rendered width.
	test('a footer line longer than the table wraps onto more lines instead of widening the table', async ({ page, renderFull }) => {
		const longFooter = '这是一个比table本身宽很多的很长很长很长很长很长很长很长很长的注脚文字';
		await renderFull(tableSource({ widths: [50], rows: [{ 0: 'x' }], footer: longFooter }));
		const wrapper = (await page.locator('.bt-table-wrapper').boundingBox())!;
		const contentRow = (await page.locator('.bt-table-content-row').boundingBox())!;
		// wrapper stays capped to contentRow's own width — not widened by the footer.
		expect(wrapper.width).toBeCloseTo(contentRow.width, 0);
		const footer = (await page.locator('.bt-table-footer').boundingBox())!;
		// The single long line word-wrapped onto more than one visual line —
		// its rendered height is now taller than contentRow's plain line-height.
		expect(footer.height).toBeGreaterThan(contentRow.height / 2);
	});

	// The cap must track the table's REAL width live, not just at first paint —
	// same ResizeObserver(table) pattern addRowBtn's own --strip-max-width
	// already uses (positionEdgeStrips, renderer.ts) — so a column-resize drag
	// (or any other live width change) reflows the footer's wrap points in the
	// same tick, not only on the next full re-render.
	test('widening a column live reflows the footer\'s own wrap width in the same drag', async ({ page, renderFull }) => {
		const footerText = 'this is a moderately long footer line that should wrap here';
		await renderFull(tableSource({ widths: [60, 60], rows: [{ 0: 'a1', 1: 'b1' }], footer: footerText }));
		const wrapperBox = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
		await page.mouse.move(wrapperBox.x + wrapperBox.width / 2, wrapperBox.y + wrapperBox.height / 2);
		await page.waitForTimeout(80);

		const footerBefore = (await page.locator('.bt-table-footer').boundingBox())!;

		// The SECOND resize handle sits on column B's own right edge — same
		// synthetic-PointerEvent drag col-resize-independent.spec.ts already
		// uses (a real page.mouse drag doesn't reliably hit this 9px seam).
		const handle = page.locator('.bt-sel-resize-col').nth(1);
		await handle.evaluate((el: HTMLElement) => {
			const down = new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: 300, clientY: 10, bubbles: true, cancelable: true });
			el.dispatchEvent(down);
			const move = new PointerEvent('pointermove', { pointerId: 1, clientX: 600, clientY: 10, bubbles: true, cancelable: true });
			el.dispatchEvent(move);
		});
		await page.waitForTimeout(100);

		const footerDuring = (await page.locator('.bt-table-footer').boundingBox())!;
		// The table widened enough that the footer no longer needs to wrap —
		// its height dropped back to (approximately) a single line.
		expect(footerDuring.width).toBeGreaterThan(footerBefore.width);
		expect(footerDuring.height).toBeLessThan(footerBefore.height);
	});

	// The cap survives a write-back rebuild too — renderTable() runs from
	// scratch against the fresh post-swap DOM, and positionFooter's own
	// first-paint call (not a resize-observer tick) is what sets the
	// CSS var before anything is even visible.
	test('the width cap is already in place immediately after a write-back rebuild', async ({ page, renderBlock }) => {
		const SOURCE = `---
version: 2
columns:
  - { id: c_0, name: A, width: 50 }
rows:
  - { id: r_0, cells: { c_0: "1" } }
footer: 这是一个比table本身宽很多的很长很长很长很长很长很长很长很长的注脚文字
---
`;
		const block = await renderBlock(SOURCE);
		const wrapper = page.locator('.bt-table-wrapper:not(#wrapper)');
		const contentRow = page.locator('.bt-table-content-row:not(#contentRow)');
		const wrapperBoxBefore = (await wrapper.boundingBox())!;
		const contentRowBoxBefore = (await contentRow.boundingBox())!;
		expect(wrapperBoxBefore.width).toBeCloseTo(contentRowBoxBefore.width, 0);

		// Trigger a real write-back rebuild (insert a row via the "+" button).
		// renderBlock only rewrites the underlying note on this click — it does
		// NOT rebuild the DOM on its own, so block.reprocess() (the harness's
		// stand-in for Obsidian noticing the file changed) is what actually
		// reproduces the atomic-swap/re-render this test means to exercise.
		await page.mouse.move(wrapperBoxBefore.x + wrapperBoxBefore.width / 2, wrapperBoxBefore.y + wrapperBoxBefore.height / 2);
		await page.locator('.bt-edge-add-row').click();
		await expect.poll(async () => (await block.noteText()).match(/id: r_/g)?.length ?? 0).toBe(2);
		await block.reprocess();
		await expect.poll(() => page.locator('tbody tr').count()).toBeGreaterThan(1);

		const wrapperBoxAfter = (await wrapper.boundingBox())!;
		const contentRowBoxAfter = (await contentRow.boundingBox())!;
		expect(wrapperBoxAfter.width).toBeCloseTo(contentRowBoxAfter.width, 0);
	});
});
