/**
 * Writes a pixel density into a PNG (a `pHYs` chunk), so a viewer or Word shows it at its size on screen and not at one
 * pixel per CSS px: the image is drawn at a pixel ratio above 1 to stay sharp.
 */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PIXELS_PER_METRE_AT_96_DPI = 3780;

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/** The PNG with `pixelRatio` pixels per CSS px recorded; unchanged when it is not a PNG or already has a density. */
export function withPixelDensity(png: Uint8Array, pixelRatio: number): Uint8Array {
	if (SIGNATURE.some((b, i) => png[i] !== b)) return png;
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	let at = 8;
	let insertAt = -1;
	while (at + 12 <= png.length) {
		const length = view.getUint32(at);
		const type = String.fromCharCode(png[at + 4] ?? 0, png[at + 5] ?? 0, png[at + 6] ?? 0, png[at + 7] ?? 0);
		if (type === 'pHYs') return png;
		if (type === 'IDAT') { insertAt = at; break; }
		at += 12 + length;
	}
	if (insertAt < 0) return png;

	const perMetre = Math.round(PIXELS_PER_METRE_AT_96_DPI * pixelRatio);
	const chunk = new Uint8Array(21);
	const cv = new DataView(chunk.buffer);
	cv.setUint32(0, 9);
	chunk.set([0x70, 0x48, 0x59, 0x73], 4);
	cv.setUint32(8, perMetre);
	cv.setUint32(12, perMetre);
	chunk[16] = 1;
	cv.setUint32(17, crc32(chunk.subarray(4, 17)));

	const out = new Uint8Array(png.length + chunk.length);
	out.set(png.subarray(0, insertAt), 0);
	out.set(chunk, insertAt);
	out.set(png.subarray(insertAt), insertAt + chunk.length);
	return out;
}
