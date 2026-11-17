import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addPoint, isPlausible, officialReleases, releaseDots, niceMax, renderChart } from './download-stats.mjs';

describe('addPoint', () => {
	it('keeps the days in order whatever order they arrive in', () => {
		let p = [['2026-07-02', 5]];
		p = addPoint(p, '2026-07-01', 2);
		p = addPoint(p, '2026-07-03', 9);
		assert.deepEqual(p.map(x => x[0]), ['2026-07-01', '2026-07-02', '2026-07-03']);
	});

	it('replaces a day it already has instead of adding a second point', () => {
		const p = addPoint([['2026-07-01', 2], ['2026-07-02', 5]], '2026-07-02', 6);
		assert.deepEqual(p, [['2026-07-01', 2], ['2026-07-02', 6]]);
	});
});

describe('isPlausible', () => {
	const history = [['2026-07-01', 100], ['2026-07-02', 120]];

	it('accepts a total that has not gone down', () => {
		assert.equal(isPlausible(history, '2026-07-03', 120), true);
		assert.equal(isPlausible(history, '2026-07-03', 130), true);
	});

	it('refuses a total below the day before: downloads are not taken back', () => {
		assert.equal(isPlausible(history, '2026-07-03', 119), false);
	});

	it('compares with the day before the one being written, so re-running a day is fine', () => {
		assert.equal(isPlausible(history, '2026-07-02', 121), true);
		assert.equal(isPlausible(history, '2026-07-02', 99), false);
	});

	it('refuses what is not a count', () => {
		assert.equal(isPlausible([], '2026-07-01', Number.NaN), false);
		assert.equal(isPlausible([], '2026-07-01', -1), false);
		assert.equal(isPlausible([], '2026-07-01', 1.5), false);
		assert.equal(isPlausible([], '2026-07-01', 0), true);
	});
});

describe('officialReleases', () => {
	const r = (tag, published, extra = {}) => ({ tag, published: `${published}T10:00:00Z`, ...extra });

	it('keeps x.y.z releases and drops nightlies, drafts and pre-releases', () => {
		const out = officialReleases([
			r('1.0.0', '2026-07-10'), r('nightly-2026-07-11', '2026-07-11'), r('1.0.1', '2026-07-12', { draft: true }),
			r('1.1.0-beta.1', '2026-07-13'), r('1.1.0', '2026-07-14', { prerelease: true }), r('1.1.1', '2026-07-15'),
		]);
		assert.deepEqual(out, [['1.0.0', '2026-07-10'], ['1.1.1', '2026-07-15']]);
	});

	it('orders by publication day', () => {
		const out = officialReleases([r('1.2.0', '2026-08-02'), r('1.1.0', '2026-08-01')]);
		assert.deepEqual(out.map(x => x[0]), ['1.1.0', '1.2.0']);
	});
});

describe('releaseDots', () => {
	const points = [['2026-07-01', 10], ['2026-07-02', 20], ['2026-07-03', 30]];

	it('puts a release on the curve at that day\'s total', () => {
		assert.deepEqual(releaseDots(points, [['1.0.1', '2026-07-02']]), [{ date: '2026-07-02', tag: '1.0.1', minor: false, total: 20 }]);
	});

	it('names a minor release (x.y.0) and gives it the day it shares with a patch', () => {
		const dots = releaseDots(points, [['1.0.1', '2026-07-02'], ['1.1.0', '2026-07-02']]);
		assert.equal(dots.length, 1);
		assert.deepEqual(Object.fromEntries(Object.keys({ tag: '1.1.0', minor: true }).map(k => [k, dots[0][k]])), { tag: '1.1.0', minor: true });
		assert.deepEqual(Object.fromEntries(Object.keys({ tag: '1.1.0', minor: true }).map(k => [k, releaseDots(points, [['1.1.0', '2026-07-02'], ['1.1.1', '2026-07-02']])[0][k]])), { tag: '1.1.0', minor: true });
	});

	it('leaves out a release from a day the chart does not cover', () => {
		assert.deepEqual(releaseDots(points, [['0.9.0', '2026-06-30'], ['2.0.0', '2026-08-01']]), []);
	});
});

describe('niceMax', () => {
	it('is the next round number at or above the value', () => {
		assert.equal(niceMax(9526), 10000);
		assert.equal(niceMax(10001), 20000);
		assert.equal(niceMax(430), 500);
		assert.equal(niceMax(1), 1);
		assert.equal(niceMax(2300), 2500);
	});
});

describe('renderChart', () => {
	const data = {
		points: [['2026-07-04', 3], ['2026-07-05', 40], ['2026-07-06', 120]],
		releases: [['1.0.0', '2026-07-05']],
	};

	it('draws the total and the named release for both themes', () => {
		for (const theme of ['light', 'dark']) {
			const svg = renderChart(data, theme);
			assert.equal(svg.startsWith('<svg '), true);
			assert.ok(String(svg).includes('120 total'));
			assert.ok(String(svg).includes('>1.0<'));
		}
	});

	it('uses a different background for each theme', () => {
		assert.ok(String(renderChart(data, 'light')).includes('fill="#ffffff"'));
		assert.ok(String(renderChart(data, 'dark')).includes('fill="#0d1117"'));
	});

	it('draws a single day without dividing by zero', () => {
		const svg = renderChart({ points: [['2026-07-04', 3]], releases: [] }, 'light');
		assert.ok(!String(svg).includes('NaN'));
		assert.ok(!String(svg).includes('Infinity'));
	});

	it('is well formed enough for an XML parser', () => {
		const svg = renderChart(data, 'light');
		assert.equal((svg.match(/<svg /g) ?? []).length, 1);
		assert.equal(svg.trimEnd().endsWith('</svg>'), true);
	});
});
