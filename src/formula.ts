import type { RowDefV2, TableModelV2 } from './model';

export type FormulaFunc = 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT';
const FUNC_NAMES: ReadonlySet<string> = new Set(['SUM', 'AVG', 'MIN', 'MAX', 'COUNT']);

export type FormulaErrorCode = '#REF!' | '#CIRCULAR!' | '#DIV/0!' | '#VALUE!';

export type AstNode =
	| { kind: 'num'; value: number }
	| { kind: 'ref'; rowId: string; colId: string }
	| { kind: 'neg'; operand: AstNode }
	| { kind: 'binop'; op: '+' | '-' | '*' | '/'; left: AstNode; right: AstNode }
	| { kind: 'call'; name: FormulaFunc; startRowId: string; startColId: string; endRowId: string; endColId: string };

type Token =
	| { kind: 'num'; value: number }
	| { kind: 'ref'; rowId: string; colId: string }
	| { kind: 'range'; startRowId: string; startColId: string; endRowId: string; endColId: string }
	| { kind: 'func'; name: FormulaFunc }
	| { kind: 'op'; value: '+' | '-' | '*' | '/' }
	| { kind: 'lparen' }
	| { kind: 'rparen' };

const REF_RANGE_RE = /^(r_[0-9a-z]+\.c_[0-9a-z]+)(?::(r_[0-9a-z]+\.c_[0-9a-z]+))?/;
const NUM_RE  = /^\d+(\.\d+)?/;
const FUNC_RE = /^([A-Za-z]+)(?=\()/;

function tokenize(source: string): Token[] | null {
	let s = source.trim();
	if (s.startsWith('=')) s = s.slice(1);
	const tokens: Token[] = [];
	let i = 0;
	while (i < s.length) {
		const rest = s.slice(i);
		const ws = /^\s+/.exec(rest);
		if (ws) { i += ws[0].length; continue; }

		const funcMatch = FUNC_RE.exec(rest);
		if (funcMatch && funcMatch[1] && FUNC_NAMES.has(funcMatch[1].toUpperCase())) {
			tokens.push({ kind: 'func', name: funcMatch[1].toUpperCase() as FormulaFunc });
			i += funcMatch[0].length;
			continue;
		}

		const refMatch = REF_RANGE_RE.exec(rest);
		if (refMatch && refMatch[1]) {
			const [rowId, colId] = refMatch[1].split('.', 2) as [string, string];
			if (refMatch[2]) {
				const [endRowId, endColId] = refMatch[2].split('.', 2) as [string, string];
				tokens.push({ kind: 'range', startRowId: rowId, startColId: colId, endRowId, endColId });
			} else {
				tokens.push({ kind: 'ref', rowId, colId });
			}
			i += refMatch[0].length;
			continue;
		}

		const numMatch = NUM_RE.exec(rest);
		if (numMatch) {
			tokens.push({ kind: 'num', value: Number(numMatch[0]) });
			i += numMatch[0].length;
			continue;
		}

		const ch = rest[0];
		if (ch === '+' || ch === '-' || ch === '*' || ch === '/') { tokens.push({ kind: 'op', value: ch }); i++; continue; }
		if (ch === '(') { tokens.push({ kind: 'lparen' }); i++; continue; }
		if (ch === ')') { tokens.push({ kind: 'rparen' }); i++; continue; }
		return null; // unrecognized character
	}
	return tokens;
}

/**
 * Parses a formula source string (leading '=' optional — stripped if
 * present) into an AST, or null on syntax error. Grammar:
 *   expr   := term (('+'|'-') term)*
 *   term   := factor (('*'|'/') factor)*
 *   factor := '-' factor | num | ref | FUNC '(' range ')' | '(' expr ')'
 * A bare range (no enclosing function call) is a syntax error — ranges only
 * make sense as a function's argument.
 */
export function parseFormula(source: string): AstNode | null {
	const tokens = tokenize(source);
	if (!tokens || tokens.length === 0) return null;
	let pos = 0;
	const peek = (): Token | undefined => tokens[pos];
	const next = (): Token | undefined => tokens[pos++];

	function parseExpr(): AstNode | null {
		let left = parseTerm();
		if (!left) return null;
		for (;;) {
			const t = peek();
			if (t?.kind === 'op' && (t.value === '+' || t.value === '-')) {
				next();
				const right = parseTerm();
				if (!right) return null;
				left = { kind: 'binop', op: t.value, left, right };
			} else break;
		}
		return left;
	}

	function parseTerm(): AstNode | null {
		let left = parseFactor();
		if (!left) return null;
		for (;;) {
			const t = peek();
			if (t?.kind === 'op' && (t.value === '*' || t.value === '/')) {
				next();
				const right = parseFactor();
				if (!right) return null;
				left = { kind: 'binop', op: t.value, left, right };
			} else break;
		}
		return left;
	}

	function parseFactor(): AstNode | null {
		const t = peek();
		if (!t) return null;
		if (t.kind === 'op' && t.value === '-') {
			next();
			const operand = parseFactor();
			return operand ? { kind: 'neg', operand } : null;
		}
		if (t.kind === 'num') { next(); return { kind: 'num', value: t.value }; }
		if (t.kind === 'ref') { next(); return { kind: 'ref', rowId: t.rowId, colId: t.colId }; }
		if (t.kind === 'func') {
			next();
			if (peek()?.kind !== 'lparen') return null;
			next();
			const rangeTok = peek();
			if (rangeTok?.kind !== 'range') return null;
			next();
			if (peek()?.kind !== 'rparen') return null;
			next();
			return {
				kind: 'call', name: t.name,
				startRowId: rangeTok.startRowId, startColId: rangeTok.startColId,
				endRowId: rangeTok.endRowId, endColId: rangeTok.endColId,
			};
		}
		if (t.kind === 'lparen') {
			next();
			const inner = parseExpr();
			if (!inner) return null;
			if (peek()?.kind !== 'rparen') return null;
			next();
			return inner;
		}
		return null;
	}

	const ast = parseExpr();
	if (!ast || pos !== tokens.length) return null; // leftover tokens = syntax error
	return ast;
}

// ── Evaluation ──────────────────────────────────────────────────────────────

type CellOutcome =
	| { kind: 'error'; code: FormulaErrorCode }
	| { kind: 'empty' }
	| { kind: 'text' }
	| { kind: 'number'; value: number };

type NumericOutcome =
	| { kind: 'number'; value: number }
	| { kind: 'error'; code: FormulaErrorCode };

/** Blank cell = 0 in arithmetic (matches Excel); non-numeric text is a real
 *  #VALUE! error there — unlike a range function's own skip-non-numeric
 *  convention below, a bare `=A1+1` can't silently drop A1 from the sum. */
function toNumeric(outcome: CellOutcome): NumericOutcome {
	switch (outcome.kind) {
		case 'number': return outcome;
		case 'empty':  return { kind: 'number', value: 0 };
		case 'text':   return { kind: 'error', code: '#VALUE!' };
		case 'error':  return outcome;
	}
}

function resolveCellOutcome(
	model: TableModelV2, rowId: string, colId: string,
	visiting: Set<string>, memo: Map<string, CellOutcome>,
): CellOutcome {
	const key = `${rowId}.${colId}`;
	const cached = memo.get(key);
	if (cached) return cached;

	const row: RowDefV2 | undefined = model.rows.find(r => r.id === rowId);
	const colExists = model.columns.some(c => c.id === colId);
	if (!row || !colExists) {
		const outcome: CellOutcome = { kind: 'error', code: '#REF!' };
		memo.set(key, outcome);
		return outcome;
	}

	const formulaSrc = row.formulas?.[colId];
	if (formulaSrc) {
		if (visiting.has(key)) return { kind: 'error', code: '#CIRCULAR!' };
		visiting.add(key);
		const ast = parseFormula(formulaSrc);
		const result: NumericOutcome = ast
			? evaluateAst(model, ast, visiting, memo)
			: { kind: 'error', code: '#VALUE!' };
		visiting.delete(key);
		memo.set(key, result);
		return result;
	}

	const raw = (row.cells[colId] ?? '').trim();
	if (raw === '') {
		const outcome: CellOutcome = { kind: 'empty' };
		memo.set(key, outcome);
		return outcome;
	}
	const n = Number(raw);
	const outcome: CellOutcome = Number.isNaN(n) ? { kind: 'text' } : { kind: 'number', value: n };
	memo.set(key, outcome);
	return outcome;
}

function rangeIds<T extends { id: string }>(list: T[], startId: string, endId: string): string[] | null {
	const i1 = list.findIndex(x => x.id === startId);
	const i2 = list.findIndex(x => x.id === endId);
	if (i1 < 0 || i2 < 0) return null;
	const lo = Math.min(i1, i2), hi = Math.max(i1, i2);
	const ids: string[] = [];
	for (let i = lo; i <= hi; i++) { const x = list[i]; if (x) ids.push(x.id); }
	return ids;
}

function evaluateAst(
	model: TableModelV2, ast: AstNode, visiting: Set<string>, memo: Map<string, CellOutcome>,
): NumericOutcome {
	switch (ast.kind) {
		case 'num':
			return { kind: 'number', value: ast.value };
		case 'neg': {
			const v = evaluateAst(model, ast.operand, visiting, memo);
			return v.kind === 'error' ? v : { kind: 'number', value: -v.value };
		}
		case 'ref':
			return toNumeric(resolveCellOutcome(model, ast.rowId, ast.colId, visiting, memo));
		case 'binop': {
			const l = evaluateAst(model, ast.left, visiting, memo);
			if (l.kind === 'error') return l;
			const r = evaluateAst(model, ast.right, visiting, memo);
			if (r.kind === 'error') return r;
			switch (ast.op) {
				case '+': return { kind: 'number', value: l.value + r.value };
				case '-': return { kind: 'number', value: l.value - r.value };
				case '*': return { kind: 'number', value: l.value * r.value };
				case '/': return r.value === 0
					? { kind: 'error', code: '#DIV/0!' }
					: { kind: 'number', value: l.value / r.value };
			}
			break;
		}
		case 'call': {
			const rowIds = rangeIds(model.rows, ast.startRowId, ast.endRowId);
			const colIds = rangeIds(model.columns, ast.startColId, ast.endColId);
			if (!rowIds || !colIds) return { kind: 'error', code: '#REF!' };
			const values: number[] = [];
			let nonEmptyCount = 0;
			for (const rId of rowIds) {
				for (const cId of colIds) {
					const outcome = resolveCellOutcome(model, rId, cId, visiting, memo);
					if (outcome.kind === 'error') return outcome; // propagate, don't silently drop
					if (outcome.kind === 'number') { values.push(outcome.value); nonEmptyCount++; }
					else if (outcome.kind === 'text') { nonEmptyCount++; }
					// 'empty' contributes to neither values nor nonEmptyCount
				}
			}
			switch (ast.name) {
				case 'SUM':   return { kind: 'number', value: values.reduce((a, b) => a + b, 0) };
				case 'AVG':   return values.length === 0
					? { kind: 'error', code: '#VALUE!' }
					: { kind: 'number', value: values.reduce((a, b) => a + b, 0) / values.length };
				case 'MIN':   return values.length === 0 ? { kind: 'error', code: '#VALUE!' } : { kind: 'number', value: Math.min(...values) };
				case 'MAX':   return values.length === 0 ? { kind: 'error', code: '#VALUE!' } : { kind: 'number', value: Math.max(...values) };
				case 'COUNT': return { kind: 'number', value: nonEmptyCount };
			}
		}
	}
}

/** Round to at most 2 decimal places, stripping trailing zeros — same
 *  convention as renderAggregate.ts's formatAggNumber. */
function formatNumber(n: number): string {
	return String(Math.round(n * 100) / 100);
}

/** Evaluates one formula cell's current value: a formatted number string, or
 *  one of the four error codes. Returns '' if the cell has no formula. Each
 *  call starts a fresh visiting-set/memo pair — see recomputeFormulas for the
 *  table-wide entry point that actually gets called from the app. */
export function evaluateFormula(model: TableModelV2, rowId: string, colId: string): string {
	const row = model.rows.find(r => r.id === rowId);
	const formulaSrc = row?.formulas?.[colId];
	if (!formulaSrc) return '';
	const memo = new Map<string, CellOutcome>();
	const visiting = new Set<string>([`${rowId}.${colId}`]);
	const ast = parseFormula(formulaSrc);
	if (!ast) return '#VALUE!';
	const result = evaluateAst(model, ast, visiting, memo);
	return result.kind === 'error' ? result.code : formatNumber(result.value);
}

/**
 * Recomputes every formula cell in the model and writes the result into
 * `cells[colId]` — the single place the cache gets refreshed. Called from
 * two places: the end of `applyStructuralOpV2` (so every structural change
 * is reflected immediately, and what gets written to disk is always fresh)
 * and the end of `parseTable`/`parseWorkbook` (so a freshly loaded note is
 * never stale even if its YAML was hand-edited). No persistent dependency
 * graph — each cell's evaluation independently walks whatever it references,
 * with its own visiting-set for cycle detection (see resolveCellOutcome).
 */
export function recomputeFormulas(model: TableModelV2): void {
	for (const row of model.rows) {
		if (!row.formulas) continue;
		for (const colId of Object.keys(row.formulas)) {
			row.cells[colId] = evaluateFormula(model, row.id, colId);
		}
	}
}
