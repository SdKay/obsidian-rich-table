import type { MatchOptions, RichSearchHostApi, Span } from './richSearchApi';

/**
 * Where `opts` matches in one text unit, by Rich Search's own rules (whole word, CJK, regex), which live
 * in one place. Never throws: a host that fails means nothing is marked.
 */
export function matchText(text: string, opts: MatchOptions, host: RichSearchHostApi): Span[] {
	try {
		return host.matchLine(text, opts);
	} catch {
		return [];
	}
}
