import { test, expect } from '../../common/test-base';
import { buildXlsxFixtureBytes } from '../../common/build-xlsx-fixture';
import { loadWorkbook, fromArrayBuffer } from '@office-kit/xlsx/io';
import { getCell, getMergedCells } from '@office-kit/xlsx/worksheet';
import { getCellFont, getCellFill } from '@office-kit/xlsx/styles';

/**
 * The "Export as .xlsx" button — reachable only for a native (non xlsx-
 * backed) table (see tableBlock.ts's exportToXlsx doc comment). Exercises
 * the real click → modal → vault.createBinary path end to end; the actual
 * TableModelV2 -> xlsx byte conversion is covered separately and more
 * thoroughly at the unit level (test/xlsxExport.test.ts) — these tests are
 * about the surrounding UI/vault-write machinery unit tests can't reach.
 */
const SOURCE = `---
version: 2
columns:
  - { id: c_1, name: Task }
  - { id: c_2, name: Status }
styles:
  - { target: "header.c_1", bold: true, bg: "#4472c4" }
rows:
  - { id: r_1, cells: { c_1: Design, c_2: Done } }
  - { id: r_2, cells: { c_1: Code, c_2: WIP } }
merges:
  - { anchor: r_1.c_2, end: r_2.c_2 }
---
`;

const WORKBOOK_SOURCE = `---
version: 3
sheets:
  - id: s_1
    version: 2
    name: Plan
    columns: [{ id: c_1, name: A }]
    rows: [{ id: r_1, cells: { c_1: x } }]
    merges: []
    styles: []
  - id: s_2
    version: 2
    columns: [{ id: c_1, name: B }]
    rows: [{ id: r_1, cells: { c_1: y } }]
    merges: []
    styles: []
---
`;

async function readExportedXlsx(bytes: number[]) {
	return loadWorkbook(fromArrayBuffer(new Uint8Array(bytes).buffer));
}

