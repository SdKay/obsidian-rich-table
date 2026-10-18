import { describe, it, expect, vi, afterEach } from 'vitest';
import { decidePaste, escapeForHtml, payloadOf, markPlainPaste, takePlainPaste } from '../src/editorPaste';

const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |';
const rich = { canSpread: true };

describe('decidePaste', () => {
	it('plain pastes a table as it is, whatever the clipboard carries', () => {
		const html = '<table><tr><td>a</td></tr></table>';
		expect(decidePaste({ text: TABLE, html: '' }, { canSpread: true, plain: true })).toEqual({ kind: 'text', text: TABLE });
		expect(decidePaste({ text: TABLE, html }, { canSpread: true, plain: true })).toEqual({ kind: 'text', text: TABLE });
	});

	it('a Markdown pipe table spreads over cells', () => {
		expect(decidePaste({ text: TABLE, html: '' }, rich)).toEqual({ kind: 'grid', values: [['a', 'b'], ['1', '2']], merges: undefined });
	});

	// An HTML <table> winning over its text/plain needs a DOM, so it is covered by the browser tests
	// (unified-paste.spec.ts: "an Excel-style HTML table spreads over cells").

	it('ordinary prose, even multi-line, stays text', () => {
		expect(decidePaste({ text: 'one\ntwo\nthree', html: '' }, rich)).toEqual({ kind: 'text', text: 'one\ntwo\nthree' });
	});

	it('a cell that cannot take a grid keeps the table as text', () => {
		expect(decidePaste({ text: TABLE, html: '' }, { canSpread: false })).toEqual({ kind: 'text', text: TABLE });
	});

	it('text always comes from text/plain, never from the HTML of an image link', () => {
		expect(decidePaste({ text: '![[a.png]]', html: '<img alt="a.png">' }, rich)).toEqual({ kind: 'text', text: '![[a.png]]' });
	});

	it('an empty clipboard decides nothing', () => {
		expect(decidePaste({ text: '', html: '' }, rich)).toBeNull();
		expect(decidePaste({ text: '', html: '<p>x</p>' }, rich)).toBeNull();
	});
});

describe('payloadOf', () => {
	it('reads both flavours, tolerating no clipboard data at all', () => {
		const dt = { getData: (t: string) => (t === 'text/plain' ? 'T' : t === 'text/html' ? 'H' : '') } as unknown as DataTransfer;
		expect(payloadOf(dt)).toEqual({ text: 'T', html: 'H' });
		expect(payloadOf(null)).toEqual({ text: '', html: '' });
	});
});

// insertHTML parses what it is given: unescaped, a pasted "<b>" would become a real element.
describe('escapeForHtml', () => {
	it('neutralises every character HTML treats as markup', () => {
		expect(escapeForHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(escapeForHtml('a & b')).toBe('a &amp; b');
		expect(escapeForHtml('&lt;')).toBe('&amp;lt;');
	});
	it('leaves line breaks, pipes and wikilinks alone', () => {
		expect(escapeForHtml('![[a.png]]\n| a |')).toBe('![[a.png]]\n| a |');
	});
});

describe('plain paste request', () => {
	afterEach(() => { vi.useRealTimers(); takePlainPaste(); });

	it('applies to the next paste only', () => {
		markPlainPaste();
		expect(takePlainPaste()).toBe(true);
		expect(takePlainPaste()).toBe(false);
	});
	it('is not asked for until marked', () => {
		expect(takePlainPaste()).toBe(false);
	});
	it('expires, so a later Ctrl+V is not taken for it', () => {
		vi.useFakeTimers();
		markPlainPaste();
		vi.advanceTimersByTime(5000);
		expect(takePlainPaste()).toBe(false);
	});
});
