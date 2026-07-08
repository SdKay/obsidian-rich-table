/** "A" → 0, "B" → 1, "Z" → 25, "AA" → 26 */
export function colLetterToIndex(letters: string): number {
	let result = 0;
	for (const ch of letters.toUpperCase()) {
		result = result * 26 + (ch.charCodeAt(0) - 64);
	}
	return result - 1;
}

/** 0 → "A", 1 → "B", 25 → "Z", 26 → "AA" */
export function colIndexToLetter(idx: number): string {
	let result = '';
	let n = idx + 1;
	while (n > 0) {
		result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
		n = Math.floor((n - 1) / 26);
	}
	return result;
}

/** "A1" → { row: 0, col: 0 }  (0-indexed, row 1 = header) */
export function parseCellCoord(str: string): { row: number; col: number } | null {
	const m = /^([A-Z]+)(\d+)$/.exec(str.trim().toUpperCase());
	if (!m) return null;
	const letter = m[1], numStr = m[2];
	if (!letter || !numStr) return null;
	return { col: colLetterToIndex(letter), row: parseInt(numStr) - 1 };
}

/** { row: 0, col: 0 } → "A1" */
export function coordToString(row: number, col: number): string {
	return colIndexToLetter(col) + (row + 1);
}

/**
 * True if a v1-style coordinate target string applies to cell (row, col).
 * Supports: "B*", "*3", "2:4", "A:C", "A1:C3", "B2".
 * Row/col are 0-indexed; row 0 = header row.
 */
export function matchTarget(row: number, col: number, target: string): boolean {
	const colWild = /^([A-Z]+)\*$/.exec(target);
	if (colWild) {
		const letter = colWild[1];
		if (letter !== undefined) return colLetterToIndex(letter) === col;
	}

	const rowWild = /^\*(\d+)$/.exec(target);
	if (rowWild) {
		const n = rowWild[1];
		if (n !== undefined) return parseInt(n) - 1 === row;
	}

	const rowRange = /^(\d+):(\d+)$/.exec(target);
	if (rowRange) {
		const n1 = rowRange[1], n2 = rowRange[2];
		if (n1 !== undefined && n2 !== undefined)
			return row >= parseInt(n1) - 1 && row <= parseInt(n2) - 1;
	}

	const colRange = /^([A-Z]+):([A-Z]+)$/.exec(target);
	if (colRange) {
		const l1 = colRange[1], l2 = colRange[2];
		if (l1 !== undefined && l2 !== undefined) {
			const c1 = colLetterToIndex(l1), c2 = colLetterToIndex(l2);
			return col >= Math.min(c1, c2) && col <= Math.max(c1, c2);
		}
	}

	const cellRange = /^([A-Z]+\d+):([A-Z]+\d+)$/.exec(target);
	if (cellRange) {
		const s = parseCellCoord(cellRange[1] ?? '');
		const e = parseCellCoord(cellRange[2] ?? '');
		if (s && e)
			return row >= s.row && row <= e.row && col >= s.col && col <= e.col;
	}

	const single = /^([A-Z]+)(\d+)$/.exec(target);
	if (single) {
		const letter = single[1], numStr = single[2];
		if (letter !== undefined && numStr !== undefined)
			return colLetterToIndex(letter) === col && parseInt(numStr) - 1 === row;
	}

	return false;
}
