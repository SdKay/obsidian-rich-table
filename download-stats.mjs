// Obsidian community downloads over time, as a self-contained SVG pair (light and dark).
//
// Obsidian publishes only the running total (community-plugin-stats.json), but its bot commits that file once a day,
// so the history is the file's own git history. `update` adds today's point and `render` draws the chart; both work on
// one data file (downloads.json) kept on the `stats` branch, so master's history stays untouched.

import fs from 'node:fs';

const STATS_URL = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json';
const DAY = 864e5;

/** Days since the epoch of a YYYY-MM-DD date. */
export const dayNumber = (date) => Date.parse(`${date}T00:00:00Z`) / DAY;

/** Adds a point for `date`. A second run on the same day replaces that day's value rather than adding a point. */
export function addPoint(points, date, total) {
	const kept = points.filter(([d]) => d !== date);
	kept.push([date, total]);
	return kept.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** The totals can only grow; a smaller one is a bad read, not a download that was taken back. */
export function isPlausible(points, date, total) {
	const before = points.filter(([d]) => d < date).at(-1);
	return Number.isInteger(total) && total >= 0 && (!before || total >= before[1]);
}

/** Official releases (x.y.z) only: nightlies and drafts are not releases a reader would look for. */
export function officialReleases(releases) {
	return releases
		.filter(r => /^\d+\.\d+\.\d+$/.test(r.tag) && !r.draft && !r.prerelease)
		.map(r => [r.tag, r.published.slice(0, 10)])
		.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0] < b[0] ? -1 : 1));
}

/** One dot per release day on the curve; a minor release (x.y.0) is larger and named, and wins the day it shares. */
export function releaseDots(points, releases) {
	const total = new Map(points);
	const dots = [];
	for (const [tag, date] of releases) {
		if (!total.has(date)) continue;
		const minor = /\.0$/.test(tag);
		const same = dots.find(d => d.date === date);
		if (!same) dots.push({ date, tag, minor, total: total.get(date) });
		else if (minor && !same.minor) Object.assign(same, { tag, minor });
	}
	return dots;
}

/** The top of the y axis: the next round number above the data. */
export function niceMax(value) {
	const step = 10 ** Math.floor(Math.log10(value));
	for (const k of [1, 2, 2.5, 5, 10]) if (k * step >= value) return k * step;
	return 10 * step;
}

const THEMES = {
	light: { bg: '#ffffff', fg: '#1f2328', mute: '#656d76', grid: '#d8dee4', line: '#7c3aed', area: 0.14 },
	dark: { bg: '#0d1117', fg: '#e6edf3', mute: '#8b949e', grid: '#30363d', line: '#a78bfa', area: 0.22 },
};

