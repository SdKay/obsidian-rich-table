// Polyfills Obsidian's DOM prototype extensions, which come from Obsidian's own
// app runtime at plugin-load time — NOT from the `obsidian` npm package, which is
// types only. A plain browser has no idea they exist, so running any real,
// unmodified source file that calls them needs this.
//
// Injected via page.addInitScript() in test/e2e/common/test-base.ts, once per
// page, before any fixture or bundle script runs.
//
// Faithfulness matters here in one specific way: createEl/createDiv/createSpan
// must produce the same DOM shape and honour the same options object as
// Obsidian's, because everything the layout and the pixel probes measure is built
// through them. `find` returns the FIRST match like Obsidian's (not a NodeList),
// since callers use it as a single-element accessor.
(function () {
	// Obsidian exposes these globals so a plugin works inside a popped-out window
	// (they point at whichever document/window currently has focus). In a single
	// browser page they're just document/window — but the source calls them
	// unqualified, so without these it dies with "activeDocument is not defined".
	if (typeof window.activeDocument === 'undefined') window.activeDocument = document;
	if (typeof window.activeWindow === 'undefined') window.activeWindow = window;

	const proto = Element.prototype;
	if (proto.addClass) return; // already patched (e.g. a second addInitScript run)

	proto.addClass = function (...classes) {
		this.classList.add(...classes.flatMap(c => String(c).split(/\s+/).filter(Boolean)));
	};
	proto.removeClass = function (...classes) {
		this.classList.remove(...classes.flatMap(c => String(c).split(/\s+/).filter(Boolean)));
	};
	proto.toggleClass = function (classes, value) {
		const list = Array.isArray(classes) ? classes : String(classes).split(/\s+/).filter(Boolean);
		for (const cls of list) this.classList.toggle(cls, value);
	};
	proto.hasClass = function (cls) {
		return this.classList.contains(cls);
	};

	// Obsidian's element factory. `o` accepts cls / text / attr / title / value /
	// type / placeholder / href, plus prepend, exactly as the real one does — the
	// plugin uses cls/text/attr/type/value/placeholder in practice.
	function createEl(tag, o, callback) {
		const el = document.createElement(tag);
		if (typeof o === 'string') {
			el.className = o;
		} else if (o) {
			if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
			if (o.text !== undefined) {
				if (o.text instanceof DocumentFragment) el.appendChild(o.text);
				else el.textContent = String(o.text);
			}
			if (o.attr) {
				for (const [k, v] of Object.entries(o.attr)) {
					if (v === false || v === null || v === undefined) continue;
					el.setAttribute(k, String(v));
				}
			}
			if (o.title !== undefined) el.setAttribute('title', o.title);
			if (o.type !== undefined) el.setAttribute('type', o.type);
			if (o.value !== undefined) el.value = o.value;
			if (o.placeholder !== undefined) el.setAttribute('placeholder', o.placeholder);
			if (o.href !== undefined) el.setAttribute('href', o.href);
		}
		// The real API appends to the receiver (or prepends when asked) and returns
		// the NEW element — code chains off the return value constantly.
		if (o && o.prepend) this.insertBefore(el, this.firstChild);
		else this.appendChild(el);
		if (callback) callback(el);
		return el;
	}

	proto.createEl = createEl;
	proto.createDiv = function (o, callback) { return createEl.call(this, 'div', o, callback); };
	proto.createSpan = function (o, callback) { return createEl.call(this, 'span', o, callback); };

	proto.setText = function (text) {
		if (text instanceof DocumentFragment) {
			this.textContent = '';
			this.appendChild(text);
		} else {
			this.textContent = String(text);
		}
	};
	proto.empty = function () {
		while (this.firstChild) this.removeChild(this.firstChild);
	};
	proto.detach = function () {
		this.parentNode?.removeChild(this);
	};
	proto.appendText = function (text) {
		this.appendChild(document.createTextNode(String(text)));
	};
	proto.insertAfter = function (node, ref) {
		this.insertBefore(node, (ref ?? null) ? ref.nextSibling : this.firstChild);
		return node;
	};
	proto.setAttr = function (name, value) {
		if (value === null || value === false) this.removeAttribute(name);
		else this.setAttribute(name, value === true ? '' : String(value));
	};
	proto.getAttr = function (name) { return this.getAttribute(name); };
	// Single element, not a list — callers treat it as an accessor.
	proto.find = function (selector) { return this.querySelector(selector); };
	proto.findAll = function (selector) { return Array.from(this.querySelectorAll(selector)); };
	proto.matchParent = function (selector, lastParent) {
		let el = this;
		while (el) {
			if (el.matches?.(selector)) return el;
			if (el === lastParent) break;
			el = el.parentElement;
		}
		return null;
	};

	const cssProto = HTMLElement.prototype;
	cssProto.setCssProps = function (props) {
		for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
	};
	cssProto.setCssStyles = function (styles) {
		Object.assign(this.style, styles);
	};
	cssProto.show = function () { this.style.display = ''; };
	cssProto.hide = function () { this.style.display = 'none'; };
	cssProto.toggleVisibility = function (visible) { visible ? this.show() : this.hide(); };

	// Document-level factories the plugin may use for detached trees.
	Document.prototype.createDiv = function (o, callback) { return createEl.call(this.body, 'div', o, callback); };
	DocumentFragment.prototype.createEl = createEl;
	DocumentFragment.prototype.createDiv = function (o, callback) { return createEl.call(this, 'div', o, callback); };
	DocumentFragment.prototype.createSpan = function (o, callback) { return createEl.call(this, 'span', o, callback); };
})();
