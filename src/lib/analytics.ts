/**
 * Wspólne stałe modułu analityki: lista mierzonych hostów i zakresy czasu.
 *
 * Plik czytają dwie strony naraz — collector Worker
 * (`workers/analytics-collector/index.ts`) i panel `/analityka`. Dlatego nie ma
 * tu żadnych importów: wszystko, co tu wejdzie, musi działać zarówno w Workerze,
 * jak i w SvelteKit.
 */

/**
 * Mierzone hosty, w postaci bez prefiksu `www.`.
 *
 * Collector zapisuje zdarzenie wyłącznie dla tych adresów, a panel przyjmuje
 * tylko te wartości w filtrze hosta. Ruch spoza listy leci do originu
 * normalnie, tylko bez pomiaru — skanery odpytują zmyślone subdomeny, a host
 * jest naszym jedynym indeksem i ma mieć niską liczność.
 *
 * Dodanie serwisu wymaga wpisu tutaj, trasy w `wrangler.jsonc` i trasy
 * w panelu Cloudflare. Sama trasa nie wystarczy.
 */
export const MEASURED_HOSTS = [
	'utratadochodu.pl',
	'auraconsulting.pl',
	'cyber.auraconsulting.pl',
	'zarzad.auraconsulting.pl',
	'beautypolisa.eu',
	'rozwod.waw.pl',
	'grupowe.pro',
	'gwarancje.pro'
] as const;

export type MeasuredHost = (typeof MEASURED_HOSTS)[number];

/** Czy wartość z adresu jest jednym z mierzonych hostów. Broni SQL przed wstrzyknięciem. */
export function isMeasuredHost(value: string | null | undefined): value is MeasuredHost {
	return !!value && (MEASURED_HOSTS as readonly string[]).includes(value);
}

/** Wiersz tabeli rankingowej: etykieta, liczba odsłon i udział w sumie tabeli. */
export type TopRow = { label: string; value: number; share: number };

/**
 * Fragmenty ścieżek, o które pyta wyłącznie skaner podatności.
 *
 * Collector oznacza takie żądania jako bota już przy zapisie, więc dla nowych
 * danych ta lista jest zbędna. Potrzebna jest dla **historii**: Analytics Engine
 * tylko dopisuje, a wiersze zapisane przed wdrożeniem tamtego filtra mają
 * klasę `desktop` i inaczej siedziałyby w top stronach aż do końca retencji.
 *
 * Wzorce w składni SQL LIKE, gdzie `%` zastępuje dowolny ciąg.
 */
export const PROBE_PATH_PATTERNS = [
	'%/.env%',
	'%phpinfo%',
	'%service-account%',
	'%credentials.json%',
	'%/.git%',
	'%/.aws%',
	'%/.ssh%',
	'%/.npmrc%',
	'%id_rsa%',
	'%wp-config%',
	'%wp-includes%',
	'%wp-content%',
	'%wp-json%',
	'%/vendor/%',
	'%/actuator%',
	'%/telescope%',
	'%/cgi-bin/%',
	'%server-info%',
	'%server-status%',
	'%2eenv%',
	'%2egit%',
	// Uzgodnienia przeglądarki z serwerem, nie strony. Collector ich już nie
	// zapisuje, ale wiersze sprzed tamtej zmiany zostają do końca retencji.
	'%/.well-known/%',
	// Żaden z mierzonych serwisów nie serwuje PHP — każde .php to skaner.
	// Gdyby któryś kiedyś stanął na WordPressie, ten wzorzec trzeba usunąć.
	'%.php%',
	'%.bak',
	'%key.json%'
] as const;

/**
 * Kanał ruchu: jedno zdanie o tym, skąd naprawdę przyszedł odwiedzający.
 *
 * Sama lista hostów referrera jest za drobna, żeby coś z niej wyczytać —
 * `google.com` i `l.facebook.com` obok siebie nie mówią, czy ruch idzie
 * z wyszukiwarki czy z social mediów. Grupujemy więc do pięciu kategorii.
 *
 * Kolejność sprawdzania ma znaczenie. Asystenci AI idą pierwsi, bo ChatGPT
 * dokleja `utm_source=chatgpt.com` i inaczej wpadłby do kampanii.
 */
export const CHANNELS = [
	'Asystenci AI',
	'Wyszukiwarki',
	'Media społecznościowe',
	'Kampanie',
	'Polecenia',
	'Wejścia bezpośrednie'
] as const;

export type Channel = (typeof CHANNELS)[number];

export function trafficChannel(referrer: string, utmSource: string): Channel {
	const both = `${referrer} ${utmSource}`.toLowerCase();
	if (/chatgpt|openai|perplexity|claude\.ai|gemini|copilot|phind/.test(both)) return 'Asystenci AI';
	if (/google|bing|duckduckgo|yahoo|yandex|ecosia|brave|seznam/.test(both)) return 'Wyszukiwarki';
	if (/facebook|instagram|linkedin|lnkd\.in|t\.co|twitter|x\.com|tiktok|youtube|pinterest|reddit|wykop/.test(both))
		return 'Media społecznościowe';
	if (utmSource) return 'Kampanie';
	if (!referrer) return 'Wejścia bezpośrednie';
	return 'Polecenia';
}

