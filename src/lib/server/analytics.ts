import { env } from '$env/dynamic/private';
import {
	PANEL_TIMEZONE,
	PROBE_PATH_PATTERNS,
	RANGES,
	type RangeKey,
	type TopRow
} from '$lib/analytics';

/**
 * Warstwa zapytań do Cloudflare Analytics Engine (SQL API).
 *
 * Token jest sekretem serwera i nigdy nie trafia do przeglądarki — panel
 * dostaje gotowe liczby, nie zapytania. Wyniki cache'ujemy na 60 sekund
 * przez Cache API, osobno dla każdego zapytania, żeby odświeżenie panelu nie
 * odpalało kompletu zapytań od nowa.
 *
 * Trzy zasady, których łamanie po cichu psuje liczby (szerzej w CLAUDE.md):
 *  1. Zdarzenia liczymy przez SUM(_sample_interval), nigdy count(). Analytics
 *     Engine przy większym ruchu zapisuje próbkę, a nie wszystko.
 *  2. Timestampy są w UTC, panel pokazuje Europe/Warsaw. Strefę podajemy
 *     funkcjom SQL wprost, bo stałe przesunięcie łamie się na zmianie czasu.
 *  3. SQL zwraca blob1, blob2, double1 bez nazw. Mapowanie jest kontraktem
 *     opisanym w CLAUDE.md i w stałej FIELDS w collectorze.
 */

const DATASET = 'web_events';
const CACHE_SECONDS = 60;

/** Ile pozycji pokazujemy w tabelach rankingowych. */
export const TOP_LIMIT = 10;

export type Row = Record<string, string | number | null>;
export type { TopRow };

/** Liczby jednego okresu — kafelki na górze panelu. */
export type Totals = {
	pageviews: number;
	visitors: number;
	avgResponseMs: number;
	errorShare: number;
	botShare: number;
};

export class AnalyticsConfigError extends Error {}

function credentials(): { accountId: string; token: string } {
	const accountId = env.CF_ACCOUNT_ID;
	const token = env.ANALYTICS_TOKEN;
	if (!accountId || !token) {
		throw new AnalyticsConfigError(
			'Brak konfiguracji analityki: ustaw CF_ACCOUNT_ID oraz ANALYTICS_TOKEN ' +
				'w Cloudflare Pages → Settings → Variables and Secrets, a następnie wykonaj redeploy.'
		);
	}
	return { accountId, token };
}

/**
 * Klucz cache'a. Cache API indeksuje po adresie, więc z treści zapytania
 * robimy skrót — samo SQL bywa dłuższe niż rozsądny adres.
 */
async function cacheKey(sql: string): Promise<Request> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sql));
	const hex = [...new Uint8Array(digest).slice(0, 16)]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	return new Request(`https://analytics.aura.internal/q/${hex}`);
}

/**
 * Wykonuje zapytanie SQL i zwraca wiersze.
 *
 * Cache API istnieje tylko w środowisku Workers — w `vite dev` go nie ma,
 * więc każde odwołanie jest opakowane w try/catch i degraduje się do zwykłego
 * zapytania zamiast wywracać stronę.
 */
export async function runQuery(sql: string): Promise<Row[]> {
	const { accountId, token } = credentials();
	const key = await cacheKey(sql);
	const cache = typeof caches !== 'undefined' ? ((caches as { default?: Cache }).default ?? null) : null;

	if (cache) {
		try {
			const hit = await cache.match(key);
			if (hit) return ((await hit.json()) as { data?: Row[] }).data ?? [];
		} catch {
			// Nieudany odczyt cache'a nie jest powodem, żeby nie pokazać danych.
		}
	}

	const res = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
		{ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: sql }
	);

	if (!res.ok) {
		// Treść błędu SQL API bywa jedyną wskazówką, co w zapytaniu jest nie tak.
		throw new Error(`SQL API zwróciło ${res.status}: ${(await res.text()).slice(0, 300)}`);
	}

	const parsed = (await res.json()) as { data?: Row[] };
	const rows = parsed.data ?? [];

	if (cache) {
		try {
			await cache.put(
				key,
				new Response(JSON.stringify({ data: rows }), {
					headers: {
						'content-type': 'application/json',
						'cache-control': `max-age=${CACHE_SECONDS}`
					}
				})
			);
		} catch {
			// Brak zapisu do cache'a oznacza tylko więcej zapytań, nie błąd.
		}
	}

	return rows;
}

/** Moment UTC sformatowany tak, jak przyjmuje go `toDateTime()` w SQL. */
function sqlTime(at: Date): string {
	return at.toISOString().slice(0, 19).replace('T', ' ');
}

