import { test, expect } from '../common/test-base';
import { buildXlsxFixtureBytes } from '../common/build-xlsx-fixture';
import { readXlsxAsModel } from '../../../src/xlsxSource';
import type { TableModelV2, WorkbookV3 } from '../../../src/model';

function asSingle(model: TableModelV2 | WorkbookV3): TableModelV2 {
	if ('sheets' in model) throw new Error('expected a single-sheet model');
	return model;
}

/**
 * Exercises tableBlock.ts's xlsx-backed-table feature end to end: an
 * xlsxSource block loads a REAL .xlsx file (built via @office-kit/xlsx's own
 * writer, same legitimate-fixture reasoning as test/xlsxSource.test.ts) through
 * the real render()/readXlsxAsModel path, a fake vault/metadataCache standing
 * in for Obsidian's own (see obsidian-shim.ts's FakeVault/FakeMetadataCache).
 *
 * Conversion of xlsx bytes → TableModelV2 is already covered at the unit
 * level (test/xlsxSource.test.ts) — these tests are about the surrounding
 * tableBlock.ts machinery that unit tests can't reach at all: view-only UI
 * gating, the vault-event watchers, and real write-backs into the note.
 */
const XLSX_PATH = 'data/budget.xlsx';

function blockSource(path = XLSX_PATH): string {
	return `---
version: 2
xlsxSource:
  path: ${path}
---
`;
}

