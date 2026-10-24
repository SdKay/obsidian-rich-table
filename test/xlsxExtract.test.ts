/**
 * xlsxExtract.ts: the text of an .xlsx for Rich Search. Fixtures are built in memory with the
 * library's own writer, the same way xlsxSource.test.ts does.
 */
import { describe, it, expect } from 'vitest';
import { createWorkbook, addWorksheet, setSheetState } from '@office-kit/xlsx/workbook';
import { setCell, mergeCells } from '@office-kit/xlsx/worksheet';
import { saveWorkbook, toArrayBuffer } from '@office-kit/xlsx/io';
import { extractXlsx, XLSX_EXTRACT_VERSION, XLSX_EXTENSIONS, DEFAULT_LIMITS, type XlsxExtractLimits } from '../src/xlsxExtract';

type Fill = (wb: ReturnType<typeof createWorkbook>) => void;

async function bytesOf(fill: Fill): Promise<ArrayBuffer> {
	const wb = createWorkbook();
	fill(wb);
	const sink = toArrayBuffer();
	await saveWorkbook(wb, sink);
	return sink.result();
}

const lines = async (fill: Fill, limits?: Partial<XlsxExtractLimits>) => {
	const result = await extractXlsx(await bytesOf(fill), limits);
	if (!result.ok) throw new Error('expected ok, got: ' + result.error);
	return result.value;
};

describe('extractXlsx: what is returned', () => {
	it('returns a known string with a Sheet!A1 location and a 1-based sheet-coordinate anchor', async () => {
		const found = await lines(wb => {
			const ws = addWorksheet(wb, 'Sheet1');
			setCell(ws, 4, 2, 'needle');
		});
		expect(found).toEqual([{ text: 'needle', location: 'Sheet1!B4', anchor: { sheet: 'Sheet1', row: 4, col: 2 } }]);
	});

	it('names the sheet a string is on, and skips a hidden sheet entirely', async () => {
		const found = await lines(wb => {
			setCell(addWorksheet(wb, 'First'), 1, 1, 'on first');
			setCell(addWorksheet(wb, 'Second'), 2, 3, 'on second');
			setCell(addWorksheet(wb, 'Secret'), 1, 1, 'hidden text');
			setSheetState(wb, 'Secret', 'hidden');
		});
		expect(found.map(l => l.text)).toEqual(['on first', 'on second']);
		expect(found.find(l => l.text === 'on second')?.anchor).toEqual({ sheet: 'Second', row: 2, col: 3 });
		expect(found.some(l => l.text === 'hidden text')).toBe(false);
	});

	it('also skips a very-hidden sheet', async () => {
		const found = await lines(wb => {
			setCell(addWorksheet(wb, 'Shown'), 1, 1, 'shown');
			setCell(addWorksheet(wb, 'Deep'), 1, 1, 'deep');
			setSheetState(wb, 'Deep', 'veryHidden');
		});
		expect(found.map(l => l.text)).toEqual(['shown']);
	});

	it('quotes a sheet name that has a space, as Excel does', async () => {
		const found = await lines(wb => setCell(addWorksheet(wb, 'Quarter 1'), 2, 1, 'q'));
		expect(found[0]?.location).toBe("'Quarter 1'!A2");
		expect(found[0]?.anchor).toEqual({ sheet: 'Quarter 1', row: 2, col: 1 });
	});

	it('gives a merged range one line, for its top-left cell', async () => {
		const found = await lines(wb => {
			const ws = addWorksheet(wb, 'M');
			setCell(ws, 2, 3, 'merged');
			mergeCells(ws, 'C2:D3');
		});
		expect(found.filter(l => l.text === 'merged')).toHaveLength(1);
		expect(found[0]?.location).toBe('M!C2');
	});

	it('skips empty cells', async () => {
		const found = await lines(wb => {
			const ws = addWorksheet(wb, 'E');
			setCell(ws, 1, 1, '');
			setCell(ws, 1, 2, 'x');
		});
		expect(found.map(l => l.text)).toEqual(['x']);
	});

	it('returns lines in a stable reading order: sheet by sheet, row by row, left to right', async () => {
		const found = await lines(wb => {
			const ws = addWorksheet(wb, 'O');
			setCell(ws, 2, 1, 'r2c1');
			setCell(ws, 1, 3, 'r1c3');
			setCell(ws, 1, 1, 'r1c1');
		});
		expect(found.map(l => l.text)).toEqual(['r1c1', 'r1c3', 'r2c1']);
	});
});

describe('extractXlsx: the text of a cell is the raw value the table shows today', () => {
	// KNOWN LIMIT, shared with rendering: loadWorkbook returns a date cell as its serial number (46316 is
	// 2026-10-21), even with a date number format, so cellValueToString's Date branch is not reached for
	// files read from disk. Search and rendering show the same text, but a date is not findable as a date.
	// Fixing it means reading the cell's number format inside cellValueToString, for both at once.
	it('uses cellValueToString: numbers as String(n), a date as its serial number, booleans, formulas as the cached value, rich text flattened', async () => {
		const found = await lines(wb => {
			const ws = addWorksheet(wb, 'V');
			setCell(ws, 1, 1, 42);
			setCell(ws, 1, 2, 0.1 + 0.2);
			setCell(ws, 1, 3, true);
			setCell(ws, 1, 4, 46316);
			setCell(ws, 1, 5, { kind: 'formula', formula: 'SUM(A1:A1)', t: 'normal', cachedValue: 42 });
			setCell(ws, 1, 6, { kind: 'rich-text', runs: [{ text: 'ri' }, { text: 'ch' }] });
		});
		expect(found.map(l => l.text)).toEqual(['42', '0.30000000000000004', 'TRUE', '46316', '42', 'rich']);
	});
});