const W = 860;
const H = 300;
const M = { l: 58, r: 28, t: 42, b: 40 };
const fmt = (n) => n.toLocaleString('en-US');
const monthName = (date) => new Date(`${date}T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });

export function renderChart({ points, releases }, theme) {
	const c = THEMES[theme];
	const x0 = dayNumber(points[0][0]);
	const x1 = dayNumber(points.at(-1)[0]);
	const last = points.at(-1);
	const yMax = niceMax(last[1] * 1.04);
	const X = (date) => M.l + ((dayNumber(date) - x0) / Math.max(1, x1 - x0)) * (W - M.l - M.r);
	const Y = (n) => H - M.b - (n / yMax) * (H - M.t - M.b);
	const line = points.map(([d, n], i) => `${i ? 'L' : 'M'}${X(d).toFixed(1)} ${Y(n).toFixed(1)}`).join('');
	const area = `${line}L${X(last[0]).toFixed(1)} ${Y(0)}L${X(points[0][0]).toFixed(1)} ${Y(0)}Z`;

	const grid = [0, 1, 2, 3, 4].map(i => {
		const v = (yMax / 4) * i;
		const y = Y(v).toFixed(1);
		return `<line x1="${M.l}" x2="${W - M.r}" y1="${y}" y2="${y}" stroke="${c.grid}"${i ? ' stroke-dasharray="3 4"' : ''}/>`
			+ `<text x="${M.l - 8}" y="${(Y(v) + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="${c.mute}">${fmt(Math.round(v))}</text>`;
	}).join('');

	// A month is labelled in the middle of the part of it the chart covers, and only if that part is wide enough to hold the name.
	const months = [];
	const start = new Date(`${points[0][0].slice(0, 7)}-01T00:00:00Z`);
	for (let m = start; m.getTime() / DAY <= x1; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
		const next = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
		const a = Math.max(m.getTime() / DAY, x0);
		const b = Math.min(next.getTime() / DAY, x1);
		if (b - a < 9) continue;
		const mid = M.l + (((a + b) / 2 - x0) / Math.max(1, x1 - x0)) * (W - M.l - M.r);
		months.push(`<text x="${mid.toFixed(1)}" y="${H - 16}" font-size="11" text-anchor="middle" fill="${c.mute}">${monthName(m.toISOString().slice(0, 10))}</text>`);
	}

	const dots = releaseDots(points, releases).map(d => {
		const x = X(d.date).toFixed(1);
		const y = Y(d.total).toFixed(1);
		return d.minor
			? `<circle cx="${x}" cy="${y}" r="3.4" fill="${c.bg}" stroke="${c.line}" stroke-width="1.8"/><text x="${x}" y="${(Y(d.total) - 11).toFixed(1)}" font-size="11" font-weight="600" text-anchor="middle" fill="${c.fg}">${d.tag.replace(/\.0$/, '')}</text>`
			: `<circle cx="${x}" cy="${y}" r="2.1" fill="${c.bg}" stroke="${c.line}" stroke-width="1.4"/>`;
	}).join('');

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" role="img" aria-label="Obsidian community downloads of Rich Table over time">
<title>Rich Table: Obsidian community downloads over time</title>
<rect width="${W}" height="${H}" rx="10" fill="${c.bg}"/>
<text x="${M.l}" y="26" font-size="14" font-weight="600" fill="${c.fg}">Rich Table · Obsidian downloads</text>
<text x="${W - M.r}" y="26" font-size="13" text-anchor="end" fill="${c.mute}">${fmt(last[1])} total</text>
${grid}${months.join('')}
<path d="${area}" fill="${c.line}" opacity="${c.area}"/>
<path d="${line}" fill="none" stroke="${c.line}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
${dots}
<circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="4" fill="${c.line}" stroke="${c.bg}" stroke-width="2"/>
</svg>
`;
}

async function getJson(url, headers = {}) {
	const res = await fetch(url, { headers: { 'User-Agent': 'rich-table-stats', ...headers } });
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
	return res.json();
}

/** The plugin's running total, and the day the bot wrote it (UTC), from the official stats file. */
async function fetchTotal(plugin) {
	const stats = await getJson(STATS_URL);
	const entry = stats[plugin];
	if (!entry || !Number.isInteger(entry.downloads)) throw new Error(`no download count for "${plugin}" in the stats file`);
	return entry.downloads;
}

async function fetchReleases(repo, token) {
	const headers = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
	const all = [];
	for (let page = 1; ; page++) {
		const batch = await getJson(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, headers);
		all.push(...batch.map(r => ({ tag: r.tag_name, published: r.published_at, draft: r.draft, prerelease: r.prerelease })));
		if (batch.length < 100) return all;
	}
}

async function main() {
	const [command, file = 'downloads.json'] = process.argv.slice(2);
	if (command === 'update') {
		const data = JSON.parse(fs.readFileSync(file, 'utf8'));
		const today = new Date().toISOString().slice(0, 10);
		const total = await fetchTotal(data.plugin);
		if (!isPlausible(data.points, today, total)) throw new Error(`${total} on ${today} is below the earlier total; not recording it`);
		data.points = addPoint(data.points, today, total);
		data.releases = officialReleases(await fetchReleases(data.repo, process.env.GITHUB_TOKEN));
		fs.writeFileSync(file, `${JSON.stringify(data)}\n`);
		console.log(`${today}: ${total} (${data.points.length} points, ${data.releases.length} releases)`);
	} else if (command === 'render') {
		const data = JSON.parse(fs.readFileSync(file, 'utf8'));
		const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
		for (const theme of ['light', 'dark']) fs.writeFileSync(`${dir}downloads-${theme}.svg`, renderChart(data, theme));
		console.log('wrote downloads-light.svg and downloads-dark.svg');
	} else {
		console.error('usage: node download-stats.mjs update|render [downloads.json]');
		process.exit(1);
	}
}

if (process.argv[1] && import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href) main().catch(e => { console.error(e.message); process.exit(1); });
