import { describe, it, expect } from 'vitest';
import { compileStyles } from '../src/styleIndex';
import { resolveStylesV2, resolveHeaderStylesV2 } from '../src/styleTarget';
import type { TableModelV2 } from '../src/model';

// A small deterministic generator, so a failing table can be rebuilt from its seed.
function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
}

function randomTable(seed: number): TableModelV2 {
	const r = rng(seed);
	const nRows = 1 + Math.floor(r() * 12);
	const nCols = 1 + Math.floor(r() * 6);
	// Ids are meant to be unique, but a hand-written block can repeat one, and a row can even be called "header".
	const columns = Array.from({ length: nCols }, (_, c) => ({ id: c > 0 && r() < 0.08 ? `c_${c - 1}` : `c_${c}`, name: `C${c}`, ...(r() < 0.3 ? { align: (['left', 'center', 'right'] as const)[Math.floor(r() * 3)]! } : {}) }));
	const rows = Array.from({ length: nRows }, (_, i) => ({ id: i > 0 && r() < 0.08 ? `r_${i - 1}` : r() < 0.02 ? 'header' : `r_${i}`, cells: {} }));
	const row = () => (r() < 0.06 ? 'r_missing' : r() < 0.06 ? 'header' : `r_${Math.floor(r() * nRows)}`);
	const col = () => (r() < 0.06 ? 'c_missing' : `c_${Math.floor(r() * nCols)}`);
	const targets = [
		() => 'header', () => `header.${col()}`, () => row(), () => col(), () => `${row()}.${col()}`,
		() => `${row()}:${row()}`, () => `${col()}:${col()}`, () => `${row()}.${col()}:${row()}.${col()}`,
		() => 'garbage', () => `${row()}.`, () => ':', () => 'r_1:c_1',
	];
	const styles = Array.from({ length: Math.floor(r() * 14) }, () => ({
		target: targets[Math.floor(r() * targets.length)]!(),
		...(r() < 0.6 ? { bg: `#${Math.floor(r() * 0xffffff).toString(16).padStart(6, '0')}` } : {}),
		...(r() < 0.3 ? { color: '#111111' } : {}), ...(r() < 0.3 ? { bold: true } : {}), ...(r() < 0.2 ? { italic: true } : {}),
		...(r() < 0.3 ? { size: 10 + Math.floor(r() * 10) } : {}),
		...(r() < 0.3 ? { align: (['left', 'center', 'right'] as const)[Math.floor(r() * 3)]! } : {}),
	}));
	return { version: 2, columns, rows, merges: [], styles } as unknown as TableModelV2;
}

describe('compileStyles', () => {
	it('answers for every cell and header cell of every table exactly as resolveStylesV2 and resolveHeaderStylesV2 do', () => {
		let cells = 0, styled = 0;
		for (let seed = 1; seed <= 3000; seed++) {
			const model = randomTable(seed);
			const style = compileStyles(model);
			for (let row = 0; row <= model.rows.length; row++) {
				for (let col = 0; col < model.columns.length; col++) {
					const c = model.columns[col]!;
					const want = row === 0 ? resolveHeaderStylesV2(model.styles, c.id, model) : resolveStylesV2(model.styles, model.rows[row - 1]!.id, c.id, model);
					cells++;
					if (Object.keys(want).length > 0) styled++;
					expect(style(row, col), `seed ${seed} cell ${row},${col}`).toEqual(want);
				}
			}
		}
		// The comparison must have met styles, or it proved nothing.
		expect(cells).toBeGreaterThan(25000);
		expect(styled).toBeGreaterThan(5000);
	});

	it('answers an empty style outside the table', () => {
		const style = compileStyles(randomTable(11));
		expect(style(999, 0)).toEqual({});
		expect(style(1, 999)).toEqual({});
		expect(style(-1, 0)).toEqual({});
	});

	it('with rules of the same priority, the one listed last wins, as before', () => {
		const model = { version: 2, columns: [{ id: 'c_0', name: 'A' }], rows: [{ id: 'r_0', cells: {} }],
			styles: [{ target: 'r_0', bg: '#111111' }, { target: 'c_0', bg: '#222222' }], merges: [] } as unknown as TableModelV2;
		expect(compileStyles(model)(1, 0).bg).toBe('#222222');
		expect(compileStyles(model)(1, 0)).toEqual(resolveStylesV2(model.styles, 'r_0', 'c_0', model));
	});
});
