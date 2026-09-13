/**
 * Whole-table zoom (model.ts's `TableModelV2.zoom`) — the pure-logic pieces:
 * the `set-zoom` reducer (operations.ts), YAML normalization (parser.ts), and
 * the percent→factor conversion (renderZoom.ts). The actual `zoom` CSS
 * property application and the status-bar widget are covered end to end in
 * test/e2e/issues/zoom/.
 */
import { describe, it, expect } from 'vitest';
import { applyStructuralOpV2, ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT } from '../src/operations';
import { parseTable } from '../src/parser';
import { serializeTable } from '../src/serializer';
import { zoomFactor } from '../src/renderZoom';
import type { TableModelV2 } from '../src/model';

function baseModel(): TableModelV2 {
	return {
		version: 2,
		columns: [{ id: 'c_a', name: 'A' }],
		rows: [{ id: 'r_0', cells: { c_a: '1' } }],
		merges: [],
		styles: [],
	};
}

describe('set-zoom', () => {
	it('sets a percent within range', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-zoom', percent: 150 });
		expect(model.zoom).toBe(150);
	});

	it('rounds a fractional percent', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-zoom', percent: 150.6 });
		expect(model.zoom).toBe(151);
	});

	it('clamps below ZOOM_MIN up to the floor', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-zoom', percent: 5 });
		expect(model.zoom).toBe(ZOOM_MIN);
	});

	it('clamps above ZOOM_MAX down to the ceiling', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-zoom', percent: 9999 });
		expect(model.zoom).toBe(ZOOM_MAX);
	});

	it('null resets to the default (field absent, not literally 100)', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-zoom', percent: 150 });
		applyStructuralOpV2(model, { type: 'set-zoom', percent: null });
		expect(model.zoom).toBeUndefined();
	});

	it('setting exactly the default percent (100) also clears the field, not writes it literally', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-zoom', percent: 150 });
		applyStructuralOpV2(model, { type: 'set-zoom', percent: ZOOM_DEFAULT });
		expect(model.zoom).toBeUndefined();
	});
});

describe('zoom YAML round-trip (parser.ts / serializer.ts)', () => {
	it('an old table with no zoom field parses with zoom absent — unchanged rendering, per model.ts\'s own backward-compat rule', () => {
		const model = parseTable('---\nversion: 2\ncolumns:\n  - { id: c_a, name: A }\nrows: []\n---\n');
		expect(model.zoom).toBeUndefined();
	});

	it('round-trips a set zoom value through serialize → parse', () => {
		const model = baseModel();
		model.zoom = 150;
		const serialized = serializeTable(model);
		expect(serialized).toContain('zoom: 150');
		const reparsed = parseTable(serialized);
		expect(reparsed.zoom).toBe(150);
	});

	it('a model at the default zoom (absent) never writes a zoom field at all', () => {
		const model = baseModel();
		expect(serializeTable(model)).not.toContain('zoom:');
	});

	it('a hand-edited YAML value outside [ZOOM_MIN, ZOOM_MAX] is clamped on parse, the same as the set-zoom reducer would', () => {
		const model = parseTable('---\nversion: 2\ncolumns:\n  - { id: c_a, name: A }\nrows: []\nzoom: 9999\n---\n');
		expect(model.zoom).toBe(ZOOM_MAX);
	});

	it('a hand-edited YAML value of exactly 100 parses as absent, matching the reducer\'s own null-equivalent treatment', () => {
		const model = parseTable('---\nversion: 2\ncolumns:\n  - { id: c_a, name: A }\nrows: []\nzoom: 100\n---\n');
		expect(model.zoom).toBeUndefined();
	});
});

describe('zoomFactor', () => {
	it('converts a percent to a factor', () => {
		expect(zoomFactor(150)).toBe(1.5);
		expect(zoomFactor(50)).toBe(0.5);
	});

	it('defaults to 1 (100%) when absent', () => {
		expect(zoomFactor(undefined)).toBe(1);
	});
});