test.describe('xlsx-backed table', () => {
	test('renders the referenced file\'s content and offers only phase-1 editing (cell content + merge)', async ({ page, renderBlock }) => {
		const bytes = await buildXlsxFixtureBytes({
			sheets: [{ name: 'Sheet1', grid: [['Task', 'Status'], ['Design', 'Done'], ['Code', 'WIP']] }],
		});
		const block = await renderBlock(blockSource(), { binaryFiles: { [XLSX_PATH]: bytes } });

		await expect(page.locator('.bt-th-text').first()).toHaveText('Task');
		await expect(page.locator('.bt-td').first()).toHaveText('Design');

		// Phase 1 of xlsx WRITE support (see CLAUDE.md): cell content editing IS
		// available now — onCellChange is wired from the narrower onXlsxWrite
		// entry point, not the general onOp (see renderer.ts's onCellChange
		// derivation), so bindCellActivation/'.bt-td-editable' DO show up.
		await expect(page.locator('.bt-td-editable').first()).toBeVisible();
		await page.locator('.bt-td').first().click();
		await expect(page.locator('.bt-editing')).toHaveCount(1);
		await page.keyboard.press('Escape');

		// But no full structural editing: onStructuralOp itself stays undefined,
		// so nothing gated on it (drag-select hover strips, row/col insert-delete,
		// sort, freeze, style panel, …) is reachable.
		await expect(page.locator('.bt-col-selector')).toHaveCount(0);
		await expect(page.locator('.bt-row-selector')).toHaveCount(0);

		// The two xlsx-only buttons are present…
		await expect(page.locator('.bt-ctrl-btn[aria-label="Open in default app"]')).toHaveCount(1);
		await expect(page.locator('.bt-ctrl-btn[aria-label="Convert to plain table (stop referencing the file)"]')).toHaveCount(1);
		// …but the lock button (onToggleLock-only) is not — nothing to lock.
		await expect(page.locator('.bt-ctrl-btn.is-locked')).toHaveCount(0);

		const note = await block.noteText();
		expect(note).toContain('xlsxSource:');
		expect(note).not.toContain('columns:'); // dead weight for this block shape — see serializer.ts
	});

	test('the cell panel hides background/text-color/size/bold/italic controls, since there is no write path for them yet', async ({ page, renderBlock }) => {
		const bytes = await buildXlsxFixtureBytes({
			sheets: [{ name: 'Sheet1', grid: [['Task', 'Status'], ['Design', 'Done'], ['Code', 'Done']], merges: ['B2:B3'] }],
		});
		await renderBlock(blockSource(), { binaryFiles: { [XLSX_PATH]: bytes } });

		// Double-click a plain (non-merged) data cell — classic mode's panel gesture.
		await page.locator('.bt-td[data-row="1"][data-col="0"]').first().dblclick();
		await expect(page.locator('.bt-cell-panel')).toBeVisible();
		await expect(page.locator('.bt-cp-style')).toHaveCount(0);
		await page.keyboard.press('Escape');

		// Double-click the merged cell — it offers "Unmerge", same no-style-controls treatment.
		await page.locator('.bt-td[data-row="1"][data-col="1"]').first().dblclick();
		await expect(page.locator('.bt-cell-panel')).toBeVisible();
		await expect(page.locator('.bt-cp-style')).toHaveCount(0);
		await expect(page.getByText('Unmerge cells', { exact: false })).toBeVisible();
	});

	test('editing a cell writes the new value into the referenced .xlsx file itself, never the note', async ({ page, renderBlock }) => {
		const bytes = await buildXlsxFixtureBytes({
			sheets: [{ name: 'Sheet1', grid: [['Task', 'Status'], ['Design', 'Done']] }],
		});
		const block = await renderBlock(blockSource(), { binaryFiles: { [XLSX_PATH]: bytes } });
		const noteBefore = await block.noteText();

		await page.locator('.bt-td[data-row="1"][data-col="0"]').first().click();
		await expect(page.locator('.bt-editing')).toHaveCount(1);
		await page.keyboard.type('Redesign');
		await page.keyboard.press('Enter');

		await expect.poll(async () => {
			const written = await block.readBinaryFile(XLSX_PATH);
			const model = asSingle(await readXlsxAsModel(new Uint8Array(written).buffer));
			return model.rows[0]!.cells[model.columns[0]!.id];
		}, { timeout: 3000 }).toBe('Redesign');

		// The note itself never changes — the real content lives in the xlsx file.
		expect(await block.noteText()).toBe(noteBefore);
	});

	test('a write that fails (e.g. file locked by another program) shows a Notice and reverts the stale on-screen edit', async ({ page, renderBlock }) => {
		const bytes = await buildXlsxFixtureBytes({
			sheets: [{ name: 'Sheet1', grid: [['Task', 'Status'], ['Design', 'Done']] }],
		});
		const block = await renderBlock(blockSource(), { binaryFiles: { [XLSX_PATH]: bytes } });
		await block.lockBinaryFile(XLSX_PATH);

		await page.locator('.bt-td[data-row="1"][data-col="0"]').first().click();
		await expect(page.locator('.bt-editing')).toHaveCount(1);
		await page.keyboard.type('Redesign');
		await page.keyboard.press('Enter');

		// A Notice is shown — the failure is never silent.
		await expect.poll(() => block.getNotices(), { timeout: 3000 })
			.toContainEqual(expect.stringContaining('Could not save to the .xlsx file'));

		// The file itself was never touched...
		const written = await block.readBinaryFile(XLSX_PATH);
		const model = asSingle(await readXlsxAsModel(new Uint8Array(written).buffer));
		expect(model.rows[0]!.cells[model.columns[0]!.id]).toBe('Design');

		// ...and the on-screen cell reverts to match — it must NOT keep showing
		// the typed text as if the save had actually gone through.
		await expect(page.locator('.bt-td[data-row="1"][data-col="0"]').first()).toHaveText('Design');
	});

	test('editing the header cell renames the underlying xlsx column (row 1)', async ({ page, renderBlock }) => {
		const bytes = await buildXlsxFixtureBytes({
			sheets: [{ name: 'Sheet1', grid: [['Task', 'Status'], ['Design', 'Done']] }],
		});
		const block = await renderBlock(blockSource(), { binaryFiles: { [XLSX_PATH]: bytes } });

		await page.locator('.bt-th-text').first().click();
		await expect(page.locator('.bt-editing')).toHaveCount(1);
		await page.keyboard.type('Task Name');
		await page.keyboard.press('Enter');

		await expect.poll(async () => {
			const written = await block.readBinaryFile(XLSX_PATH);
			const model = asSingle(await readXlsxAsModel(new Uint8Array(written).buffer));
			return model.columns[0]!.name;
		}, { timeout: 3000 }).toBe('Task Name');
	});

	test('unmerging an existing merge via the cell panel writes it back into the xlsx file', async ({ page, renderBlock }) => {
		const bytes = await buildXlsxFixtureBytes({
			// mergeCells drops every cell but the merge's top-left from ws.rows, so
			// row 3 needs a value OUTSIDE the merged column (here, column A) or
			// usedBounds sees an entirely empty row and the row disappears outright.
			sheets: [{ name: 'Sheet1', grid: [['Task', 'Status'], ['Design', 'Done'], ['Code', 'Done']], merges: ['B2:B3'] }],
		});
		const block = await renderBlock(blockSource(), { binaryFiles: { [XLSX_PATH]: bytes } });

		const before = asSingle(await readXlsxAsModel(new Uint8Array(await block.readBinaryFile(XLSX_PATH)).buffer));
		expect(before.merges).toHaveLength(1);

		// Double-click the merged cell (data-row=1 is the first data row, data-col=1
		// is the Status column) to open its panel — classic (non-singleClickEdit)
		// mode's panel gesture — then click "Unmerge".
		await page.locator('.bt-td[data-row="1"][data-col="1"]').first().dblclick();
		await page.getByText('Unmerge cells', { exact: false }).click();

		await expect.poll(async () => {
			const written = await block.readBinaryFile(XLSX_PATH);
			const model = asSingle(await readXlsxAsModel(new Uint8Array(written).buffer));
			return model.merges.length;
		}, { timeout: 3000 }).toBe(0);
	});

	test('dragging across cells and clicking "Merge cells" creates a new merge in the xlsx file', async ({ page, renderBlock }) => {
		const bytes = await buildXlsxFixtureBytes({
			sheets: [{ name: 'Sheet1', grid: [['Task', 'Status'], ['Design', 'Done'], ['Code', 'WIP']] }],
		});
		const block = await renderBlock(blockSource(), { binaryFiles: { [XLSX_PATH]: bytes } });

		const before = asSingle(await readXlsxAsModel(new Uint8Array(await block.readBinaryFile(XLSX_PATH)).buffer));
		expect(before.merges).toHaveLength(0);

		// Drag from the first data row down into the second, same column — a
		// vertical range — same drag-select gesture a fully-editable table uses
		// (see locked-table-copy.spec.ts's editable-table test for the pattern).
		const cellA = page.locator('.bt-td[data-row="1"][data-col="0"]').first();
		const cellB = page.locator('.bt-td[data-row="2"][data-col="0"]').first();
		const boxA = (await cellA.boundingBox())!;
		const boxB = (await cellB.boundingBox())!;
		await page.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
		await page.mouse.down();
		await page.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2, { steps: 5 });
		await page.mouse.up();

		await page.getByText('Merge cells', { exact: false }).click();

		await expect.poll(async () => {
			const written = await block.readBinaryFile(XLSX_PATH);
			const model = asSingle(await readXlsxAsModel(new Uint8Array(written).buffer));
			return model.merges;
		}, { timeout: 3000 }).toContainEqual({ anchor: 'r_2.c_1', end: 'r_3.c_1' });
	});

	test('auto-refreshes (debounced) when the external file is modified', async ({ page, renderBlock }) => {
		const before = await buildXlsxFixtureBytes({ sheets: [{ name: 'S', grid: [['A'], ['one']] }] });
		const after  = await buildXlsxFixtureBytes({ sheets: [{ name: 'S', grid: [['A'], ['two']] }] });
		const block = await renderBlock(blockSource(), { binaryFiles: { [XLSX_PATH]: before } });
		await expect(page.locator('.bt-td').first()).toHaveText('one');

		await block.writeBinaryAndNotify(XLSX_PATH, after);
		// Refresh is debounced ~400ms — poll rather than asserting immediately.
		await expect.poll(() => page.locator('.bt-td').first().textContent(), { timeout: 3000 }).toBe('two');
	});

	test('a burst of modify events collapses into a single refresh', async ({ page, renderBlock }) => {
		const v1 = await buildXlsxFixtureBytes({ sheets: [{ name: 'S', grid: [['A'], ['v1']] }] });
		const v2 = await buildXlsxFixtureBytes({ sheets: [{ name: 'S', grid: [['A'], ['v2']] }] });
		const v3 = await buildXlsxFixtureBytes({ sheets: [{ name: 'S', grid: [['A'], ['v3']] }] });
		const block = await renderBlock(blockSource(), { binaryFiles: { [XLSX_PATH]: v1 } });
		await expect(page.locator('.bt-td').first()).toHaveText('v1');

		// Three rapid saves, well inside the 400ms debounce window.
		await block.writeBinaryAndNotify(XLSX_PATH, v2);
		await block.writeBinaryAndNotify(XLSX_PATH, v3);
		await expect.poll(() => page.locator('.bt-td').first().textContent(), { timeout: 3000 }).toBe('v3');
	});

	test('rewrites xlsxSource.path in the note when the file is renamed', async ({ page, renderBlock }) => {
		const bytes = await buildXlsxFixtureBytes({ sheets: [{ name: 'S', grid: [['A'], ['x']] }] });
		const block = await renderBlock(blockSource(), { binaryFiles: { [XLSX_PATH]: bytes } });
		await expect(page.locator('.bt-td').first()).toHaveText('x');

		await block.renameBinaryAndNotify(XLSX_PATH, 'moved/new-name.xlsx');
		await expect.poll(() => block.noteText()).toContain('moved/new-name.xlsx');
		expect(await block.noteText()).not.toContain(XLSX_PATH);
		// handleXlsxRenamed only rewrites the note — it doesn't re-render this
		// instance (the file's own content, and thus what's on screen, hasn't
		// changed). The real point of the fix only shows up on the NEXT
		// reprocess: without it, the note would still point at the now-gone
		// old path and this would throw "file not found" instead of resolving.
		await expect(page.locator('.bt-td').first()).toHaveText('x');
		await block.reprocess();
		await expect(page.locator('.bt-error')).toHaveCount(0);
		await expect(page.locator('.bt-td').first()).toHaveText('x');
	});

	test('shows the error banner when the file is deleted', async ({ page, renderBlock }) => {
		const bytes = await buildXlsxFixtureBytes({ sheets: [{ name: 'S', grid: [['A'], ['x']] }] });
		const block = await renderBlock(blockSource(), { binaryFiles: { [XLSX_PATH]: bytes } });
		await expect(page.locator('.bt-td').first()).toHaveText('x');

		await block.deleteBinaryAndNotify(XLSX_PATH);
		await expect(page.locator('.bt-error')).toBeVisible({ timeout: 3000 });
		await expect(page.locator('.bt-error')).toContainText(XLSX_PATH);
	});

	test('drag-resizing the view persists viewWidth/viewHeight into the note', async ({ page, renderBlock }) => {
		const bytes = await buildXlsxFixtureBytes({ sheets: [{ name: 'S', grid: [['A', 'B'], ['x', 'y']] }] });
		const block = await renderBlock(blockSource(), { binaryFiles: { [XLSX_PATH]: bytes } });
		expect(await block.noteText()).not.toContain('viewWidth');

		const handle = page.locator('.bt-view-resize-br');
		const box = await handle.boundingBox();
		if (!box) throw new Error('resize handle has no box — did onSetViewWidth/Height fail to gate it in?');
		// The corner handle's box geometrically overlaps the edge handles'
		// (bt-view-resize-r/-b) along its own right/bottom margins — clicking
		// dead center can land on whichever edge handle happens to paint on
		// top there instead of the corner ('both') handle, silently firing
		// only one of onSetViewWidth/onSetViewHeight. The corner box's own
		// top-left is never covered by either edge handle, so start there.
		await page.mouse.move(box.x + 2, box.y + 2);
		await page.mouse.down();
		await page.mouse.move(box.x + 120, box.y + 60, { steps: 5 });
		await page.mouse.up();

		await expect.poll(() => block.noteText()).toContain('viewWidth:');
		expect(await block.noteText()).toContain('viewHeight:');
		// Still xlsx-backed afterward — resizing the view is not a detach.
		expect(await block.noteText()).toContain('xlsxSource:');
	});

	test('"convert to plain table" inlines real content and drops xlsxSource', async ({ page, renderBlock }) => {
		const bytes = await buildXlsxFixtureBytes({ sheets: [{ name: 'S', grid: [['A'], ['hello']] }] });
		const block = await renderBlock(blockSource(), { binaryFiles: { [XLSX_PATH]: bytes } });
		await expect(page.locator('.bt-td').first()).toHaveText('hello');

		await page.locator('.bt-ctrl-btn[aria-label="Convert to plain table (stop referencing the file)"]').click();
		await expect.poll(() => block.noteText()).not.toContain('xlsxSource');
		const note = await block.noteText();
		expect(note).toContain('hello');
		expect(note).toContain('columns:');

		// The table is now a normal, fully-editable one.
		await block.reprocess();
		await expect(page.locator('.bt-td').first()).toHaveText('hello');
		await expect(page.locator('.bt-td-editable').first()).toBeVisible();
	});

	// The theme picker button needs onStructuralOp, which an xlsx-backed table
	// never has (queueOp's isXlsxBacked guard would drop the write anyway) — so
	// it can't switch themes interactively. Defaults to 'grid' instead of the
	// no-theme look every other kind of table defaults to, since a plain look
	// reads worse against a spreadsheet-shaped table than an explicit gridline
	// theme does.
	test('defaults to the grid theme, with no interactive picker', async ({ page, renderBlock }) => {
		const bytes = await buildXlsxFixtureBytes({ sheets: [{ name: 'S', grid: [['A'], ['1']] }] });
		await renderBlock(blockSource(), { binaryFiles: { [XLSX_PATH]: bytes } });

		await expect(page.locator('.bt-render-root.bt-theme-grid')).toHaveCount(1);
		await expect(page.locator('.bt-ctrl-btn[aria-label="Change table theme"]')).toHaveCount(0);
	});

	// A theme hand-written into the block's own YAML is preserved rather than
	// overridden — the same shell-preservation treatment viewWidth/viewHeight
	// already get for an xlsx-backed table.
	test('honors a theme hand-written into the block\'s own YAML', async ({ page, renderBlock }) => {
		const bytes = await buildXlsxFixtureBytes({ sheets: [{ name: 'S', grid: [['A'], ['1']] }] });
		const source = `---
version: 2
xlsxSource:
  path: ${XLSX_PATH}
theme: academic
---
`;
		await renderBlock(source, { binaryFiles: { [XLSX_PATH]: bytes } });

		await expect(page.locator('.bt-render-root.bt-theme-academic')).toHaveCount(1);
		await expect(page.locator('.bt-render-root.bt-theme-grid')).toHaveCount(0);
	});
});
