import { describe, it, expect } from 'vitest';
import { editWidth } from '../src/editWidth';

describe('editWidth', () => {
	it('a fixed column keeps its width and wraps once the text no longer fits', () => {
		expect(editWidth({ needed: 80, current: 120, fixed: true, room: 500 })).toEqual({ width: 120, wrap: false });
		expect(editWidth({ needed: 300, current: 120, fixed: true, room: 500 })).toEqual({ width: 120, wrap: true });
	});

	it('an auto column widens to its text while there is room', () => {
		expect(editWidth({ needed: 200, current: 60, fixed: false, room: 500 })).toEqual({ width: 200, wrap: false });
	});

	it('an auto column never shrinks while the text is edited', () => {
		expect(editWidth({ needed: 40, current: 150, fixed: false, room: 500 })).toEqual({ width: 150, wrap: false });
	});

	it('an auto column stops at the view and wraps past it', () => {
		expect(editWidth({ needed: 900, current: 60, fixed: false, room: 400 })).toEqual({ width: 400, wrap: true });
	});

	it('text that exactly fills the room still fits on one line', () => {
		expect(editWidth({ needed: 400, current: 60, fixed: false, room: 400 })).toEqual({ width: 400, wrap: false });
	});

	it('a column wider than the view is brought back to it, wrapping what does not fit', () => {
		expect(editWidth({ needed: 700, current: 600, fixed: false, room: 400 })).toEqual({ width: 400, wrap: true });
	});

	it('a column wider than the view stops at the view even when its text would fit in less', () => {
		expect(editWidth({ needed: 250, current: 600, fixed: false, room: 400 })).toEqual({ width: 400, wrap: false });
	});
});
