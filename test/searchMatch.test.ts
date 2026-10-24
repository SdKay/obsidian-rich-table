import { describe, it, expect } from 'vitest';
import { matchText } from '../src/searchMatch';
import type { RichSearchHostApi } from '../src/richSearchApi';

const host = (matchLine: RichSearchHostApi['matchLine']): RichSearchHostApi => ({ apiVersion: 1, matchLine });

describe('matchText', () => {
	it('returns what the host says, untouched', () => {
		const out = matchText('abc', { query: 'zzz' }, host(() => [{ start: 1, end: 2 }]));
		expect(out).toEqual([{ start: 1, end: 2 }]);
	});

	it('hands the text and the options to the host unchanged', () => {
		const seen: unknown[] = [];
		matchText('some text', { query: 'x', wholeWord: true, regex: true }, host((t, o) => { seen.push(t, o); return []; }));
		expect(seen).toEqual(['some text', { query: 'x', wholeWord: true, regex: true }]);
	});

	it('a host that throws means no match, not an error', () => {
		expect(matchText('abc', { query: 'a' }, host(() => { throw new Error('boom'); }))).toEqual([]);
	});
});
