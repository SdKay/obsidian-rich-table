/**
 * xlsxSource.ts unit tests. Fixtures are built via @office-kit/xlsx's own
 * writer, in memory — legitimate here specifically because these tests are
 * about "does OUR conversion code correctly transform whatever shape the
 * library hands us", not "does the library correctly parse real xlsx bytes
 * from other tools" (that question was answered separately, against an
 * independently-generated file, before this module was written at all — see
 * the feature's own design notes for why openpyxl-authored numeric XML
 * entities exposed a real decode gap in the library that mainstream Excel/
 * WPS/Sheets exports don't trigger, since they write raw UTF-8 instead).
 */
import { describe, it, expect } from 'vitest';
import { createWorkbook, addWorksheet, workbookToBytes } from '@office-kit/xlsx/workbook';
import { setCell, mergeCells, freezePanes } from '@office-kit/xlsx/worksheet';
import { setBold, setFontColor, setCellBackgroundColor } from '@office-kit/xlsx/styles';
import { saveWorkbook, toArrayBuffer } from '@office-kit/xlsx/io';
import { readXlsxAsModel, colWidthToPx } from '../src/xlsxSource';
import type { TableModelV2, WorkbookV3 } from '../src/model';

async function buildSampleBytes(sheetNames: string[]): Promise<ArrayBuffer> {
	const wb = createWorkbook();
	for (const name of sheetNames) {
		const ws = addWorksheet(wb, name);
		setCell(ws, 1, 1, '任务');
		setCell(ws, 1, 2, '状态');
		const a1 = setCell(ws, 1, 1, '任务'); // re-fetch the Cell for styling
		setBold(wb, a1, true);
		setFontColor(wb, a1, 'FFFFFF');
		setCellBackgroundColor(wb, a1, '4472C4');

		setCell(ws, 2, 1, '设计架构');
		const b2 = setCell(ws, 2, 2, '完成');
		setCellBackgroundColor(wb, b2, 'C6EFCE');

		setCell(ws, 3, 1, '编码实现');
		setCell(ws, 3, 2, '进行中');

		mergeCells(ws, 'C2:C3');
		setCell(ws, 2, 3, '合并备注');
		mergeCells(ws, 'D1:D2'); // spans the header row itself — see the dedicated test below
		setCell(ws, 1, 4, '备注');
		freezePanes(ws, 1, 1); // 1 frozen row + 1 frozen column
	}
	const sink = toArrayBuffer();
	await saveWorkbook(wb, sink);
	return sink.result();
}

function asSingle(model: TableModelV2 | WorkbookV3): TableModelV2 {
	expect('sheets' in model).toBe(false);
	return model as TableModelV2;
}

/** Minimal, dependency-free ZIP (STORE method, no compression) builder — just
 *  enough to construct a real .xlsx package byte-for-byte, so the numeric-
 *  entity regression test below drives the actual loadWorkbook parser rather
 *  than a hand-rolled decoder. Deliberately not `zlib.crc32` (Node 21.4+
 *  only; this project's CI matrix still runs Node 20.x). */
const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
		table[n] = c;
	}
	return table;
})();

function crc32(buf: Uint8Array): number {
	let c = 0xffffffff;
	for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function buildZip(files: Record<string, string>): ArrayBuffer {
	const encoder = new TextEncoder();
	const localParts: Uint8Array[] = [];
	const centralParts: Uint8Array[] = [];
	let offset = 0;
	for (const [name, content] of Object.entries(files)) {
		const nameBytes = encoder.encode(name);
		const data = encoder.encode(content);
		const crc = crc32(data);

		const local = new DataView(new ArrayBuffer(30 + nameBytes.length));
		local.setUint32(0, 0x04034b50, true);
		local.setUint16(4, 20, true); // version needed
		local.setUint16(6, 0, true); // flags
		local.setUint16(8, 0, true); // compression: store
		local.setUint16(10, 0, true); // mod time
		local.setUint16(12, 0, true); // mod date
		local.setUint32(14, crc, true);
		local.setUint32(18, data.length, true); // compressed size
		local.setUint32(22, data.length, true); // uncompressed size
		local.setUint16(26, nameBytes.length, true);
		local.setUint16(28, 0, true); // extra length
		const localBytes = new Uint8Array(local.buffer);
		localBytes.set(nameBytes, 30);
		localParts.push(localBytes, data);

		const central = new DataView(new ArrayBuffer(46 + nameBytes.length));
		central.setUint32(0, 0x02014b50, true);
		central.setUint16(4, 20, true);
		central.setUint16(6, 20, true);
		central.setUint16(8, 0, true);
		central.setUint16(10, 0, true);
		central.setUint16(12, 0, true);
		central.setUint16(14, 0, true);
		central.setUint32(16, crc, true);
		central.setUint32(20, data.length, true);
		central.setUint32(24, data.length, true);
		central.setUint16(28, nameBytes.length, true);
		central.setUint16(30, 0, true); // extra length
		central.setUint16(32, 0, true); // comment length
		central.setUint16(34, 0, true); // disk number
		central.setUint16(36, 0, true); // internal attrs
		central.setUint32(38, 0, true); // external attrs
		central.setUint32(42, offset, true); // local header offset
		const centralBytes = new Uint8Array(central.buffer);
		centralBytes.set(nameBytes, 46);
		centralParts.push(centralBytes);

		offset += localBytes.length + data.length;
	}

	const centralStart = offset;
	let centralSize = 0;
	for (const part of centralParts) centralSize += part.length;

	const end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054b50, true);
	end.setUint16(4, 0, true);
	end.setUint16(6, 0, true);
	end.setUint16(8, centralParts.length, true);
	end.setUint16(10, centralParts.length, true);
	end.setUint32(12, centralSize, true);
	end.setUint32(16, centralStart, true);
	end.setUint16(20, 0, true);

	const total = offset + centralSize + 22;
	const out = new Uint8Array(total);
	let pos = 0;
	for (const part of [...localParts, ...centralParts, new Uint8Array(end.buffer)]) {
		out.set(part, pos);
		pos += part.length;
	}
	return out.buffer;
}

