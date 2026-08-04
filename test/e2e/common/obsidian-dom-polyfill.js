// Polyfills the small subset of Obsidian's DOM prototype extensions that
// the REAL source under test (src/renderFreeze.ts and its dependencies)
// actually calls — addClass/removeClass/toggleClass/hasClass/setCssProps/
// setCssStyles. These come from Obsidian's own app runtime at real
// plugin-load time (not from the `obsidian` npm package, which is types
// only — see obsidian.d.ts) — a real browser has no idea they exist, so
// running any real, unmodified source file that calls them needs this.
//
// Injected via page.addInitScript() in test/e2e/common/test-base.ts, once
// per page, before any fixture or bundle script runs.
(function () {
	const proto = Element.prototype;
	if (proto.addClass) return; // already patched (e.g. a second addInitScript run)

	proto.addClass = function (...classes) {
		this.classList.add(...classes);
	};
	proto.removeClass = function (...classes) {
		this.classList.remove(...classes);
	};
	proto.toggleClass = function (classes, value) {
		const list = Array.isArray(classes) ? classes : classes.split(/\s+/).filter(Boolean);
		for (const cls of list) this.classList.toggle(cls, value);
	};
	proto.hasClass = function (cls) {
		return this.classList.contains(cls);
	};

	const cssProto = HTMLElement.prototype;
	cssProto.setCssProps = function (props) {
		for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
	};
	cssProto.setCssStyles = function (styles) {
		Object.assign(this.style, styles);
	};
})();
