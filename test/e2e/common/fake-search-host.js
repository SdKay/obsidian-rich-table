// A stand-in for the Rich Search plugin's host API, installed on window as __btMakeSearchHost.
// Matching rules (whole word, case) belong to the host, not to the code under test, so they live here.
window.__btMakeSearchHost = function (name, initialQuery) {
	const matchLine = (text, o) => {
		const out = [];
		if (o.query === '') return out;
		const hay = o.caseSensitive ? text : text.toLowerCase();
		const needle = o.caseSensitive ? o.query : o.query.toLowerCase();
		for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
			const before = at === 0 ? '' : hay[at - 1];
			const after = hay[at + needle.length] ?? '';
			if (o.wholeWord && (/\w/.test(before) || /\w/.test(after))) continue;
			out.push({ start: at, end: at + needle.length });
		}
		return out;
	};
	const panel = { query: initialQuery ?? null, listeners: new Set(), hit: null, hitListeners: new Set(), scopeFolder: null, scopeListeners: new Set() };
	const withPanel = (apiVersion, withHit = true) => ({
		apiVersion, matchLine,
		currentQuery: () => panel.query,
		onQueryChange: (fn) => { panel.listeners.add(fn); return () => { panel.listeners.delete(fn); }; },
		...(withHit ? {
			currentHit: () => panel.hit,
			onHitChange: (fn) => { panel.hitListeners.add(fn); return () => { panel.hitListeners.delete(fn); }; },
		} : {}),
	});
	// The scope is "everything" until a test limits it to a folder with __btPanel.scopeFolder.
	const inScope = (path) => panel.scopeFolder === null || path.startsWith(panel.scopeFolder);
	const onScopeChange = (fn) => { panel.scopeListeners.add(fn); return () => { panel.scopeListeners.delete(fn); }; };
	const apis = {
		none: undefined,
		panel: withPanel(1),
		noHit: withPanel(1, false),
		legacy: { apiVersion: 1, matchLine },
		throws: { apiVersion: 1, matchLine: () => { throw new Error('host failed'); } },
		hitThrows: { ...withPanel(1), currentHit: () => { throw new Error('host failed'); } },
		future: withPanel(2),
		scoped: { ...withPanel(1), inScope, onScopeChange },
		scopeOnly: { ...withPanel(1), inScope },
		scopeListenerOnly: { ...withPanel(1), onScopeChange },
		scopeThrows: { ...withPanel(1), inScope: () => { throw new Error('host failed'); }, onScopeChange },
	};
	const state = { name: name ?? 'none' };
	window.__btPanel = panel;
	window.__btHostState = state;
	return () => apis[state.name];
};