/** A real, minimal .xlsx whose only cell (A1) is an inline-string containing
 *  the exact numeric character references from office-kit/xlsx#131's own
 *  report (`&#20219;&#21153;` = "任务") — reproduces the upstream bug through
 *  a real parse rather than asserting against a hand-rolled decoder. */
function buildNumericEntityFixture(): ArrayBuffer {
	return buildZip({
		'[Content_Types].xml':
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
			'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
			'<Default Extension="xml" ContentType="application/xml"/>' +
			'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
			'<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
			'</Types>',
		'_rels/.rels':
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
			'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
			'</Relationships>',
		'xl/workbook.xml':
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
			'<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>' +
			'</workbook>',
		'xl/_rels/workbook.xml.rels':
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
			'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
			'</Relationships>',
		'xl/worksheets/sheet1.xml':
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
			'<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&#20219;&#21153;</t></is></c></row></sheetData>' +
			'</worksheet>',
	});
}

describe('readXlsxAsModel — single sheet', () => {
	it('turns row 1 into column names and rows 2+ into data rows', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const model = asSingle(await readXlsxAsModel(bytes));
		expect(model.columns.map(c => c.name)).toEqual(['任务', '状态', '', '备注']);
		expect(model.rows).toHaveLength(2);
		const [taskCol, statusCol] = model.columns;
		expect(model.rows[0]!.cells[taskCol!.id]).toBe('设计架构');
		expect(model.rows[0]!.cells[statusCol!.id]).toBe('完成');
		expect(model.rows[1]!.cells[taskCol!.id]).toBe('编码实现');
	});

	it('resolves bold/color/background into a StyleRuleV2 targeting the header cell', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const model = asSingle(await readXlsxAsModel(bytes));
		const headerRule = model.styles.find(s => s.target === 'header.c_1');
		expect(headerRule).toMatchObject({ bold: true, color: '#ffffff', bg: '#4472c4' });
	});

	it('resolves a data cell background color', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const model = asSingle(await readXlsxAsModel(bytes));
		const rule = model.styles.find(s => s.target === 'r_2.c_2');
		expect(rule).toMatchObject({ bg: '#c6efce' });
	});

	it('does not emit a style rule for a cell with no distinguishing style', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const model = asSingle(await readXlsxAsModel(bytes));
		expect(model.styles.find(s => s.target === 'r_3.c_1')).toBeUndefined();
	});

	it('converts a data-only merge (C2:C3) into a plain row-ID-anchored MergeRangeV2', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const model = asSingle(await readXlsxAsModel(bytes));
		expect(model.merges).toContainEqual({ anchor: 'r_2.c_3', end: 'r_3.c_3' });
	});

	it('converts a merge that spans the header row itself (D1:D2) using the "header" sentinel, not r_1', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const model = asSingle(await readXlsxAsModel(bytes));
		expect(model.merges).toContainEqual({ anchor: 'header.c_4', end: 'r_2.c_4' });
		expect(model.merges.some(m => m.anchor.startsWith('r_1.'))).toBe(false);
	});

	it('maps a frozen 1 row + 1 col pane to freezeRows=0 (header only) and freezeCols=1', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const model = asSingle(await readXlsxAsModel(bytes));
		expect(model.freezeRows).toBe(0);
		expect(model.freezeCols).toBe(1);
	});

	it('round-trips through renderTable-shaped data without throwing on an empty sheet', async () => {
		const wb = createWorkbook();
		addWorksheet(wb, '空表');
		const sink = toArrayBuffer();
		await saveWorkbook(wb, sink);
		const model = asSingle(await readXlsxAsModel(sink.result()));
		expect(model.columns).toEqual([]);
		expect(model.rows).toEqual([]);
	});

	// A real xlsx commonly carries a "default width" ColumnDimension entry
	// spanning the whole 1..16384 column range (Excel/LibreOffice/WPS's own
	// "everything not explicitly overridden uses this width" record) ALONGSIDE
	// specific single-column overrides. Reported: a narrow-content column
	// rendered wide and a wide-content column rendered narrow — i.e. widths
	// swapped relative to what Excel itself shows.
	it('prefers a column-specific width over a wide default-width range that also covers it, regardless of Map insertion order', async () => {
		const wb = createWorkbook();
		const ws = addWorksheet(wb, 'Sheet1');
		setCell(ws, 1, 1, 'A-narrow'); setCell(ws, 1, 2, 'B-wide');
		setCell(ws, 1, 3, 'C-narrow'); setCell(ws, 1, 4, 'D-wide');
		// Default-width range registered FIRST — the real-world ordering that
		// exposed the bug: Array.prototype.find() (the old lookup) returns
		// whichever covering entry comes first in insertion order, not the
		// most specific one.
		ws.columnDimensions.set(1, { min: 1, max: 16384, width: 8.43 });
		ws.columnDimensions.set(2, { min: 2, max: 2, width: 45 });
		ws.columnDimensions.set(4, { min: 4, max: 4, width: 45 });

		const sink = toArrayBuffer();
		await saveWorkbook(wb, sink);
		const model = asSingle(await readXlsxAsModel(sink.result()));

		const narrowPx = colWidthToPx(8.43);
		const widePx = colWidthToPx(45);
		expect(model.columns[0]!.width).toBe(narrowPx); // A: only the default range covers it
		expect(model.columns[1]!.width).toBe(widePx);   // B: specific 45-wide override must win
		expect(model.columns[2]!.width).toBe(narrowPx); // C: only the default range covers it
		expect(model.columns[3]!.width).toBe(widePx);   // D: specific 45-wide override must win
	});

	// The same wide "default width" range (min:1, max:16384) also fed directly
	// into usedBounds' maxCol computation, so ANY sheet carrying one — extremely
	// common — rendered 16384 columns instead of however many actually have
	// content, which is both wrong and a real performance/rendering hazard.
	it('does not let a wide default-width range inflate the column count', async () => {
		const wb = createWorkbook();
		const ws = addWorksheet(wb, 'Sheet1');
		setCell(ws, 1, 1, 'A'); setCell(ws, 1, 2, 'B');
		ws.columnDimensions.set(1, { min: 1, max: 16384, width: 8.43 });

		const sink = toArrayBuffer();
		await saveWorkbook(wb, sink);
		const model = asSingle(await readXlsxAsModel(sink.result()));
		expect(model.columns).toHaveLength(2);
	});
});