/** Dni tygodnia w kolejności, w jakiej zwraca je `formatDateTime(..., '%w')`: 0 = niedziela. */
export const WEEKDAYS = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'] as const;

/** Strefa, w której panel pokazuje czas. Timestampy w bazie są w UTC. */
export const PANEL_TIMEZONE = 'Europe/Warsaw';

/**
 * Zakresy do wyboru w panelu.
 *
 * Okna są przesuwne (ostatnie N godzin), nie kalendarzowe. Dzięki temu
 * „poprzedni równy okres" do porównania procentowego jest dokładnie tej samej
 * długości i nie wpada w niepełną dobę.
 *
 * `3m` odpowiada retencji Analytics Engine — starszych danych po prostu nie ma,
 * dopóki nie powstanie archiwum D1.
 */
export const RANGES = {
	'24h': { label: '24 godziny', hours: 24, bucket: 'HOUR' },
	'7d': { label: '7 dni', hours: 24 * 7, bucket: 'DAY' },
	'30d': { label: '30 dni', hours: 24 * 30, bucket: 'DAY' },
	'3m': { label: '3 miesiące', hours: 24 * 90, bucket: 'DAY' }
} as const;

export type RangeKey = keyof typeof RANGES;

export const DEFAULT_RANGE: RangeKey = '7d';

/** Czy wartość z adresu jest znanym zakresem. */
export function isRangeKey(value: string | null | undefined): value is RangeKey {
	return !!value && Object.prototype.hasOwnProperty.call(RANGES, value);
}

// --- Core Web Vitals -------------------------------------------------------

/**
 * Wskaźniki mierzone w przeglądarce, z progami oceny.
 *
 * Plik czyta i panel, i collector: panel bierze stąd progi i etykiety,
 * collector — listę dozwolonych nazw i górne ograniczenia wartości, którymi
 * broni publicznego endpointu `/__vitals`. Jedna definicja, więc nie da się
 * przyjąć wskaźnika, którego panel nie umie pokazać.
 *
 * `good` i `poor` to progi 75. percentyla wg Core Web Vitals (web.dev).
 * Wartości poniżej `good` są dobre, powyżej `poor` złe, między nimi
 * „wymaga poprawy". PROGI SIĘ ZMIENIAJĄ — Google dodał INP w miejsce FID
 * w 2024 — więc przed podejmowaniem decyzji sprawdź je w źródle, zamiast
 * ufać tej tabeli. Stan wpisany 2026-09-10, nie zweryfikowany w tej sesji:
 * środowisko, w którym powstawał ten kod, nie miało dostępu do web.dev.
 *
 * `max` nie ma nic wspólnego z oceną. To granica sensu: zgłoszenie powyżej
 * niej jest błędem skryptu albo próbą zaśmiecenia danych i leci do kosza.
 */
export const VITALS = {
	LCP: {
		label: 'Największy element',
		description: 'kiedy widać główną treść',
		unit: 'ms',
		good: 2500,
		poor: 4000,
		max: 120_000
	},
	INP: {
		label: 'Reakcja na kliknięcie',
		description: 'ile strona zwleka z odpowiedzią',
		unit: 'ms',
		good: 200,
		poor: 500,
		max: 120_000
	},
	CLS: {
		label: 'Skakanie treści',
		description: 'czy tekst ucieka spod palca',
		unit: '',
		good: 0.1,
		poor: 0.25,
		max: 10
	},
	FCP: {
		label: 'Pierwsza treść',
		description: 'kiedy widać cokolwiek',
		unit: 'ms',
		good: 1800,
		poor: 3000,
		max: 120_000
	},
	TTFB: {
		label: 'Pierwszy bajt',
		description: 'zanim przeglądarka dostanie odpowiedź',
		unit: 'ms',
		good: 800,
		poor: 1800,
		max: 120_000
	}
} as const;

export type VitalName = keyof typeof VITALS;

/** Nazwy wskaźników w kolejności, w jakiej pokazuje je panel. */
export const VITAL_NAMES = Object.keys(VITALS) as VitalName[];

/** Czy nazwa ze zgłoszenia jest wskaźnikiem, który przyjmujemy. */
export function isVitalName(value: string | null | undefined): value is VitalName {
	return !!value && Object.prototype.hasOwnProperty.call(VITALS, value);
}

/** Ocena wartości wskaźnika. Nazwy odpowiadają zmiennym `--vital-*` w app.css. */
export type VitalRating = 'good' | 'mid' | 'poor';

export function vitalRating(name: VitalName, value: number): VitalRating {
	const spec = VITALS[name];
	if (value <= spec.good) return 'good';
	return value > spec.poor ? 'poor' : 'mid';
}

/**
 * Ile zgłoszeń wystarczy, żeby percentyl coś znaczył.
 *
 * 75. percentyl z trzech odsłon to najgorsza z trzech, a nie percentyl.
 * Poniżej tego progu panel pokazuje liczbę, ale zaznacza ją jako niepewną.
 */
export const VITAL_MIN_SAMPLES = 20;
