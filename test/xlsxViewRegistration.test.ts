import { describe, it, expect } from 'vitest';
import { enableXlsxView, disableXlsxView, type ViewRegistryLike } from '../src/xlsxViewRegistration';

const base = { extension: 'xlsx', viewType: 'rich-table-xlsx' };

function recordingRegistry() {
	const calls: string[] = [];
	const registry: ViewRegistryLike = {
		unregisterExtensions: (e) => { calls.push(`ext:${e.join(',')}`); },
		unregisterView: (t) => { calls.push(`view:${t}`); },
	};
	return { calls, registry };
}

describe('enableXlsxView', () => {
	it('is owned when registration succeeds', () => {
		expect(enableXlsxView({ ...base, registry: undefined, register: () => {} })).toEqual({ kind: 'owned' });
	});

	it('is refused, carrying the error, when Obsidian throws because another plugin owns the extension', () => {
		const error = new Error('Attempting to register an existing file extension "xlsx"');
		expect(enableXlsxView({ ...base, registry: undefined, register: () => { throw error; } })).toEqual({ kind: 'refused', error });
	});
});

describe('disableXlsxView', () => {
	it('gives back the extension first and the view type second', () => {
		const { calls, registry } = recordingRegistry();
		expect(disableXlsxView({ ...base, registry })).toEqual({ kind: 'off' });
		expect(calls).toEqual(['ext:xlsx', 'view:rich-table-xlsx']);
	});

	it('waits for a reload, touching nothing, when the registry has no unregister methods', () => {
		expect(disableXlsxView({ ...base, registry: {} })).toEqual({ kind: 'needs-reload' });
		expect(disableXlsxView({ ...base, registry: undefined })).toEqual({ kind: 'needs-reload' });
	});

	it('waits for a reload, touching nothing, when only one of the two methods exists', () => {
		const calls: string[] = [];
		const onlyExt: ViewRegistryLike = { unregisterExtensions: (e) => { calls.push(e.join()); } };
		const onlyView: ViewRegistryLike = { unregisterView: (t) => { calls.push(t); } };
		expect(disableXlsxView({ ...base, registry: onlyExt })).toEqual({ kind: 'needs-reload' });
		expect(disableXlsxView({ ...base, registry: onlyView })).toEqual({ kind: 'needs-reload' });
		expect(calls).toEqual([]);
	});
});
