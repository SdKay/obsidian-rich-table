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
	test('marks and restores matches in rendered cell DOM', async ({ page, renderReal }) => {
		await renderReal('---\nversion: 2\ncolumns:\n  - { id: c_0, name: A }\nrows:\n  - { id: r_0, cells: { c_0: x } }\n---\n');

		await test.step('marks one range in plain text without changing the text', async () => {
			const r = await run(page, 'hello world', [{ start: 6, end: 11 }]);
			expect.soft(r.marked).toEqual(['world']);
			expect.soft(r.text).toBe('hello world');
		});

		await test.step('marks several ranges in order', async () => {
			const r = await run(page, 'one two one', [{ start: 0, end: 3 }, { start: 8, end: 11 }]);
			expect.soft(r.marked).toEqual(['one', 'one']);
			expect.soft(r.text).toBe('one two one');
		});

		await test.step('a range that crosses an element boundary is marked in each text node and keeps the element', async () => {
			const r = await run(page, 'a <strong>bc</strong> d', [{ start: 0, end: 4 }]);
			expect.soft(r.marked).toEqual(['a ', 'bc']);
			expect.soft(r.html).toContain('<strong><mark class="bt-search-hit">bc</mark></strong>');
			expect.soft(r.text).toBe('a bc d');
		});

		await test.step('a hit inside a link keeps the link and its target', async () => {
			const r = await run(page, 'see <a class="internal-link" href="Note">the note</a> now', [{ start: 4, end: 12 }]);
			expect.soft(r.marked).toEqual(['the note']);
			expect.soft(r.html).toContain('<a class="internal-link" href="Note"><mark class="bt-search-hit">the note</mark></a>');
		});

		await test.step('restoring gives back exactly the markup that was there before', async () => {
			const html = 'a <strong>bc</strong> d <a href="x">link</a> <code>c</code>';
			const r = await run(page, html, [{ start: 0, end: 4 }, { start: 8, end: 12 }], true);
			expect.soft(r.html).not.toBe(r.original);
			expect.soft(r.restoredHtml).toBe(r.original);
		});

		await test.step('restoring also joins the split text back into the nodes it started with', async () => {
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
			expect.soft(counts.during).toBeGreaterThan(counts.before);
			expect.soft(counts.after).toBe(counts.before);
		});

		await test.step('the reader\'s own == highlight is neither counted as a hit nor removed on restore', async () => {
			const html = 'x <mark>keep</mark> y';
			const r = await run(page, html, [{ start: 0, end: 1 }], true);
			expect.soft(r.html).toContain('<mark>keep</mark>');
			expect.soft(r.restoredHtml).toBe(r.original);
			expect.soft(r.marked).toEqual(['x']);
		});

		await test.step('empty, reversed and out-of-range spans do nothing and do not throw', async () => {
			const r = await run(page, 'abc', [{ start: 1, end: 1 }, { start: 5, end: 2 }, { start: 90, end: 99 }]);
			expect.soft(r.marked).toEqual([]);
			expect.soft(r.html).toBe(r.original);
		});

		await test.step('overlapping ranges become one mark over their union, with no text lost or repeated', async () => {
			const r = await run(page, 'abcdef', [{ start: 0, end: 4 }, { start: 2, end: 6 }]);
			expect.soft(r.marked).toEqual(['abcdef']);
			expect.soft(r.text).toBe('abcdef');
		});

		await test.step('touching ranges are merged into one mark', async () => {
			const r = await run(page, 'abcdef', [{ start: 0, end: 3 }, { start: 3, end: 6 }]);
			expect.soft(r.marked).toEqual(['abcdef']);
		});

		await test.step('ranges given out of order are still applied', async () => {
			const r = await run(page, 'one two', [{ start: 4, end: 7 }, { start: 0, end: 3 }]);
			expect.soft(r.marked).toEqual(['one', 'two']);
		});

		await test.step('text of an editor control is left alone', async () => {
			const r = await run(page, 'ab<textarea>cd</textarea>', [{ start: 0, end: 4 }]);
			expect.soft(r.html).toContain('<textarea>cd</textarea>');
		});

		await test.step('counts UTF-16 units, so an emoji before the range does not shift it', async () => {
			const r = await run(page, '😀 find', [{ start: 3, end: 7 }]);
			expect.soft(r.marked).toEqual(['find']);
		});

		await test.step('a table nested in the cell is not part of the cell\'s text and is left for its own block to mark', async () => {
			const r = await page.evaluate(() => {
				const R = (window as any).RichTableReal;
				const el = document.createElement('div');
				el.innerHTML = 'before <div class="bt-render-root"><table><tr><td>inner word</td></tr></table></div> after word';
				document.body.appendChild(el);
				const text = R.markableText(el);
				const needle = 'word';
				const spans: { start: number; end: number }[] = [];
				for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) spans.push({ start: i, end: i + needle.length });
				R.markSpans(el, spans);
				const out = {
					text,
					outer: Array.from(el.querySelectorAll('mark.bt-search-hit')).filter(m => !m.closest('.bt-render-root')).map(m => m.textContent),
					inner: el.querySelectorAll('.bt-render-root mark.bt-search-hit').length,
				};
				el.remove();
				return out;
			});
			expect.soft(r.text).toBe('before  after word');
			expect.soft(r.outer).toEqual(['word']);
			expect.soft(r.inner).toBe(0);
		});

		await test.step('offsets stay right when text comes both before and after a nested table', async () => {
			const r = await page.evaluate(() => {
				const R = (window as any).RichTableReal;
				const el = document.createElement('div');
				el.innerHTML = 'aaa <div class="bt-render-root">XXXXXXXX</div> bbb';
				document.body.appendChild(el);
				const text = R.markableText(el);
				const at = text.indexOf('bbb');
				R.markSpans(el, [{ start: at, end: at + 3 }]);
				const marked = Array.from(el.querySelectorAll('mark.bt-search-hit')).map(m => m.textContent);
				el.remove();
				return marked;
			});
			expect.soft(r).toEqual(['bbb']);
		});
	});
});
