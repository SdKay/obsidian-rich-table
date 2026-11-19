import { describe, it, expect } from 'vitest';
import { findAsciiTableAtCursor, parseAsciiTable } from '../src/asciiTable';

const lines = (s: string) => s.split('\n');

describe('parseAsciiTable', () => {
	it('reads a +---+ table with a header rule', () => {
		const t = parseAsciiTable(lines(`+------+-----+
| name | age |
+------+-----+
| ann  |  30 |
| bob  |  25 |
+------+-----+`));
		expect(t).toEqual({ values: [['name', 'age'], ['ann', '30'], ['bob', '25']], hasHeader: true });
	});

	it('reads a Unicode box table the same way', () => {
		const t = parseAsciiTable(lines(`┌──────┬─────┐
│ name │ age │
├──────┼─────┤
│ ann  │  30 │
└──────┴─────┘`));
		expect(t).toEqual({ values: [['name', 'age'], ['ann', '30']], hasHeader: true });
	});

	it('reads heavy and double Unicode rules', () => {
		expect(parseAsciiTable(lines(`╔═══╦═══╗
║ a ║ b ║
╠═══╬═══╣
║ 1 ║ 2 ║
╚═══╩═══╝`))).toEqual({ values: [['a', 'b'], ['1', '2']], hasHeader: true });
		expect(parseAsciiTable(lines(`┏━━━┳━━━┓
┃ a ┃ b ┃
┣━━━╋━━━┫
┃ 1 ┃ 2 ┃
┗━━━┻━━━┛`))).toEqual({ values: [['a', 'b'], ['1', '2']], hasHeader: true });
	});

	it('treats the = rule of a reStructuredText grid as the header rule', () => {
		const t = parseAsciiTable(lines(`+------+---------+
| name | contact |
+======+=========+
| ann  | a@x.com |
+------+---------+`));
		expect(t).toEqual({ values: [['name', 'contact'], ['ann', 'a@x.com']], hasHeader: true });
	});

	it('finds the header in an rST grid whose body rows are each ruled', () => {
		const t = parseAsciiTable(lines(`+-----+----+
| ann | 30 |
+=====+====+
| bob | 25 |
+-----+----+
| cy  | 41 |
+-----+----+`));
		expect(t).toEqual({ values: [['ann', '30'], ['bob', '25'], ['cy', '41']], hasHeader: true });
	});

	it('has no header when the only rules are the top and the bottom', () => {
		const t = parseAsciiTable(lines(`+-----+----+
| ann | 30 |
| bob | 25 |
+-----+----+`));
		expect(t).toEqual({ values: [['ann', '30'], ['bob', '25']], hasHeader: false });
	});

	it('takes the first row as the header when every row is separated by a rule', () => {
		const t = parseAsciiTable(lines(`┌──────┬──────┐
│ 水果 │ 颜色 │
├──────┼──────┤
│      │ 深红 │
│ 苹果 │ 偏黄 │
│ 品种 │      │
├──────┼──────┤
│ plum │ 紫色 │
├──────┼──────┤
│ kiwi │ 绿色 │
└──────┴──────┘`));
		expect(t).toEqual({
			values: [['水果', '颜色'], ['苹果\n品种', '深红\n偏黄'], ['plum', '紫色'], ['kiwi', '绿色']],
			hasHeader: true,
		});
	});

	it('joins the lines of a cell that spans several lines with a newline', () => {
		const t = parseAsciiTable(lines(`+------+----------+
| name | note     |
+------+----------+
| ann  | first    |
|      | second   |
+------+----------+`));
		expect(t?.values).toEqual([['name', 'note'], ['ann', 'first\nsecond']]);
	});

	it('cuts the columns where the rule has its corners, so a | inside a cell stays in the cell', () => {
		const t = parseAsciiTable(lines(`+------+-------+
| cmd  | out   |
+------+-------+
| a|b  | x | y |
+------+-------+`));
		expect(t?.values).toEqual([['cmd', 'out'], ['a|b', 'x | y']]);
	});

	it('aligns wide characters by the columns they take, not by their count', () => {
		const t = parseAsciiTable(lines(`+------+------+
| 姓名 | 年龄 |
+------+------+
| 小明 |   18 |
+------+------+`));
		expect(t?.values).toEqual([['姓名', '年龄'], ['小明', '18']]);
	});

	it('keeps an empty cell empty', () => {
		const t = parseAsciiTable(lines(`+---+---+
| a | b |
+---+---+
|   | 2 |
+---+---+`));
		expect(t?.values).toEqual([['a', 'b'], ['', '2']]);
	});

	it('is not a table when it does not start and end with a rule', () => {
		expect(parseAsciiTable(lines(`| a | b |
+---+---+
| 1 | 2 |`))).toBeNull();
		expect(parseAsciiTable(lines(`+---+---+
| a | b |
+---+---+
| 1 | 2 |`))).toBeNull();
	});

	it('is not a table when a body row does not match the rule\'s columns', () => {
		expect(parseAsciiTable(lines(`+---+---+
| a | b | c |
+---+---+`))).toBeNull();
	});

	it('is not a table when a line between the rules is neither a row nor a rule', () => {
		expect(parseAsciiTable(lines(`+---+---+
| a | b |
just text
+---+---+`))).toBeNull();
	});

	it('does not mistake a Markdown pipe table for an ASCII one', () => {
		expect(parseAsciiTable(lines(`| a | b |
| --- | --- |
| 1 | 2 |`))).toBeNull();
	});

	it('rejects a single rule and an empty input', () => {
		expect(parseAsciiTable(lines('+---+---+'))).toBeNull();
		expect(parseAsciiTable([])).toBeNull();
	});
});

describe('findAsciiTableAtCursor', () => {
	const note = `# title

text before

+------+-----+
| name | age |
+------+-----+
| ann  |  30 |
+------+-----+

text after`;
	const ls = lines(note);

	it('finds the table from any line of it', () => {
		for (const row of [4, 5, 6, 7, 8]) {
			const found = findAsciiTableAtCursor(ls, row);
			expect(found, `line ${row}`).toMatchObject({ startLine: 4, endLine: 8, hasHeader: true });
			expect(found?.values).toEqual([['name', 'age'], ['ann', '30']]);
		}
	});

	it('finds nothing off the table', () => {
		expect(findAsciiTableAtCursor(ls, 0)).toBeNull();
		expect(findAsciiTableAtCursor(ls, 2)).toBeNull();
		expect(findAsciiTableAtCursor(ls, 10)).toBeNull();
	});

	it('does not take a table inside a code fence', () => {
		const fenced = lines('```\n+---+---+\n| a | b |\n+---+---+\n```');
		expect(findAsciiTableAtCursor(fenced, 2)).toBeNull();
	});

	it('takes only the table the cursor is on when two follow each other', () => {
		const two = lines(`+---+
| a |
+---+

+---+
| b |
+---+`);
		expect(findAsciiTableAtCursor(two, 5)).toMatchObject({ startLine: 4, endLine: 6 });
		expect(findAsciiTableAtCursor(two, 1)).toMatchObject({ startLine: 0, endLine: 2 });
	});
});
