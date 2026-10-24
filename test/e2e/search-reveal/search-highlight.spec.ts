import { test, expect } from '../common/test-base';

/** markSpans / restore on rendered-cell-like DOM. Runs in the page; the fixture only supplies the bundle. */
type Result = { html: string; text: string; marked: string[] };

async function run(page: import('@playwright/test').Page, html: string, spans: { start: number; end: number }[], restore = false): Promise<Result & { restoredHtml: string; original: string }> {
	return page.evaluate(({ html, spans, restore }) => {
		const R = (window as any).RichTableReal;
		const el = document.createElement('div');
		el.innerHTML = html;
		document.body.appendChild(el);
		const original = el.innerHTML;
		const undo = R.markSpans(el, spans);
		const out = {
			html: el.innerHTML,
			text: el.textContent ?? '',
			marked: Array.from(el.querySelectorAll('mark.bt-search-hit')).map(m => m.textContent ?? ''),
			original,
			restoredHtml: '',
		};
		if (restore) { undo(); out.restoredHtml = el.innerHTML; }
		el.remove();
		return out;
	}, { html, spans, restore });
}

test.describe('markSpans', () => {
	test.beforeEach(async ({ renderReal }) => { await renderReal('---\nversion: 2\ncolumns:\n  - { id: c_0, name: A }\nrows:\n  - { id: r_0, cells: { c_0: x } }\n---\n'); });

	test('marks one range in plain text without changing the text', async ({ page }) => {
		const r = await run(page, 'hello world', [{ start: 6, end: 11 }]);
		expect(r.marked).toEqual(['world']);
		expect(r.text).toBe('hello world');
	});

	test('marks several ranges in order', async ({ page }) => {
		const r = await run(page, 'one two one', [{ start: 0, end: 3 }, { start: 8, end: 11 }]);
		expect(r.marked).toEqual(['one', 'one']);
		expect(r.text).toBe('one two one');
	});

	test('a range that crosses an element boundary is marked in each text node and keeps the element', async ({ page }) => {
		const r = await run(page, 'a <strong>bc</strong> d', [{ start: 0, end: 4 }]);
		expect(r.marked).toEqual(['a ', 'bc']);
		expect(r.html).toContain('<strong><mark class="bt-search-hit">bc</mark></strong>');
		expect(r.text).toBe('a bc d');
	});

	test('a hit inside a link keeps the link and its target', async ({ page }) => {
		const r = await run(page, 'see <a class="internal-link" href="Note">the note</a> now', [{ start: 4, end: 12 }]);
		expect(r.marked).toEqual(['the note']);
		expect(r.html).toContain('<a class="internal-link" href="Note"><mark class="bt-search-hit">the note</mark></a>');
	});

	test('restoring gives back exactly the markup that was there before', async ({ page }) => {
		const html = 'a <strong>bc</strong> d <a href="x">link</a> <code>c</code>';
		const r = await run(page, html, [{ start: 0, end: 4 }, { start: 8, end: 12 }], true);
		expect(r.html).not.toBe(r.original);
		expect(r.restoredHtml).toBe(r.original);
	});

	test('restoring also joins the split text back into the nodes it started with', async ({ page }) => {
		const counts = await page.evaluate(() => {
			const R = (window as any).RichTableReal;
			const el = document.createElement('div');
			el.innerHTML = 'hello <b>big</b> world';
			document.body.appendChild(el);
			const count = () => { let n = 0; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); while (w.nextNode()) n++; return n; };
			const before = count();
			const undo = R.markSpans(el, [{ start: 2, end: 4 }, { start: 8, end: 10 }]);
			const during = count();
			undo();
			const after = count();
			el.remove();
			return { before, during, after };
		});
		expect(counts.during).toBeGreaterThan(counts.before);
		expect(counts.after).toBe(counts.before);
	});

	test('the reader\'s own == highlight is neither counted as a hit nor removed on restore', async ({ page }) => {
		const html = 'x <mark>keep</mark> y';
		const r = await run(page, html, [{ start: 0, end: 1 }], true);
		expect(r.html).toContain('<mark>keep</mark>');
		expect(r.restoredHtml).toBe(r.original);
		expect(r.marked).toEqual(['x']);
	});

	test('empty, reversed and out-of-range spans do nothing and do not throw', async ({ page }) => {
		const r = await run(page, 'abc', [{ start: 1, end: 1 }, { start: 5, end: 2 }, { start: 90, end: 99 }]);
		expect(r.marked).toEqual([]);
		expect(r.html).toBe(r.original);
	});

	test('overlapping ranges become one mark over their union, with no text lost or repeated', async ({ page }) => {
		const r = await run(page, 'abcdef', [{ start: 0, end: 4 }, { start: 2, end: 6 }]);
		expect(r.marked).toEqual(['abcdef']);
		expect(r.text).toBe('abcdef');
	});

	test('touching ranges are merged into one mark', async ({ page }) => {
		const r = await run(page, 'abcdef', [{ start: 0, end: 3 }, { start: 3, end: 6 }]);
		expect(r.marked).toEqual(['abcdef']);
	});

	test('ranges given out of order are still applied', async ({ page }) => {
		const r = await run(page, 'one two', [{ start: 4, end: 7 }, { start: 0, end: 3 }]);
		expect(r.marked).toEqual(['one', 'two']);
	});

	test('text of an editor control is left alone', async ({ page }) => {
		const r = await run(page, 'ab<textarea>cd</textarea>', [{ start: 0, end: 4 }]);
		expect(r.html).toContain('<textarea>cd</textarea>');
	});

	test('counts UTF-16 units, so an emoji before the range does not shift it', async ({ page }) => {
		const r = await run(page, '😀 find', [{ start: 3, end: 7 }]);
		expect(r.marked).toEqual(['find']);
	});
});
