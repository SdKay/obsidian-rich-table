import { describe, it, expect } from 'vitest';
import { shouldShowChangelog } from '../src/changelogModal';

describe('shouldShowChangelog', () => {
	it('does not show on a brand-new install (no prior version recorded)', () => {
		expect(shouldShowChangelog(undefined, '1.3.2')).toBe(false);
	});

	it('does not show when the version is unchanged', () => {
		expect(shouldShowChangelog('1.3.2', '1.3.2')).toBe(false);
	});

	it('shows after an upgrade', () => {
		expect(shouldShowChangelog('1.3.1', '1.3.2')).toBe(true);
	});

	it('shows after a downgrade too — any version change since last seen', () => {
		expect(shouldShowChangelog('1.3.2', '1.3.1')).toBe(true);
	});
});
