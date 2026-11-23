import { test, expect } from '../../common/test-base';
import type { Page } from '@playwright/test';

// A block's YAML may stand without the `---` lines; a block this build does not read is shown and never written.
const note = (page: Page) => page.evaluate(() => {
	const w = window as unknown as { __btVault: { files: Map<string, string> }; __btNote: string };
	return w.__btVault.files.get(w.__btNote) ?? '';
});

const BODY = 'version: 2\ncolumns:\n  - { id: c_a, name: Alpha }\nrows:\n  - { id: r_a, cells: { c_a: "one" } }\n';

for (const [name, source] of [['both lines', `---\n${BODY}---\n`], ['only the opening line', `---\n${BODY}`], ['neither line', BODY]] as const) {
	test(`renders a table whose block has ${name}`, async ({ page, renderBlock }) => {
		await renderBlock(source);
		await expect(page.locator('td.bt-td', { hasText: 'one' })).toBeVisible();
		await expect(page.locator('.bt-version-banner')).toHaveCount(0);
	});
}

test('renders a table whose version comes after a cell holding an indented ---', async ({ page, renderBlock }) => {
	await renderBlock('---\ncolumns:\n  - { id: c_a, name: Alpha }\nrows:\n  - id: r_a\n    cells:\n      c_a: |\n        above\n        ---\n        below\nversion: 2\n---\n');
	await expect(page.locator('td.bt-td', { hasText: 'below' })).toBeVisible();
	await expect(page.locator('.bt-version-banner')).toHaveCount(0);
});

test('shows a pre-1.0 block as its source with a notice, and leaves the note alone', async ({ page, renderBlock }) => {
	const source = '---\ncolumns:\n  - { name: Task }\n---\n| Task |\n| ---- |\n| Design |\n';
	await renderBlock(source);
	const before = await note(page);
	await expect(page.locator('.bt-version-banner')).toBeVisible();
	await expect(page.locator('.bt-unread-source')).toContainText('| Design |');
	await expect(page.locator('td.bt-td, .bt-template-btn')).toHaveCount(0);
	expect(await note(page)).toBe(before);
});

test('shows a block with broken YAML as its source, with the parse error', async ({ page, renderBlock }) => {
	await renderBlock('---\nversion: 2\ncolumns: [oops\n---\n');
	await expect(page.locator('.bt-version-banner-detail')).not.toBeEmpty();
	await expect(page.locator('.bt-unread-source')).toContainText('columns: [oops');
});

test('refuses a block written by a newer build, wherever its version line is', async ({ page, renderBlock }) => {
	await renderBlock('columns:\n  - { id: c_a, name: Alpha }\nrows: []\nversion: 99\n');
	await expect(page.locator('.bt-version-banner-btn')).toBeVisible();
	await expect(page.locator('td.bt-td')).toHaveCount(0);
});

// A block under a list item: the fence and every line inside carry the list's indent.
const LIST_BLOCK = `---\n${BODY}---\n`;

for (const [name, indent] of [['two spaces', '  '], ['three spaces', '   '], ['four spaces', '    ']] as const) {
	test(`renders one table for a block indented ${name}, and edits it in place`, async ({ page, renderBlock }) => {
		await renderBlock(LIST_BLOCK, { fenceIndent: indent });
		await expect(page.locator('td.bt-td', { hasText: 'one' })).toBeVisible();
		await expect(page.locator('.bt-version-banner')).toHaveCount(0);
		await expect(page.locator('.bt-table')).toHaveCount(1);

		await page.evaluate(() => {
			const w = window as unknown as { __btBlock: { handleStructuralOp: (op: unknown) => Promise<void> } };
			return w.__btBlock.handleStructuralOp({ type: 'set-cell-content', rowId: 'r_a', colId: 'c_a', value: 'changed' });
		});
		await expect.poll(() => note(page)).toContain('changed');

		const lines = (await note(page)).split('\n');
		const open = lines.findIndex(l => l.trimStart().startsWith('```rich-table'));
		const close = lines.findIndex((l, i) => i > open && l.trimStart().startsWith('```'));
		expect(lines[open]).toBe(`${indent}\`\`\`rich-table`);
		expect(lines[close]).toBe(`${indent}\`\`\``);
		for (const l of lines.slice(open + 1, close)) expect(l.startsWith(indent), `"${l}" keeps the fence's indent`).toBe(true);
		expect(lines.slice(open + 1, close).filter(l => /^ *version:/.test(l))).toEqual([`${indent}version: 2`]);
	});
}

test('reads a block whose lines are indented more than its fence, as a write by an older build left it', async ({ page, renderBlock }) => {
	await renderBlock(LIST_BLOCK.split('\n').map(l => (l === '' ? l : '    ' + l)).join('\n'), { fenceIndent: '  ' });
	await expect(page.locator('td.bt-td', { hasText: 'one' })).toBeVisible();
	await expect(page.locator('.bt-version-banner')).toHaveCount(0);
});
