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
