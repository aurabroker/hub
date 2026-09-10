import { adminClient } from '$lib/server/supabase';
import { AnalyticsConfigError, loadCampaignEntries, windows } from '$lib/server/analytics';
import type { PageServerLoad } from './$types';

/**
 * Skuteczność kampanii, zestawienie trzech różnych liczników.
 *
 * | Licznik | Co znaczy | Skąd |
 * |---|---|---|
 * | kliknięcia własne | ktoś kliknął krótki link `/l/{slug}` | `utm_clicks` |
 * | kliknięcia Bitly | ktoś kliknął skrót bit.ly | API Bitly, pobierane ręcznie |
 * | wejścia | strona z parametrami `utm_*` faktycznie się otworzyła | Analytics Engine |
 *
 * Trzeci licznik jest tu dlatego, że bez niego raport kłamał przez przemilczenie.
 * Kampania, w której do reklamy wkleiono pełny adres z `utm_*` zamiast krótkiego
 * linku, ma zero kliknięć i wygląda na martwą — a w panelu analityki widać jej
 * ruch. Zero w tej kolumnie znaczy „nikt nie przeszedł przez nasz przekierownik",
 * a nie „nikt nie wszedł na stronę".
 */

/**
 * Okno dla wejść. Analytics Engine trzyma dane trzy miesiące, ale kolumna
 * z innym oknem niż reszta tabeli myli, więc bierzemy 30 dni i mówimy o tym
 * wprost w nagłówku kolumny.
 */
const ENTRIES_RANGE = '30d';

/** Klucz łączący wiersze: te same trzy wartości, znormalizowane po obu stronach. */
function key(source: unknown, medium: unknown, campaign: unknown): string {
	return `${source ?? ''}|${medium ?? ''}|${campaign ?? ''}`;
}

export const load: PageServerLoad = async () => {
	const db = adminClient();

	const [{ data: rows }, { data: recent }, { count: attributionCount }, entries] = await Promise.all([
		db.from('utm_campaign_performance').select('*').order('clicks_total', { ascending: false }).limit(200),
		db
			.from('utm_attributions')
			.select('id, email, company_id, utm_source, utm_medium, utm_campaign, landing_url, created_at')
			.order('created_at', { ascending: false })
			.limit(50),
		db.from('utm_attributions').select('id', { count: 'exact', head: true }),
		// Analityka bywa nieskonfigurowana (brak CF_ACCOUNT_ID / ANALYTICS_TOKEN)
		// albo chwilowo niedostępna. Raport o kliknięciach ma się wtedy pokazać
		// bez tej jednej kolumny, a nie wysypać całą stronę.
		loadCampaignEntries(windows(ENTRIES_RANGE).current).catch((e) => (e instanceof Error ? e : new Error(String(e))))
	]);

	const entriesByKey = entries instanceof Map ? entries : new Map<string, number>();
	const entriesError =
		entries instanceof Error
			? entries instanceof AnalyticsConfigError
				? entries.message
				: `Nie udało się pobrać wejść z Analytics Engine. ${entries.message}`
			: null;

	const fromDb = (rows ?? []).map((r) => ({
		...r,
		entries: entriesByKey.get(key(r.utm_source, r.utm_medium, r.utm_campaign)) ?? 0
	}));

	// Kampanie widoczne w ruchu, ale nieobecne w bibliotece linków. To nie jest
	// przypadek brzegowy, tylko codzienność: link do reklamy bywa sklejany ręcznie
	// albo w panelu reklamowym, z pominięciem generatora.
	const known = new Set(fromDb.map((r) => key(r.utm_source, r.utm_medium, r.utm_campaign)));
	// Wejścia bez nazwy kampanii pomijamy. `utm_source=chatgpt.com` dokleja sam
	// asystent i to nie jest kampania — w panelu analityki ląduje w kanale
	// „Asystenci AI" i tam jest jego miejsce. Linki z generatora nazwy kampanii
	// nie mogą nie mieć, bo `validateUtm` jej wymaga.
	const onlyInTraffic = [...entriesByKey]
		.filter(([k]) => !known.has(k) && k.split('|')[2] !== '')
		.map(([k, value]) => {
			const [utm_source, utm_medium, utm_campaign] = k.split('|');
			return {
				utm_campaign: utm_campaign || null,
				utm_source: utm_source || null,
				utm_medium: utm_medium || null,
				links: 0,
				clicks_own: 0,
				clicks_bitly: 0,
				clicks_total: 0,
				leads: 0,
				last_click_at: null as string | null,
				entries: value
			};
		});

	const performance = [...fromDb, ...onlyInTraffic].sort(
		(a, b) => Number(b.clicks_total ?? 0) + b.entries - (Number(a.clicks_total ?? 0) + a.entries)
	);

	return {
		performance,
		recent: recent ?? [],
		entriesError,
		entriesRangeLabel: '30 dni',
		totals: {
			campaigns: new Set(performance.map((r) => r.utm_campaign)).size,
			clicks: performance.reduce((sum, r) => sum + Number(r.clicks_total ?? 0), 0),
			entries: performance.reduce((sum, r) => sum + r.entries, 0),
			leads: performance.reduce((sum, r) => sum + Number(r.leads ?? 0), 0),
			attributions: attributionCount ?? 0
		}
	};
};
