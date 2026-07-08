/**
 * Kanoniczne kody kategorii — lustrzane odbicie SQL-owej funkcji
 * public.email_normalize_interest(text). Analityka i segmentacja operują
 * wyłącznie na tych kodach, nigdy na surowym tekście `ubezpieczenie`.
 */
export const CANONICAL_CODES = [
	'oc',
	'konsultacja',
	'tax',
	'utrata_dochodu',
	'zdrowie',
	'grupowe',
	'brak',
	'inne'
] as const;

export type CanonicalCode = (typeof CANONICAL_CODES)[number];

export const CODE_LABELS: Record<CanonicalCode, string> = {
	oc: 'Ubezpieczenie OC',
	konsultacja: 'Konsultacja',
	tax: 'Ochrona karno-skarbowa',
	utrata_dochodu: 'Utrata dochodu',
	zdrowie: 'Pakiety zdrowotne',
	grupowe: 'Ubezpieczenia grupowe',
	brak: 'Brak danych',
	inne: 'Inne'
};

/** Normalizuje warianty myślników (EN/EM dash, minus) do zwykłego '-'. */
function normalizeDashes(value: string): string {
	return value.replace(/[‐‑‒–—−]/g, '-');
}

export function normalizeInterest(src: string | null | undefined): CanonicalCode {
	const v = normalizeDashes(src ?? '')
		.trim()
		.toLowerCase();
	if (v === '') return 'brak';
	if (v.startsWith('ubezpieczenie oc')) return 'oc';
	if (v.startsWith('nie wiem')) return 'konsultacja';
	if (v.startsWith('ochrona karno-skarbowa')) return 'tax';
	if (v.startsWith('ubezpieczenie utraty dochodu')) return 'utrata_dochodu';
	if (v.startsWith('pakiety zdrowotne')) return 'zdrowie';
	if (v.startsWith('ubezpieczenia grupowe')) return 'grupowe';
	return 'inne';
}

/** Interpretacja zgody RODO — lustro SQL public.email_has_rodo_consent(text). */
export function hasRodoConsent(src: string | null | undefined): boolean {
	const v = (src ?? '').trim().toLowerCase();
	return ['tak', 'true', '1', 'yes', 'on', 'zgoda'].includes(v);
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
