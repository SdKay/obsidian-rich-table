import { readFileSync, writeFileSync } from 'fs';

/**
 * Rewrites every `resolved` URL in package-lock.json back to the official npm
 * registry.
 *
 * Why this is needed: regenerating the lockfile writes whatever registry the
 * machine happens to be configured for into all ~400 `resolved` URLs. A
 * lockfile carrying a regional mirror is wrong to commit — CI and anyone else
 * cloning the repo would be pinned to a mirror they never chose, and the diff
 * touches every line, hiding the actual dependency change underneath it.
 *
 * Why it is safe to rewrite, and why it does NOT break a mirror-configured
 * machine: `resolved` only records where the tarball came from. `integrity` is
 * a hash of the tarball itself, which a mirror serves byte-for-byte, so the
 * hashes stay valid. And npm substitutes the host of a registry `resolved` URL
 * with the locally configured registry — verified against a cold cache: a
 * lockfile of npmjs.org URLs installs from the mirror without a single network
 * error. So the committed lockfile can be canonical while local installs keep
 * using the mirror.
 *
 * Run this after any `npm install` that regenerates the lockfile — see the
 * dependency-hygiene notes in CLAUDE.md.
 */
const OFFICIAL = 'https://registry.npmjs.org/';
const MIRRORS = [
	'https://registry.npmmirror.com/',
	'https://registry.npm.taobao.org/',
];

const file = 'package-lock.json';
const before = readFileSync(file, 'utf8');

// A textual replace rather than a JSON round-trip: re-serializing would reformat
// the whole file and bury the real change in noise. The result is parsed below to
// prove it is still valid JSON.
let after = before;
let replaced = 0;
for (const mirror of MIRRORS) {
	const parts = after.split(mirror);
	replaced += parts.length - 1;
	after = parts.join(OFFICIAL);
}

const lock = JSON.parse(after);

// Anything still pointing somewhere other than the official registry is a host
// this script does not know about — report it rather than silently leaving it in.
const foreign = new Set();
for (const pkg of Object.values(lock.packages ?? {})) {
	const url = pkg.resolved;
	if (typeof url === 'string' && url.startsWith('http') && !url.startsWith(OFFICIAL)) {
		foreign.add(new URL(url).host);
	}
}

if (replaced > 0) writeFileSync(file, after);
console.log(`[lockfile] ${replaced} mirror URL(s) normalized to ${OFFICIAL}`);
if (foreign.size > 0) {
	console.log(`[lockfile] WARNING: unrecognized registry host(s) left in place: ${[...foreign].join(', ')}`);
	process.exitCode = 1;
}
