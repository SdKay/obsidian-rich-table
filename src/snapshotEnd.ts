/**
 * Where a rendered snapshot ends. The image is laid out a second time inside an SVG, where borders and line heights
 * snap to pixels differently from the page, so its height cannot be predicted from the page. The clone carries a solid
 * marker as its last element; the picture is drawn with room to spare and cut where the marker begins.
 */

const MARKER = [255, 0, 255] as const;
const TOLERANCE = 8;
const TINT = 24;

/** First row of the marker in one column of RGBA pixels, or null when the marker is not in it. */
export function contentEndRow(column: ArrayLike<number>): number | null {
	const rows = Math.floor(column.length / 4);
	const px = (y: number): [number, number, number, number] => [column[y * 4] ?? 0, column[y * 4 + 1] ?? 0, column[y * 4 + 2] ?? 0, column[y * 4 + 3] ?? 0];
	const isMarker = (y: number) => {
		const [r, g, b, a] = px(y);
		return a >= 250 && Math.abs(r - MARKER[0]) <= TOLERANCE && Math.abs(g - MARKER[1]) <= TOLERANCE && Math.abs(b - MARKER[2]) <= TOLERANCE;
	};
	let y = rows - 1;
	while (y >= 0 && !isMarker(y)) y--;
	if (y < 0) return null;
	while (y > 0 && isMarker(y - 1)) y--;
	// A row the marker only partly covers is the marker's, not the table's.
	if (y > 0) {
		const [r, g, b, a] = px(y - 1);
		if (a > 0 && r - g >= TINT && b - g >= TINT) y--;
	}
	return y;
}
