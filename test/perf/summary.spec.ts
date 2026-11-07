import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { group, render, findings, type Result } from './report';
import { limitsFor } from './summarize';
import { chosen } from './tier';

// Runs after the scans (files run in name order) and prints what they found. The run fails if a line grows with the
// table or is over its budget, or if a scenario measured nothing.
const FILES = ['test-results/perf-rebuild.jsonl', 'test-results/perf-interactions.jsonl'];
const SIZES = chosen.sizes;

test('the scan found nothing growing with the table or over budget', () => {
	const results: Result[] = FILES.filter(f => fs.existsSync(f)).flatMap(f => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Result));
	const lines = group(results, limitsFor);
	const bad = findings(lines);
	const note = chosen.rounds < 3 ? `\nThis run took ${chosen.rounds} round of each: a flagged line may be a moment the machine was busy. Confirm it with \`npm run perf:standard\`.` : '';
	console.log('\n' + render(lines, SIZES) + `\n\n${bad.length} line(s) need attention` + (bad.length > 0 ? note : ''));
	expect(bad.map(l => `${l.scenario} / ${l.feature}`)).toEqual([]);
});
