import { describe, it, expect } from 'vitest';
import { createWorkbook, addWorksheet } from '@office-kit/xlsx/workbook';
import { setCell } from '@office-kit/xlsx/worksheet';
import { saveWorkbook, toArrayBuffer } from '@office-kit/xlsx/io';
import { createRichSearchProvider } from '../src/richSearchProvider';

async function workbookBytes(): Promise<ArrayBuffer> {
	const wb = createWorkbook();
	setCell(addWorksheet(wb, 'Sheet1'), 4, 2, 'needle');
	const sink = toArrayBuffer();
	await saveWorkbook(wb, sink);
	return sink.result();
}

describe('createRichSearchProvider', () => {
	it('declares the contract fields: apiVersion 1, lower-case extensions without a dot, a numeric extractVersion', () => {
		const provider = createRichSearchProvider({ viewRegistered: () => false });
		expect(provider.apiVersion).toBe(1);
		expect(provider.extensions).toEqual(['xlsx']);
		expect(provider.extensions.every(e => e === e.toLowerCase() && !e.startsWith('.'))).toBe(true);
		expect(typeof provider.extractVersion).toBe('number');
	});

	it('extract hands the bytes to the xlsx reader and returns its lines', async () => {
		const provider = createRichSearchProvider({ viewRegistered: () => false });
		const result = await provider.extract({ path: 'Book.xlsx', content: await workbookBytes() });
		expect(result).toEqual({
			ok: true,
			value: [{ text: 'needle', location: 'Sheet1!B4', anchor: { sheet: 'Sheet1', row: 4, col: 2 } }],
		});
	});

	it('extract never throws: a bad file is an error result', async () => {
		const provider = createRichSearchProvider({ viewRegistered: () => false });
		const result = await provider.extract({ path: 'Bad.xlsx', content: new ArrayBuffer(3) });
		expect(result.ok).toBe(false);
	});

	it('reports whether the xlsx view is really registered, as told by the plugin', () => {
		expect(createRichSearchProvider({ viewRegistered: () => false }).viewRegistered?.('xlsx')).toBe(false);
		expect(createRichSearchProvider({ viewRegistered: () => true }).viewRegistered?.('xlsx')).toBe(true);
	});

	it('reads the registration state each time it is asked, so a later registration is seen', () => {
		let registered = false;
		const provider = createRichSearchProvider({ viewRegistered: () => registered });
		expect(provider.viewRegistered?.('xlsx')).toBe(false);
		registered = true;
		expect(provider.viewRegistered?.('xlsx')).toBe(true);
	});

	it('does not claim a view for an extension it does not serve', () => {
		expect(createRichSearchProvider({ viewRegistered: () => true }).viewRegistered?.('pptx')).toBe(false);
	});

	it('does not implement the block members until they exist', () => {
		const provider = createRichSearchProvider({ viewRegistered: () => false });
		expect(provider.blockLanguages).toBeUndefined();
		expect(provider.extractBlock).toBeUndefined();
		expect(provider.revealBlock).toBeUndefined();
	});
});
