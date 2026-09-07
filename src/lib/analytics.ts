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