describe('extractXlsx: input that is not a usable workbook never throws', () => {
	const failure = async (bytes: ArrayBuffer | Uint8Array) => {
		const result = await extractXlsx(bytes);
		expect(result.ok).toBe(false);
		return result.ok ? '' : result.error;
	};

	it('empty input', async () => {
		expect(await failure(new ArrayBuffer(0))).toMatch(/not a valid|corrupt|empty|truncated/i);
	});

	it('garbage input', async () => {
		expect(await failure(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]))).toMatch(/not a valid|corrupt|truncated/i);
	});

	it('a truncated workbook', async () => {
		const whole = new Uint8Array(await bytesOf(wb => setCell(addWorksheet(wb, 'T'), 1, 1, 'x'.repeat(2000))));
		expect(await failure(whole.slice(0, Math.floor(whole.length / 2)))).toMatch(/not a valid|corrupt|truncated/i);
	});

	it('a password-protected workbook says it is encrypted', async () => {
		// An encrypted .xlsx is an OLE2 container, not a zip: it starts with the CFB signature.
		const cfb = new Uint8Array(512);
		cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
		// 'password' appears only in our own explanation; the library's raw message says 'Encrypted ... msoffcrypto-tool'.
		expect(await failure(cfb)).toMatch(/password/i);
	});
});

describe('extractXlsx: size limits', () => {
	const grid = (rows: number, cols: number): Fill => wb => {
		const ws = addWorksheet(wb, 'Big');
		for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) setCell(ws, r, c, `v${r}-${c}`);
	};

	it('a workbook over the cell limit returns an error that names the limit', async () => {
		const result = await extractXlsx(await bytesOf(grid(20, 10)), { maxCells: 100 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/100/);
	});

	it('a workbook at the limit is read', async () => {
		const result = await extractXlsx(await bytesOf(grid(10, 10)), { maxCells: 100 });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toHaveLength(100);
	});

	// Numeric cells: the streaming count can stop early. A sheet of many distinct strings must first parse
	// its whole shared-string table, so refusing it is slower (measured ~450 ms for 100 000 strings).
	// Compared against loading the same bytes rather than against a fixed time, so machine load does not matter.
	it('refuses a huge numeric sheet much faster than loading it', async () => {
		const bytes = await bytesOf(wb => {
			const ws = addWorksheet(wb, 'Nums');
			for (let r = 1; r <= 1000; r++) for (let c = 1; c <= 100; c++) setCell(ws, r, c, r * c);
		});
		const timeOf = async (limit: number) => {
			const start = performance.now();
			const result = await extractXlsx(bytes, { maxCells: limit });
			return { ms: performance.now() - start, ok: result.ok };
		};
		await timeOf(1_000_000); // warm up the library's lazy parts so neither run pays for them
		const loaded = await timeOf(1_000_000);
		const refused = await timeOf(1000);
		expect(loaded.ok).toBe(true);
		expect(refused.ok).toBe(false);
		expect(refused.ms).toBeLessThan(loaded.ms / 2);
	});

	it('a sparse sheet whose declared range is big but whose real cell count is small is still read', async () => {
		const result = await extractXlsx(await bytesOf(wb => {
			const ws = addWorksheet(wb, 'Sparse');
			setCell(ws, 1, 1, 'a');
			setCell(ws, 5000, 50, 'z'); // declared range A1:AX5000 = 250 000 cells, real count 2
		}), { maxCells: 1000 });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.map(l => l.text)).toEqual(['a', 'z']);
	});

	it('has defaults that are documented numbers, not unbounded', () => {
		expect(DEFAULT_LIMITS.maxCells).toBeGreaterThan(0);
		expect(Number.isFinite(DEFAULT_LIMITS.maxCells)).toBe(true);
	});
});

describe('extractXlsx: provider contract', () => {
	it('is deterministic: two calls on the same bytes are deeply equal', async () => {
		const bytes = await bytesOf(wb => {
			const ws = addWorksheet(wb, 'D');
			setCell(ws, 1, 1, 'a');
			setCell(ws, 2, 2, 'b');
		});
		expect(await extractXlsx(bytes)).toEqual(await extractXlsx(bytes));
	});

	it('declares lower-case extensions without a dot, and a numeric extractVersion', () => {
		expect(XLSX_EXTENSIONS).toEqual(['xlsx']);
		expect(typeof XLSX_EXTRACT_VERSION).toBe('number');
	});

	it('returns plain JSON-serialisable lines', async () => {
		const found = await lines(wb => setCell(addWorksheet(wb, 'J'), 1, 1, 'x'));
		expect(JSON.parse(JSON.stringify(found))).toEqual(found);
	});
});
