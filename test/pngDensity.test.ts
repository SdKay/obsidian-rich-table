import { describe, it, expect } from 'vitest';
import { withPixelDensity } from '../src/pngDensity';

function chunk(type: string, data: number[]): number[] {
	const body = [...type].map(c => c.charCodeAt(0)).concat(data);
	let c = 0xffffffff;
	for (const b of body) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
	const crc = (c ^ 0xffffffff) >>> 0;
	const be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
	return [...be(data.length), ...body, ...be(crc)];
}
const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const png = (...chunks: number[][]) => new Uint8Array([...SIG, ...chunks.flat()]);
const IHDR = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const IDAT = chunk('IDAT', [1, 2, 3]);
const IEND = chunk('IEND', []);

function chunksOf(bytes: Uint8Array): { type: string; data: number[] }[] {
	const v = new DataView(bytes.buffer, bytes.byteOffset);
	const out = []; let at = 8;
	while (at < bytes.length) {
		const n = v.getUint32(at);
		out.push({ type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)), data: [...bytes.subarray(at + 8, at + 8 + n)] });
		at += 12 + n;
	}
	return out;
}

describe('withPixelDensity', () => {
	it('puts a pHYs chunk before the first IDAT and keeps every other chunk', () => {
		const out = withPixelDensity(png(IHDR, IDAT, IDAT, IEND), 2);
		expect(chunksOf(out).map(c => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IDAT', 'IEND']);
	});
	it('records 192 dpi (7560 pixels per metre) for a pixel ratio of 2, in metres', () => {
		const phys = chunksOf(withPixelDensity(png(IHDR, IDAT, IEND), 2)).find(c => c.type === 'pHYs')!.data;
		const v = new DataView(new Uint8Array(phys).buffer);
		expect(v.getUint32(0)).toBe(7560);
		expect(v.getUint32(4)).toBe(7560);
		expect(phys[8]).toBe(1);
	});
	it('scales with the pixel ratio (zoom 1.56 at ratio 2 is 3.12)', () => {
		const phys = chunksOf(withPixelDensity(png(IHDR, IDAT, IEND), 3.12)).find(c => c.type === 'pHYs')!.data;
		expect(new DataView(new Uint8Array(phys).buffer).getUint32(0)).toBe(Math.round(3780 * 3.12));
	});
	it('writes a chunk whose CRC is the one a PNG reader checks', () => {
		const out = withPixelDensity(png(IHDR, IDAT, IEND), 2);
		const expected = chunk('pHYs', [0, 0, 0x1d, 0x88, 0, 0, 0x1d, 0x88, 1]);
		const at = 8 + IHDR.length;
		expect([...out.subarray(at, at + 21)]).toEqual(expected);
	});
	it('leaves a PNG that has a density, or something that is not a PNG, as it is', () => {
		const has = png(IHDR, chunk('pHYs', [0, 0, 0, 1, 0, 0, 0, 1, 1]), IDAT, IEND);
		expect(withPixelDensity(has, 2)).toBe(has);
		const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		expect(withPixelDensity(junk, 2)).toBe(junk);
	});
});
