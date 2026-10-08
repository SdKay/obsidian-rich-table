import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs build helper, no type declarations
import { buildEntries, renderGenerated } from '../changelog-gen.mjs';

type Entry = { version: string; date: string; changes: string[] };

/** A fake git: tags in order, each tag's commit titles and date, plus HEAD. */
function fakeGit(tags: string[], titles: Record<string, string[]>, dates: Record<string, string>, headTitles: string[], headDate = '2026-01-01') {
	return (args: string[]): string => {
		if (args[0] === 'tag') return tags.join('\n');
		if (args[0] === 'rev-parse') return 'ok';
		if (args[0] === 'log' && args[1] === '-1') return args[4] === 'HEAD' ? headDate : (dates[args[4]!] ?? '');
		if (args[0] === 'log') {
			const range = args[2]!;
			if (range.endsWith('..HEAD')) return headTitles.join('\n');
			const tag = range.split('..').pop()!;
			return (titles[tag] ?? []).join('\n');
		}
		throw new Error('unexpected git call: ' + args.join(' '));
	};
}

const tags = ['1.0.0', '1.1.0'];
const titles = { '1.0.0': ['feat: a', 'chore: release 1.0.0'], '1.1.0': ['fix: b', 'chore: release 1.1.0'] };
const dates = { '1.0.0': '2026-01-10', '1.1.0': '2026-02-10' };

describe('buildEntries', () => {
	it('lists released tags newest first, without each release commit', () => {
		const e: Entry[] = buildEntries({ read: fakeGit(tags, titles, dates, []) });
		expect(e.map(x => x.version)).toEqual(['1.1.0', '1.0.0']);
		expect(e[0]!.changes).toEqual(['fix: b']);
	});

	it('adds the pending version as the newest entry before its tag exists', () => {
		const e: Entry[] = buildEntries({ read: fakeGit(tags, titles, dates, ['fix: c', 'chore: release 1.2.0'], '2026-03-01'), pendingVersion: '1.2.0' });
		expect(e[0]).toMatchObject({ version: '1.2.0', date: '2026-03-01', changes: ['fix: c'] });
		expect(e.map(x => x.version)).toEqual(['1.2.0', '1.1.0', '1.0.0']);
	});

	it('uses the given release date for the pending version', () => {
		const e: Entry[] = buildEntries({ read: fakeGit(tags, titles, dates, ['fix: c'], '2026-03-01'), pendingVersion: '1.2.0', pendingDate: '2026-03-05' });
		expect(e[0]!.date).toBe('2026-03-05');
	});

	it('gives the same result once the pending version has been tagged', () => {
		const before: Entry[] = buildEntries({ read: fakeGit(tags, titles, dates, ['fix: c', 'chore: release 1.2.0'], '2026-03-01'), pendingVersion: '1.2.0' });
		const after: Entry[] = buildEntries({
			read: fakeGit([...tags, '1.2.0'], { ...titles, '1.2.0': ['fix: c', 'chore: release 1.2.0'] }, { ...dates, '1.2.0': '2026-03-01' }, []),
			pendingVersion: '1.2.0',
		});
		expect(renderGenerated(after)).toBe(renderGenerated(before));
	});

	it('does not duplicate a pending version that is already a tag', () => {
		const e: Entry[] = buildEntries({ read: fakeGit(tags, titles, dates, ['x']), pendingVersion: '1.1.0' });
		expect(e.filter(x => x.version === '1.1.0')).toHaveLength(1);
	});

	it('ignores a pending version that is not a plain x.y.z', () => {
		const e: Entry[] = buildEntries({ read: fakeGit(tags, titles, dates, ['x']), pendingVersion: '1.2.0-beta' });
		expect(e.map(x => x.version)).toEqual(['1.1.0', '1.0.0']);
	});

	it('ignores nightly tags and throws when there are no version tags at all', () => {
		expect(() => buildEntries({ read: fakeGit(['nightly-2026-01-01'], {}, {}, []) })).toThrow(/no version tags/);
	});
});

describe('renderGenerated', () => {
	it('escapes titles safely and keeps the entry shape', () => {
		const out: string = renderGenerated([{ version: '1.0.0', date: '2026-01-10', changes: ['fix: "quoted" \\ back'] }]);
		expect(out).toContain('{ version: "1.0.0", date: "2026-01-10", changes: [');
		expect(out).toContain('"fix: \\"quoted\\" \\\\ back"');
	});
});
