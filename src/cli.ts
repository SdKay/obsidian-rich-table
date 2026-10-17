import { readFileSync, writeFileSync } from 'node:fs';
import { parse as parseDoc, stringify as stringifyDoc } from 'yaml';
import { setYamlAdapter, editBlock, findBlocks, parse, type RichTableOp } from './core';

// The standalone tool bundles its own YAML: JSON-compatible core schema, so a date such as
// 2026-07-17 stays text instead of becoming a timestamp.
setYamlAdapter({
	parse: (s): unknown => parseDoc(s, { schema: 'core' }),
	stringify: (v) => stringifyDoc(v, { lineWidth: 0 }),
});

const USAGE = `rich-table <command> <note.md> [options]

  list   <note.md>                       List the rich-table blocks in a note
  show   <note.md> [--block N]           Print block N (default 0) as JSON
  apply  <note.md> --op '<json>' [--block N] [--dry-run]
                                         Apply one operation, or a JSON array of them

Operations are the same JSON the plugin uses internally, e.g.
  {"type":"insert-row","afterRowId":null}
  {"type":"fill-cells","cells":[{"rowId":"r_a","colId":"c_a"}],"values":["1"]}
Row and column ids come from "show".`;

function arg(args: string[], name: string): string | undefined {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
}

function main(argv: string[]): number {
	const [command, file, ...rest] = argv;
	if (!command || !file || command === '--help' || command === '-h') { console.log(USAGE); return command ? 0 : 1; }
	const markdown = readFileSync(file, 'utf8');
	const index = Number(arg(rest, '--block') ?? 0);

	if (command === 'list') {
		findBlocks(markdown).forEach((b, i) => console.log(`${i}\tlines ${b.start + 1}-${b.end + 1}`));
		return 0;
	}
	if (command === 'show') {
		const block = findBlocks(markdown)[index];
		if (!block) { console.error(`No rich-table block #${index}`); return 1; }
		console.log(JSON.stringify(parse(block.source), null, 2));
		return 0;
	}
	if (command === 'apply') {
		const raw = arg(rest, '--op');
		if (!raw) { console.error('apply needs --op'); return 1; }
		const next = editBlock(markdown, JSON.parse(raw) as RichTableOp | RichTableOp[], index);
		if (rest.includes('--dry-run')) { console.log(next); return 0; }
		writeFileSync(file, next);
		return 0;
	}
	console.error(`Unknown command "${command}"\n\n${USAGE}`);
	return 1;
}

try { process.exitCode = main(process.argv.slice(2)); }
catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; }