export type Window = { from: Date; to: Date };

/**
 * Okno bieżące i poprzednie, równej długości.
 *
 * Okna są przesuwne, nie kalendarzowe. Dzięki temu porównanie „wobec
 * poprzedniego okresu" jest uczciwe — obie strony mają dokładnie tyle samo
 * godzin i żadna nie kończy się w połowie doby.
 */
export function windows(range: RangeKey, now = new Date()): { current: Window; previous: Window } {
	const span = RANGES[range].hours * 3600_000;
	const from = new Date(now.getTime() - span);
	return {
		current: { from, to: now },
		previous: { from: new Date(from.getTime() - span), to: from }
	};
}

/**
 * Wspólny filtr każdego zapytania.
 *
 * Host jest wstawiany do SQL, więc **musi** pochodzić z listy mierzonych
 * hostów (`isMeasuredHost`), a nie wprost z adresu. Wywołujący to sprawdza.
 */
function where(win: Window, host: string | null, eventType: 'pageview' | 'vital'): string {
	const parts = [
		`blob3 = '${eventType}'`,
		`timestamp >= toDateTime('${sqlTime(win.from)}')`,
		`timestamp < toDateTime('${sqlTime(win.to)}')`
	];
	if (host) parts.push(`blob1 = '${host}'`);
	return parts.join(' AND ');
}

