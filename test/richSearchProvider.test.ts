import { describe, it, expect } from 'vitest';
import { createWorkbook, addWorksheet } from '@office-kit/xlsx/workbook';
import { setCell } from '@office-kit/xlsx/worksheet';
import { saveWorkbook, toArrayBuffer } from '@office-kit/xlsx/io';
import { createRichSearchProvider, type RichSearchProviderHost } from '../src/richSearchProvider';
import type { WorkspaceLeaf } from 'obsidian';

async function workbookBytes(): Promise<ArrayBuffer> {
	const wb = createWorkbook();
	setCell(addWorksheet(wb, 'Sheet1'), 4, 2, 'needle');
	const sink = toArrayBuffer();
	await saveWorkbook(wb, sink);
	return sink.result();
}

const host = (over: Partial<RichSearchProviderHost> = {}): RichSearchProviderHost => ({
	viewRegistered: () => false,
	revealInNote: () => Promise.resolve(false),
	...over,
});
const leaf = {} as WorkspaceLeaf;

describe('createRichSearchProvider', () => {
	it('declares the contract fields: apiVersion 1, lower-case extensions without a dot, a numeric extractVersion', () => {
		const provider = createRichSearchProvider(host());
		expect(provider.apiVersion).toBe(1);
		expect(provider.extensions).toEqual(['xlsx']);
		expect(provider.extensions.every(e => e === e.toLowerCase() && !e.startsWith('.'))).toBe(true);
		expect(typeof provider.extractVersion).toBe('number');
	});

	it('extract hands the bytes to the xlsx reader and returns its lines', async () => {
		const provider = createRichSearchProvider(host());
		const result = await provider.extract({ path: 'Book.xlsx', content: await workbookBytes() });
		expect(result).toEqual({
			ok: true,
			value: [{ text: 'needle', location: 'Sheet1!B4', anchor: { sheet: 'Sheet1', row: 4, col: 2 } }],
		});
	});

	it('extract never throws: a bad file is an error result', async () => {
		const provider = createRichSearchProvider(host());
		const result = await provider.extract({ path: 'Bad.xlsx', content: new ArrayBuffer(3) });
		expect(result.ok).toBe(false);
	});

	it('reports whether the xlsx view is really registered, as told by the plugin', () => {
		expect(createRichSearchProvider(host()).viewRegistered?.('xlsx')).toBe(false);
		expect(createRichSearchProvider(host({ viewRegistered: () => true })).viewRegistered?.('xlsx')).toBe(true);
	});

	it('reads the registration state each time it is asked, so a later registration is seen', () => {
		let registered = false;
		const provider = createRichSearchProvider(host({ viewRegistered: () => registered }));
		expect(provider.viewRegistered?.('xlsx')).toBe(false);
		registered = true;
		expect(provider.viewRegistered?.('xlsx')).toBe(true);
	});

	it('does not claim a view for an extension it does not serve', () => {
		expect(createRichSearchProvider(host({ viewRegistered: () => true })).viewRegistered?.('pptx')).toBe(false);
	});

	it('claims the rich-table fence language and nothing else', () => {
		expect(createRichSearchProvider(host()).blockLanguages).toEqual(['rich-table']);
	});

	it('extractBlock reads a table block and returns what a reader sees', async () => {
		const provider = createRichSearchProvider(host());
		const result = await provider.extractBlock?.({
			path: 'Note.md', language: 'rich-table',
			source: '---\nversion: 2\ncolumns:\n  - { id: c_a, name: Task }\nrows:\n  - { id: r_1, cells: { c_a: needle } }\n---\n',
		});
		expect(result).toEqual({
			ok: true,
			value: [
				{ text: 'Task', location: 'A1', anchor: { kind: 'header', colId: 'c_a' } },
				{ text: 'needle', location: 'A2', anchor: { kind: 'cell', rowId: 'r_1', colId: 'c_a' } },
			],
		});
	});

	it('extractBlock refuses a language it does not own, as an error result and not an exception', async () => {
		const provider = createRichSearchProvider(host());
		// A source that would read fine as a table: only the language says it is not ours.
		const validTable = '---\nversion: 2\ncolumns:\n  - { id: c_a, name: Task }\nrows: []\n---\n';
		const result = await provider.extractBlock?.({ path: 'Note.md', language: 'mermaid', source: validTable });
		expect(result?.ok).toBe(false);
	});

	it('changes extractVersion when either reader\'s version changes', async () => {
		const { XLSX_EXTRACT_VERSION } = await import('../src/xlsxExtract');
		const { BLOCK_EXTRACT_VERSION } = await import('../src/blockExtract');
		const v = createRichSearchProvider(host()).extractVersion;
		expect(v).toBe(XLSX_EXTRACT_VERSION * 1000 + BLOCK_EXTRACT_VERSION);
		expect(v).not.toBe((XLSX_EXTRACT_VERSION + 1) * 1000 + BLOCK_EXTRACT_VERSION);
		expect(v).not.toBe(XLSX_EXTRACT_VERSION * 1000 + BLOCK_EXTRACT_VERSION + 1);
	});

	it('revealBlock hands a valid target to the note view and returns its answer', async () => {
		const calls: unknown[][] = [];
		const provider = createRichSearchProvider(host({ revealInNote: (...a) => { calls.push(a); return Promise.resolve(true); } }));
		const anchor = { kind: 'cell', rowId: 'r_1', colId: 'c_a' };
		const result = await provider.revealBlock?.(leaf, { fromLine: 7, anchor }, { query: 'x', wholeWord: true });
		expect(result).toBe(true);
		expect(calls).toEqual([[leaf, 7, anchor, { query: 'x', wholeWord: true }]]);
	});

	it('revealBlock passes on a false answer', async () => {
		const provider = createRichSearchProvider(host({ revealInNote: () => Promise.resolve(false) }));
		expect(await provider.revealBlock?.(leaf, { fromLine: 1, anchor: { kind: 'title' } }, { query: 'x' })).toBe(false);
	});

	it('revealBlock answers false, without asking the note view, for an anchor or line it cannot use', async () => {
		let asked = 0;
		const provider = createRichSearchProvider(host({ revealInNote: () => { asked++; return Promise.resolve(true); } }));
		for (const anchor of [null, undefined, 5, 'cell', {}, { kind: 'cell' }, { kind: 'cell', rowId: 'r', colId: 7 }, { kind: 'footer', line: -1 }, { kind: 'sheet' }, { kind: 'nope' }]) {
			expect(await provider.revealBlock?.(leaf, { fromLine: 1, anchor }, { query: 'x' })).toBe(false);
		}
		expect(await provider.revealBlock?.(leaf, { fromLine: 1.5, anchor: { kind: 'title' } }, { query: 'x' })).toBe(false);
		expect(await provider.revealBlock?.(leaf, { fromLine: Number.NaN, anchor: { kind: 'title' } }, { query: 'x' })).toBe(false);
		expect(asked).toBe(0);
	});

	it('revealBlock answers false, not an error, when the note view fails', async () => {
		const provider = createRichSearchProvider(host({ revealInNote: () => Promise.reject(new Error('boom')) }));
		expect(await provider.revealBlock?.(leaf, { fromLine: 1, anchor: { kind: 'title' } }, { query: 'x' })).toBe(false);
	});
});