describe('readXlsxAsModel — multi-sheet', () => {
	it('produces a WorkbookV3 with one SheetDefV2 per visible sheet when more than one exists', async () => {
		const bytes = await buildSampleBytes(['计划', '统计']);
		const model = await readXlsxAsModel(bytes);
		expect('sheets' in model).toBe(true);
		const wb = model as WorkbookV3;
		expect(wb.version).toBe(3);
		expect(wb.sheets.map(s => s.name)).toEqual(['计划', '统计']);
		expect(wb.activeSheetId).toBe(wb.sheets[0]!.id);
	});

	it('reads a single named sheet directly (bypassing the multi-sheet wrapper) via the sheet option', async () => {
		const bytes = await buildSampleBytes(['计划', '统计']);
		const model = asSingle(await readXlsxAsModel(bytes, '统计'));
		expect(model.columns.map(c => c.name)).toEqual(['任务', '状态', '', '备注']);
	});
});

// Regression for a real bug hit live in the app: an openpyxl-authored file
// showed literal "&#20219;&#21153;" text instead of "任务", because
// @office-kit/xlsx's XML parser didn't decode numeric character references
// (openpyxl writes non-ASCII inline-string content this way; Excel/WPS/
// Sheets write raw UTF-8 instead, which is why buildSampleBytes above never
// exercises this path). Fixed upstream in @office-kit/xlsx 0.11.1 (reported
// at https://github.com/office-kit/xlsx/issues/131) — this test drives a
// hand-built .xlsx whose inline-string cell uses the exact numeric-entity
// form from that report, through the real readXlsxAsModel/loadWorkbook
// path, so a regression in a future upstream version would be caught here
// rather than silently reintroducing the bug this project used to work
// around itself.
describe('numeric XML character references in inline-string cells (office-kit/xlsx#131)', () => {
	it('decodes &#NNNN; entities into real characters when read through readXlsxAsModel', async () => {
		const bytes = buildNumericEntityFixture();
		const model = asSingle(await readXlsxAsModel(bytes));
		expect(model.columns[0]!.name).toBe('任务');
	});
});