function num(value: string | number | null | undefined): number {
	const parsed = Number(value ?? 0);
	return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Kafelki: odsłony, średni czas odpowiedzi, udział błędów i botów.
 *
 * Średnia musi być ważona `_sample_interval` — bez tego jedno rzadkie zdarzenie
 * waży tyle samo co tysiąc częstych. `toUInt32(blob9)` jest bezpieczne, bo
 * filtr `blob3 = 'pageview'` zostawia w tej kolumnie wyłącznie kod odpowiedzi.
 */
export async function loadTotals(win: Window, host: string | null): Promise<Totals> {
	const [summary, unique] = await Promise.all([
		runQuery(`SELECT SUM(_sample_interval)                                   AS odslony,
                 SUM(double1 * _sample_interval) / SUM(_sample_interval) AS sredni_czas_ms,
                 sumIf(_sample_interval, toUInt32(blob9) >= 400)         AS bledy,
                 sumIf(_sample_interval, blob6 = 'bot')                  AS boty
          FROM ${DATASET} WHERE ${where(win, host, 'pageview')}`),
		// Unikalnych liczymy bez botów i bez pustych skrótów — kafelek ma mówić o ludziach.
		runQuery(`SELECT COUNT(DISTINCT blob8) AS unikalni
          FROM ${DATASET}
          WHERE ${where(win, host, 'pageview')} AND blob6 != 'bot' AND blob8 != ''`)
	]);

	const row = summary[0] ?? {};
	const pageviews = num(row.odslony);
	return {
		pageviews,
		visitors: num(unique[0]?.unikalni),
		avgResponseMs: Math.round(num(row.sredni_czas_ms)),
		errorShare: pageviews ? num(row.bledy) / pageviews : 0,
		botShare: pageviews ? num(row.boty) / pageviews : 0
	};
}

/**
 * Odsłony w czasie. Granulacja godzinowa dla doby, dzienna dla dłuższych
 * zakresów. Strefę podajemy `toStartOfInterval` wprost, więc doba zaczyna się
 * o północy warszawskiej także po zmianie czasu.
 */
export async function loadTimeline(
	win: Window,
	host: string | null,
	range: RangeKey
): Promise<{ label: string; value: number }[]> {
	const bucket = RANGES[range].bucket;
	const rows = await runQuery(
		`SELECT formatDateTime(
                  toStartOfInterval(timestamp, INTERVAL '1' ${bucket}, '${PANEL_TIMEZONE}'),
                  '${bucket === 'HOUR' ? '%d.%m %H:00' : '%d.%m'}',
                  '${PANEL_TIMEZONE}')     AS kubelek,
             toStartOfInterval(timestamp, INTERVAL '1' ${bucket}, '${PANEL_TIMEZONE}') AS sortowanie,
             SUM(_sample_interval)         AS odslony
       FROM ${DATASET} WHERE ${where(win, host, 'pageview')}
       GROUP BY kubelek, sortowanie ORDER BY sortowanie`
	);
	return rows.map((r) => ({ label: String(r.kubelek ?? ''), value: num(r.odslony) }));
}

/** Wspólny kształt tabel rankingowych: jedna kolumna wymiaru plus suma odsłon. */
async function loadTop(
	column: string,
	win: Window,
	host: string | null,
	extraFilter: string,
	emptyLabel: string
): Promise<TopRow[]> {
	const rows = await runQuery(
		`SELECT ${column} AS pozycja, SUM(_sample_interval) AS odslony
       FROM ${DATASET} WHERE ${where(win, host, 'pageview')}${extraFilter}
       GROUP BY pozycja ORDER BY odslony DESC LIMIT ${TOP_LIMIT}`
	);
	const total = rows.reduce((sum, r) => sum + num(r.odslony), 0);
	return rows.map((r) => {
		const label = String(r.pozycja ?? '').trim();
		const value = num(r.odslony);
		return { label: label || emptyLabel, value, share: total ? value / total : 0 };
	});
}

/**
 * Boty wykluczamy wszędzie poza tabelą urządzeń, gdzie ich udział jest właśnie
 * treścią. Tabela ścieżek dodatkowo odsiewa odpowiedzi z błędem — bez tego
 * skanery pytające o `/.env` lądują w top dziesięć obok oferty.
 */
const WITHOUT_BOTS = ` AND blob6 != 'bot'`;

/**
 * Wykluczenie ścieżek skanerów po stronie zapytania.
 *
 * Duplikuje to, co collector robi już przy zapisie, i jest tu celowo: wiersze
 * sprzed wdrożenia tamtego filtra mają klasę `desktop`, więc `blob6 != 'bot'`
 * ich nie odsiewa. Bez tego `/phpinfo.php` i kilkanaście wariantów `/.env`
 * siedziałyby w top stronach przez całe trzy miesiące retencji.
 */
const WITHOUT_PROBES = PROBE_PATH_PATTERNS.map((p) => ` AND blob2 NOT LIKE '${p}'`).join('');

export function loadTopPaths(win: Window, host: string | null) {
	return loadTop(
		'blob2',
		win,
		host,
		`${WITHOUT_BOTS} AND toUInt32(blob9) < 400${WITHOUT_PROBES}`,
		'(brak)'
	);
}

export function loadTopCountries(win: Window, host: string | null) {
	return loadTop('blob4', win, host, WITHOUT_BOTS, '(nieznany)');
}

export function loadTopReferrers(win: Window, host: string | null) {
	// Pusty referrer to wejście bezpośrednie — osobna, nazwana pozycja.
	return loadTop('blob5', win, host, WITHOUT_BOTS, 'wejścia bezpośrednie');
}

export function loadTopDevices(win: Window, host: string | null) {
	return loadTop('blob6', win, host, '', '(nieznane)');
}

export function loadTopBrowsers(win: Window, host: string | null) {
	return loadTop('blob7', win, host, WITHOUT_BOTS, '(nieznana)');
}

/**
 * Ruch z kampanii: wejścia, które faktycznie doszły na stronę.
 *
 * To trzeci licznik obok kliknięć krótkich linków i Bitly — mierzy co innego
 * niż tamte i różnica między nimi jest sama w sobie informacją.
 * Wiersze bez `utm_source` to ruch spoza kampanii i nie mają tu czego szukać.
 */
export async function loadCampaigns(
	win: Window,
	host: string | null
): Promise<{ source: string; medium: string; campaign: string; value: number }[]> {
	const rows = await runQuery(
		`SELECT blob10 AS zrodlo, blob11 AS medium, blob12 AS kampania,
             SUM(_sample_interval) AS wejscia
       FROM ${DATASET}
       WHERE ${where(win, host, 'pageview')}${WITHOUT_BOTS} AND blob10 != ''
       GROUP BY zrodlo, medium, kampania ORDER BY wejscia DESC LIMIT ${TOP_LIMIT}`
	);
	return rows.map((r) => ({
		source: String(r.zrodlo ?? ''),
		medium: String(r.medium ?? '') || '—',
		campaign: String(r.kampania ?? '') || '—',
		value: num(r.wejscia)
	}));
}

/**
 * Hosty, dla których w oknie są jakiekolwiek dane — do podpowiedzi w filtrze.
 *
 * Suma musi być na liście kolumn, mimo że jej nie używamy. Analytics Engine
 * odrzuca sortowanie po agregacie nieobecnym w SELECT błędem
 * `unable to find type of column: "_sample_interval"`.
 */
export async function loadActiveHosts(win: Window): Promise<string[]> {
	const rows = await runQuery(
		`SELECT blob1 AS host, SUM(_sample_interval) AS odslony
       FROM ${DATASET} WHERE ${where(win, null, 'pageview')}
       GROUP BY host ORDER BY odslony DESC`
	);
	return rows.map((r) => String(r.host ?? '')).filter(Boolean);
}
