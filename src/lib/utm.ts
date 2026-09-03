/**
 * Wspólna (klient + serwer) logika UTM: normalizacja wartości i budowanie
 * finalnego adresu. `slugifyUtm` jest lustrzanym odbiciem SQL-owej funkcji
 * public.utm_slugify(text) — tak jak normalizeInterest odbija
 * email_normalize_interest. Obie muszą dawać ten sam wynik.
 */

/** Parametry UTM w kolejności, w jakiej trafiają do adresu. */
export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

export type UtmKey = (typeof UTM_KEYS)[number];

/** Rodzaje wpisów w słowniku wartości (utm_presets.kind). */
export const PRESET_KINDS = ['source', 'medium', 'campaign', 'content', 'term'] as const;

export type PresetKind = (typeof PRESET_KINDS)[number];

export const PRESET_LABELS: Record<PresetKind, string> = {
	source: 'Źródło (utm_source)',
	medium: 'Medium (utm_medium)',
	campaign: 'Kampania (utm_campaign)',
	content: 'Wariant (utm_content)',
	term: 'Słowo kluczowe (utm_term)'
};

/** Polskie znaki → ASCII. Ta sama mapa co translate() w utm_slugify. */
const PL_MAP: Record<string, string> = {
	ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
	Ą: 'a', Ć: 'c', Ę: 'e', Ł: 'l', Ń: 'n', Ó: 'o', Ś: 's', Ź: 'z', Ż: 'z'
};

/**
 * Normalizuje wartość parametru UTM: polskie znaki na ASCII, małe litery,
 * wszystko poza [a-z0-9] na myślnik, bez myślników na brzegach.
 * Puste wejście zwraca pusty string (w bazie odpowiada mu NULL).
 */
export function slugifyUtm(src: string | null | undefined): string {
	return (src ?? '')
		.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (ch) => PL_MAP[ch] ?? ch)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^-+|-+$/g, '');
}

export type UtmParts = {
	source: string;
	medium: string;
	campaign: string;
	content?: string | null;
	term?: string | null;
	extra?: Record<string, string> | null;
};

/** Normalizuje komplet parametrów. Nie waliduje — do tego służy validateUtm. */
export function normalizeUtmParts(parts: UtmParts): Required<Omit<UtmParts, 'extra'>> & {
	extra: Record<string, string>;
} {
	const extra: Record<string, string> = {};
	for (const [key, value] of Object.entries(parts.extra ?? {})) {
		const k = key.trim();
		const v = String(value ?? '').trim();
		// Parametry utm_* trzymamy w dedykowanych kolumnach, nie w extra_params.
		if (!k || !v || (UTM_KEYS as readonly string[]).includes(k)) continue;
		extra[k] = v;
	}
	return {
		source: slugifyUtm(parts.source),
		medium: slugifyUtm(parts.medium),
		campaign: slugifyUtm(parts.campaign),
		content: slugifyUtm(parts.content) || null,
		term: slugifyUtm(parts.term) || null,
		extra
	};
}

/** Zwraca komunikat błędu albo null, gdy komplet jest poprawny. */
export function validateUtm(baseUrl: string, parts: UtmParts): string | null {
	const url = parseHttpUrl(baseUrl);
	if (!url) return 'Adres docelowy musi być poprawnym adresem http(s)';
	const n = normalizeUtmParts(parts);
	if (!n.source) return 'Podaj źródło (utm_source)';
	if (!n.medium) return 'Podaj medium (utm_medium)';
	if (!n.campaign) return 'Podaj nazwę kampanii (utm_campaign)';
	return null;
}

/** Parsuje adres, przyjmując tylko http i https. Zwraca null przy błędzie. */
export function parseHttpUrl(src: string | null | undefined): URL | null {
	const raw = (src ?? '').trim();
	if (!raw) return null;
	try {
		const url = new URL(raw);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
	} catch {
		return null;
	}
}

/**
 * Skleja adres docelowy z parametrami UTM. Zachowuje parametry, które były już
 * w adresie bazowym, i nadpisuje wyłącznie te utm_*, które podajemy.
 */
export function buildUtmUrl(baseUrl: string, parts: UtmParts): string {
	const url = parseHttpUrl(baseUrl);
	if (!url) return '';
	const n = normalizeUtmParts(parts);

	const values: Record<UtmKey, string | null> = {
		utm_source: n.source || null,
		utm_medium: n.medium || null,
		utm_campaign: n.campaign || null,
		utm_content: n.content,
		utm_term: n.term
	};

	for (const key of UTM_KEYS) {
		const value = values[key];
		if (value) url.searchParams.set(key, value);
		else url.searchParams.delete(key);
	}
	for (const [key, value] of Object.entries(n.extra)) {
		url.searchParams.set(key, value);
	}
	return url.toString();
}

/** Losowy slug krótkiego linku: 7 znaków z alfabetu bez mylących par. */
const SLUG_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';

export function randomSlug(length = 7): string {
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	let out = '';
	for (const byte of bytes) out += SLUG_ALPHABET[byte % SLUG_ALPHABET.length];
	return out;
}

/** Pełny adres krótkiego linku dla danego sluga. */
export function shortLinkUrl(base: string, slug: string): string {
	return `${(base || '').replace(/\/+$/, '')}/l/${slug}`;
}

/**
 * Dokleja parametry UTM do wszystkich linków http(s) w treści HTML maila.
 * Linki, które już mają utm_source, zostają nietknięte — ręcznie wklejony
 * link z biblioteki UTM ma pierwszeństwo przed automatem.
 * Pomijamy `mailto:`, kotwice oraz `{{{UNSUBSCRIBE_URL}}}`, którego adres
 * podstawia dopiero Resend.
 *
 * W atrybucie HTML separator parametrów bywa zapisany jako `&amp;`, więc przed
 * parsowaniem rozkodowujemy encje, a przy zapisie kodujemy `&` z powrotem.
 */
export function decorateLinksWithUtm(html: string, parts: UtmParts): string {
	if (!html) return html;
	return html.replace(
		/(<a\b[^>]*?\bhref=)(["'])(.*?)\2/gi,
		(match, prefix: string, quote: string, href: string) => {
			if (href.includes('{{')) return match;
			const decoded = decodeHtmlAmp(href);
			if (!/^https?:\/\//i.test(decoded)) return match;
			const url = parseHttpUrl(decoded);
			if (!url || url.searchParams.has('utm_source')) return match;
			return `${prefix}${quote}${encodeHtmlAmp(buildUtmUrl(decoded, parts))}${quote}`;
		}
	);
}

function decodeHtmlAmp(value: string): string {
	return value.replaceAll('&amp;', '&');
}

function encodeHtmlAmp(value: string): string {
	return value.replaceAll('&', '&amp;');
}
