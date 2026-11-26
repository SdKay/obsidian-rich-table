// Cuts styles.css down to what a static export of a table uses, and lists the page variables that CSS reads.
// Pure functions, so a test can run them on a string.

/** The top-level rules of a stylesheet that has no at-rules: [{ selector, body }]. Comments are dropped. */
export function splitRules(css) {
	const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const rules = [];
	let depth = 0, start = 0, head = '', bodyStart = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === '{') {
			if (depth === 0) { head = text.slice(start, i).trim(); bodyStart = i + 1; }
			depth++;
		} else if (text[i] === '}') {
			depth--;
			if (depth === 0) { rules.push({ selector: head, body: text.slice(bodyStart, i).trim() }); start = i + 1; }
		}
	}
	return rules;
}

const classesOf = selector => [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(m => m[1]);

/** Keeps each comma-separated selector whose classes are all in `used`, and the rules with at least one left. */
export function keepRules(rules, used) {
	const keep = new Set(used);
	const out = [];
	for (const { selector, body } of rules) {
		const kept = splitSelectors(selector).filter(s => classesOf(s).every(c => keep.has(c)) && classesOf(s).length > 0);
		if (kept.length > 0) out.push({ selector: kept.join(',\n'), body });
	}
	return out;
}

/** Splits a selector list at the commas that are not inside parentheses or brackets. */
function splitSelectors(selector) {
	const parts = [];
	let depth = 0, from = 0;
	for (let i = 0; i < selector.length; i++) {
		const ch = selector[i];
		if (ch === '(' || ch === '[') depth++;
		else if (ch === ')' || ch === ']') depth--;
		else if (ch === ',' && depth === 0) { parts.push(selector.slice(from, i).trim()); from = i + 1; }
	}
	parts.push(selector.slice(from).trim());
	return parts.filter(Boolean);
}

export function renderRules(rules) {
	return rules.map(r => `${r.selector} {\n\t${r.body.replace(/\n\s*/g, '\n\t')}\n}`).join('\n');
}

/**
 * The custom properties the rules read with `var(--x, fallback)` that the page has to give, with the first fallback seen
 * for each (null when it has none). Not those in the plugin's own `--bt-` namespace, which the plugin always sets or
 * falls back on itself, nor any that the rules or `written` (the properties set from code) provide.
 */
export function pageVariables(rules, written) {
	const given = new Set(written);
	const text = rules.map(r => r.body).join('\n');
	for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) given.add(m[1]);
	const found = {};
	for (const { name, fallback } of varUses(text)) {
		if (given.has(name) || name.startsWith('--bt-')) continue;
		if (!(name in found) || (found[name] === null && fallback !== null)) found[name] = fallback;
	}
	return Object.fromEntries(Object.entries(found).sort(([a], [b]) => a.localeCompare(b)));
}

/** Every `var(--name, fallback)` in `text`, including those inside another one's fallback, in order of appearance. */
function varUses(text) {
	const uses = [];
	for (let at = text.indexOf('var('); at !== -1; at = text.indexOf('var(', at + 4)) {
		let depth = 1, end = at + 4;
		while (end < text.length && depth > 0) { if (text[end] === '(') depth++; else if (text[end] === ')') depth--; end++; }
		const inner = text.slice(at + 4, end - 1);
		const comma = inner.indexOf(',');
		const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
		if (/^--[\w-]+$/.test(name)) uses.push({ name, fallback: comma === -1 ? null : inner.slice(comma + 1).trim() });
	}
	return uses;
}