test.describe('export as .xlsx (native tables)', () => {
	test('the button is present on a native table and absent on an xlsx-backed one', async ({ page, renderBlock }) => {
		await renderBlock(SOURCE);
		await expect(page.locator('.bt-ctrl-btn[aria-label="Export as .xlsx"]')).toHaveCount(1);

		const xlsxBytes = await buildXlsxFixtureBytes({ sheets: [{ name: 'S', grid: [['A'], ['x']] }] });
		await renderBlock(`---
version: 2
xlsxSource:
  path: data/budget.xlsx
---
`, { binaryFiles: { 'data/budget.xlsx': xlsxBytes } });
		await expect(page.locator('.bt-ctrl-btn[aria-label="Export as .xlsx"]')).toHaveCount(0);
	});

	test('clicking the button opens a modal with folder/filename fields defaulting from the note name', async ({ page, renderBlock }) => {
		await renderBlock(SOURCE, { sourcePath: 'notes/budget.md' });
		await page.locator('.bt-ctrl-btn[aria-label="Export as .xlsx"]').click();

		await expect(page.getByText('Export as .xlsx').first()).toBeVisible();
		const folderInput = page.locator('.setting-item', { hasText: 'Folder' }).locator('input');
		const filenameInput = page.locator('.setting-item', { hasText: 'File name' }).locator('input');
		await expect(folderInput).toHaveValue('notes');
		await expect(filenameInput).toHaveValue('budget.xlsx');
	});

	test('exporting writes a real, readable .xlsx file at the chosen vault path', async ({ page, renderBlock }) => {
		const block = await renderBlock(SOURCE, { sourcePath: 'notes/budget.md' });
		await page.locator('.bt-ctrl-btn[aria-label="Export as .xlsx"]').click();

		const filenameInput = page.locator('.setting-item', { hasText: 'File name' }).locator('input');
		await filenameInput.fill('MyExport.xlsx');
		await page.getByRole('button', { name: 'Export' }).click();

		await expect.poll(() => block.getNotices(), { timeout: 3000 })
			.toContainEqual(expect.stringContaining('notes/MyExport.xlsx'));

		const bytes = await block.readBinaryFile('notes/MyExport.xlsx');
		expect(bytes.length).toBeGreaterThan(0);
		const wb = await readExportedXlsx(bytes);
		const entry = wb.sheets[0];
		expect(entry?.kind).toBe('worksheet');
		if (entry?.kind !== 'worksheet') return;
		expect(getCell(entry.sheet, 1, 1)?.value).toBe('Task');
		expect(getCell(entry.sheet, 2, 1)?.value).toBe('Design');
		expect(getMergedCells(entry.sheet)).toContainEqual({ minRow: 2, minCol: 2, maxRow: 3, maxCol: 2 });

		const a1 = getCell(entry.sheet, 1, 1)!;
		expect(getCellFont(wb, a1).bold).toBe(true);
		const fill = getCellFill(wb, a1);
		expect(fill.kind).toBe('pattern');
	});

	test('the note itself is never modified by an export', async ({ page, renderBlock }) => {
		const block = await renderBlock(SOURCE, { sourcePath: 'notes/budget.md' });
		const before = await block.noteText();

		await page.locator('.bt-ctrl-btn[aria-label="Export as .xlsx"]').click();
		await page.getByRole('button', { name: 'Export' }).click();
		await expect.poll(() => block.getNotices(), { timeout: 3000 }).not.toHaveLength(0);

		expect(await block.noteText()).toBe(before);
	});

	test('exporting a multi-sheet workbook writes every sheet into the one file', async ({ page, renderBlock }) => {
		const block = await renderBlock(WORKBOOK_SOURCE, { sourcePath: 'notes/plan.md' });
		await page.locator('.bt-ctrl-btn[aria-label="Export as .xlsx"]').click();
		await page.getByRole('button', { name: 'Export' }).click();

		await expect.poll(() => block.getNotices(), { timeout: 3000 }).not.toHaveLength(0);
		const bytes = await block.readBinaryFile('notes/plan.xlsx');
		const wb = await readExportedXlsx(bytes);
		const titles = wb.sheets.map(s => (s.kind === 'worksheet' ? s.sheet.title : null));
		expect(titles).toEqual(['Plan', 'Sheet 2']);
	});

	test('the modal has two separate sections — in-vault fields+Export, and a standalone custom-location button', async ({ page, renderBlock }) => {
		await renderBlock(SOURCE, { sourcePath: 'notes/budget.md' });
		await page.locator('.bt-ctrl-btn[aria-label="Export as .xlsx"]').click();

		await expect(page.getByText('In this vault')).toBeVisible();
		await expect(page.getByText('Custom location')).toBeVisible();
		// Exactly one Export button (the in-vault section's own) — the custom-
		// location section has no second confirm click of its own, since its
		// one button already IS the confirmation (see XlsxSaveModal's own doc
		// comment on why exporting via the native dialog is one click, not two).
		await expect(page.getByRole('button', { name: 'Export', exact: true })).toHaveCount(1);
		await expect(page.getByRole('button', { name: 'Choose location…' })).toHaveCount(1);
	});

	test('exporting to an already-existing vault path prompts to overwrite, and only writes after confirming', async ({ page, renderBlock }) => {
		const block = await renderBlock(SOURCE, { sourcePath: 'notes/budget.md', binaryFiles: { 'notes/budget.xlsx': [1, 2, 3] } });
		await page.locator('.bt-ctrl-btn[aria-label="Export as .xlsx"]').click();
		await page.getByRole('button', { name: 'Export' }).click();

		await expect(page.getByText('File already exists')).toBeVisible();
		const before = await block.readBinaryFile('notes/budget.xlsx');
		expect(before).toEqual([1, 2, 3]);

		await page.getByRole('button', { name: 'Overwrite' }).click();
		await expect.poll(async () => (await block.readBinaryFile('notes/budget.xlsx')).length).toBeGreaterThan(3);
	});
});
