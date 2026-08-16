import { test, expect } from '../../common/test-base';
import { scrollableTable } from '../../common/fixtures';

// Reported: pasting a standard Markdown pipe table into a cell put the whole
// thing into a single cell instead of splitting it into a grid. Root cause
// (renderEditMode.ts's paste handler): the ONLY signal it looked for was an
// HTML <table> in the clipboard's text/html payload — true for Excel/Sheets,
// never true for a table typed by hand, copied from another note, or pasted
// from an LLM reply/GitHub, all of which carry only text/plain. Fixed by
// falling back to recognizing a GFM pipe table in the plain text itself
// (parseMarkdownPipeTable, renderClipboard.ts, unit-tested directly in
// test/renderClipboard.test.ts) when the HTML check doesn't match.
test.describe('clipboard-paste', () => {
	const SOURCE = scrollableTable({ theme: 'grid' });
	const CELL = '.bt-td[data-row="1"][data-col="0"]';

	const startEditing = async (page: import('@playwright/test').Page) => {
		await page.locator(CELL).first().click();
		await expect.poll(() => page.locator(`${CELL}.bt-editing`).count()).toBe(1);
	};

	const pasteInto = (page: import('@playwright/test').Page, text: string, html?: string) =>
		page.evaluate(({ text, html }) => {
			const dt = new DataTransfer();
			dt.setData('text/plain', text);
			if (html) dt.setData('text/html', html);
			const editor = document.querySelector('.bt-editing .bt-cell-editor, .bt-editing.bt-cell-editor');
			const evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
			editor?.dispatchEvent(evt);
		}, { text, html });

	const ops = (page: import('@playwright/test').Page) =>
		page.evaluate(() => (window as unknown as { __btOps: { type: string; values?: string[][] }[] }).__btOps);

	test('a Markdown pipe table pasted as plain text splits into a grid', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await pasteInto(page, '| a | b |\n| --- | --- |\n| 1 | 2 |');

		const pasteOps = (await ops(page)).filter(o => o.type === 'paste-values');
		expect(pasteOps).toHaveLength(1);
		expect(pasteOps[0]!.values).toEqual([['a', 'b'], ['1', '2']]);
	});

	test('an Excel/Sheets-style paste (HTML table alongside TSV) still splits into a grid', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await pasteInto(page, '1\t2\n3\t4', '<table><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>');

		const pasteOps = (await ops(page)).filter(o => o.type === 'paste-values');
		expect(pasteOps).toHaveLength(1);
		expect(pasteOps[0]!.values).toEqual([['1', '2'], ['3', '4']]);
	});

	// Reported second: copying a RENDERED table (e.g. via Obsidian's own "copy
	// table" action on a native Markdown table) puts a real <table> in
	// text/html — same as Excel/Sheets — but its text/plain is the ORIGINAL
	// MARKDOWN PIPE SOURCE, not TSV. Splitting that on '\t' left every
	// pipe-delimited line as one giant unsplit cell (every row landed in
	// column A). Fixed by parsing the HTML table's own DOM structure
	// (parseHtmlTable, renderClipboard.ts) instead of trusting text/plain to
	// be tab-separated whenever an HTML table is present.
	test('an HTML table whose text/plain is markdown source (not TSV) still splits correctly', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		const html = '<table><tr><td>menuconfig 选项</td><td>内部 CONFIG</td></tr>'
			+ '<tr><td><code>WHC_IPC</code>（默认）</td><td><code>CONFIG_WHC_IPC</code></td></tr></table>';
		const plainMarkdownSource = '| menuconfig 选项 | 内部 CONFIG |\n| --- | --- |\n| `WHC_IPC`（默认） | `CONFIG_WHC_IPC` |';
		await pasteInto(page, plainMarkdownSource, html);

		const pasteOps = (await ops(page)).filter(o => o.type === 'paste-values');
		expect(pasteOps).toHaveLength(1);
		expect(pasteOps[0]!.values).toEqual([
			['menuconfig 选项', '内部 CONFIG'],
			['WHC_IPC（默认）', 'CONFIG_WHC_IPC'],
		]);
	});

	test('ordinary multi-line prose is left as native single-cell paste, not split', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await pasteInto(page, 'just some text\nacross two lines');

		const pasteOps = (await ops(page)).filter(o => o.type === 'paste-values');
		expect(pasteOps).toHaveLength(0);
	});

	// Table-format conversion: pasting a whole copied/typed table (header row
	// included) onto a HEADER cell renames columns from the pasted header and
	// fills data rows from the rest, instead of the plain data-cell paste's
	// "fill starting at this exact row" (which has no concept of a column
	// name at all — see paste-values-with-header's own comment, operations.ts).
	test('pasting a Markdown table onto a header cell renames columns and fills data', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		const HEADER_CELL = '.bt-th[data-row="0"][data-col="0"]';
		await page.locator(HEADER_CELL).first().click();
		await expect.poll(() => page.locator(`${HEADER_CELL}.bt-editing`).count()).toBe(1);

		await pasteInto(page, '| Name | Age |\n| --- | --- |\n| Alice | 30 |');

		const pasteOps = (await ops(page)).filter(o => o.type === 'paste-values-with-header') as
			{ type: string; anchorColId?: string; values?: string[][] }[];
		expect(pasteOps).toHaveLength(1);
		expect(pasteOps[0]!.values).toEqual([['Name', 'Age'], ['Alice', '30']]);
	});
});
