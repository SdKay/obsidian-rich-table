import { loadWorkbook, fromArrayBuffer } from '@office-kit/xlsx/io';
import { openZip } from '@office-kit/xlsx/zip';
import { loadWorkbookStream } from '@office-kit/xlsx/streaming';
import {
	OpenXmlDecompressionBombError, OpenXmlIoError, OpenXmlNotImplementedError,
	columnLetterFromIndex, formatSheetQualifiedRef,
} from '@office-kit/xlsx/utils';
import { cellValueToString } from './xlsxSource';
import type { ExtractedLine, ExtractResult } from './richSearchApi';

/**
 * The text of an .xlsx for Rich Search: one line per non-empty cell of every visible sheet.
 * Bytes in, lines out. No Obsidian, no I/O, no cache (the caller caches by path + mtime + version).
 */

/** The anchor this provider hands to rich-search and gets back on open. 1-based sheet coordinates (row 1 is the header row), the same numbers as the model ids (`r_2`, `c_1`). rich-search never reads it. */
export interface XlsxAnchor {
	sheet: string;
	row: number;
	col: number;
}

export const XLSX_EXTENSIONS = ['xlsx'];

/**
 * Bump whenever `extractXlsx` would return different output for the same bytes. Rich Search keys its
 * cache on it. Changing `cellValueToString` changes this output, so it counts.
 */
export const XLSX_EXTRACT_VERSION = 1;

export interface XlsxExtractLimits {
	/** Most non-empty cells a workbook may hold across its visible sheets. */
	maxCells: number;
}

/**
 * Measured, not guessed (Node 26, one sheet of numbers and short strings):
 *
 *   cells        file     load     heap
 *   10 000       0.05 MB  82 ms    +24 MB
 *   100 000      0.5 MB   0.5 s    +178 MB
 *   500 000      2.5 MB   2.6 s    +805 MB
 *   1 000 000    5.1 MB   201 s    +998 MB     <- not linear: the app would hang for minutes
 *
 * A 5 MB file can need a gigabyte, so the limit is a cell count, never a byte count. 200 000 cells is
 * about a second and a few hundred MB on a desktop, well short of the cliff. Obsidian's renderer and
 * a phone are slower and tighter than this machine; revisit with real vaults.
 */
export const DEFAULT_LIMITS: XlsxExtractLimits = { maxCells: 200_000 };

const fail = (error: string): ExtractResult => ({ ok: false, error });

/** What a library failure means to the person who owns the file. */
function describeFailure(err: unknown): string {
	if (err instanceof OpenXmlNotImplementedError && /encrypt/i.test(err.message)) {
		return 'The workbook is password-protected (encrypted); remove the password to search it';
	}
	if (err instanceof OpenXmlDecompressionBombError) return 'The workbook expands to an unreasonable size and was not read';
	if (err instanceof OpenXmlIoError) return 'The file is not a valid .xlsx workbook (it is empty, corrupt or truncated)';
	return `The workbook could not be read: ${err instanceof Error ? err.message : 'unknown error'}`;
}

/** `A1:J100` -> 1000. Null when the reference is not a plain rectangle. */
function cellsInRange(ref: string): number | null {
	const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref.trim());
	if (!m) return null;
	const col = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
	const [, c1, r1, c2 = c1, r2 = r1] = m;
	const width = col(c2!) - col(c1!) + 1;
	const height = Number(r2) - Number(r1) + 1;
	return width > 0 && height > 0 ? width * height : null;
}

/**
 * The cell count the sheets DECLARE (`<dimension ref>`), read from the first few KB of each sheet
 * entry without inflating the rest. Cheap: 11 ms on a 4.7 MB, million-cell workbook that takes
 * 201 s to load. Null when it cannot be told (a writer that omits the tag); the caller then falls
 * back to counting. A declared range overstates a sparse sheet and can be wrong in a hostile file,
 * so it only decides whether a real count is needed, never whether to refuse.
 */
async function declaredCells(bytes: ArrayBuffer | Uint8Array): Promise<number | null> {
	const zip = await openZip(fromArrayBuffer(bytes));
	try {
		let total = 0;
		for (const path of zip.list().filter(p => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))) {
			const reader = zip.readStream(path).getReader();
			let head = '';
			try {
				for (let read = 0; read < 8192 && !/<dimension\b[^>]*>/.test(head);) {
					const { value, done } = await reader.read();
					if (done) break;
					head += new TextDecoder().decode(value);
					read += value.length;
				}
			} finally {
				await reader.cancel();
			}
			const ref = /<dimension\s+ref="([^"]+)"/.exec(head)?.[1];
			const n = ref ? cellsInRange(ref) : null;
			if (n === null) return null;
			total += n;
		}
		return total;
	} finally {
		zip.close();
	}
}

/**
 * The real number of non-empty cells, counted by streaming so memory stays small, stopping as soon
 * as `limit` is passed. Counts hidden sheets too (an upper bound on what a full load holds).
 */
async function countCells(bytes: ArrayBuffer | Uint8Array, limit: number): Promise<number> {
	const workbook = await loadWorkbookStream(fromArrayBuffer(bytes));
	try {
		let n = 0;
		for (const name of workbook.sheetNames) {
			for await (const row of workbook.openWorksheet(name).iterRows()) {
				n += row.length;
				if (n > limit) return n;
			}
		}
		return n;
	} finally {
		await workbook.close();
	}
}

/** Reads the text of a workbook. Never throws. */
export async function extractXlsx(bytes: ArrayBuffer | Uint8Array, limits: Partial<XlsxExtractLimits> = {}): Promise<ExtractResult> {
	const maxCells = limits.maxCells ?? DEFAULT_LIMITS.maxCells;
	try {
		const declared = await declaredCells(bytes);
		if (declared === null || declared > maxCells) {
			// The count stops once it passes the limit, so it only says "over", never the true size.
			if (await countCells(bytes, maxCells) > maxCells) {
				const limit = maxCells.toLocaleString('en-US');
				return fail(`The workbook is too large to search (more than ${limit} cells; the limit is ${limit})`);
			}
		}

		const workbook = await loadWorkbook(fromArrayBuffer(bytes));
		const lines: ExtractedLine[] = [];
		for (const entry of workbook.sheets) {
			if (entry.kind !== 'worksheet' || entry.state !== 'visible') continue;
			const sheet = entry.sheet;
			const rows = [...sheet.rows.keys()].sort((a, b) => a - b);
			for (const r of rows) {
				const row = sheet.rows.get(r);
				if (!row) continue;
				for (const c of [...row.keys()].sort((a, b) => a - b)) {
					const cell = row.get(c);
					if (!cell) continue;
					const text = cellValueToString(cell.value);
					if (text === '') continue;
					lines.push({ text, location: formatSheetQualifiedRef(sheet.title, `${columnLetterFromIndex(c)}${r}`), anchor: { sheet: sheet.title, row: r, col: c } });
				}
			}
		}
		return { ok: true, value: lines };
	} catch (err) {
		return fail(describeFailure(err));
	}
}
