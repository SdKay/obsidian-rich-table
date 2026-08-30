/**
 * Builds a small real .xlsx file (via @office-kit/xlsx's own writer, same
 * legitimate-fixture reasoning as test/xlsxSource.test.ts's buildSampleBytes)
 * for e2e tests exercising tableBlock.ts's xlsx-backed-table feature. Runs in
 * Node (this is a Playwright test-support file, not part of the bundled
 * browser source) — the result is a plain byte array, matching
 * renderBlock's `binaryFiles` option (see test-base.ts for why not
 * ArrayBuffer/Uint8Array directly).
 */
import { createWorkbook, addWorksheet } from '@office-kit/xlsx/workbook';
import { setCell } from '@office-kit/xlsx/worksheet';
import { saveWorkbook, toArrayBuffer } from '@office-kit/xlsx/io';

export interface XlsxFixtureSpec {
	/** One sheet per entry; each entry is a grid of cell strings, row-major, 1 header row + N data rows. */
	sheets: { name: string; grid: string[][] }[];
}

export async function buildXlsxFixtureBytes(spec: XlsxFixtureSpec): Promise<number[]> {
	const wb = createWorkbook();
	for (const sheet of spec.sheets) {
		const ws = addWorksheet(wb, sheet.name);
		sheet.grid.forEach((row, r) => {
			row.forEach((value, c) => {
				if (value !== '') setCell(ws, r + 1, c + 1, value);
			});
		});
	}
	const sink = toArrayBuffer();
	await saveWorkbook(wb, sink);
	return Array.from(new Uint8Array(sink.result()));
}
