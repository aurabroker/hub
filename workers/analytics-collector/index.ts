/**
 * Collector własnej analityki webowej Aura.
 *
 * Worker stoi przed mierzonymi hostami: przepuszcza żądanie do originu bez
 * modyfikacji odpowiedzi, mierzy czas odpowiedzi i zapisuje zdarzenie do
 * Analytics Engine. Zapis idzie przez ctx.waitUntil() w try/catch — użytkownik
 * nigdy nie czeka na pomiar, a awaria analityki nie ma prawa zepsuć strony.
 *
 * Bez ciasteczek, bez skryptu w przeglądarce i bez surowych adresów IP.
 * Z query stringu bierzemy wyłącznie pięć nazwanych parametrów utm_*,
 * reszta jest wyrzucana. Zasady i uzasadnienie: CLAUDE.md w katalogu głównym.
 */

// Ta sama funkcja normalizująca, której używa generator linków UTM w HUB.
// Import zamiast kopii: README ostrzega, że bliźniaki utm_slugify muszą dawać
// identyczny wynik, a trzecia niezależna implementacja to trzecia okazja do
// rozjechania się. `src/lib/utm.ts` nie ma importów, więc wchodzi do bundla czysto.
import { slugifyUtm, UTM_KEYS } from '../../src/lib/utm';

/**
 * Mapowanie pól Analytics Engine.
 *
 * KOLEJNOŚĆ JEST KONTRAKTEM. SQL API zwraca kolumny jako blob1, blob2, double1
 * — bez nazw. Zmiana kolejności po cichu wywraca wszystkie zapytania i panel.
 * Nowe pola dokładamy wyłącznie na końcu, nigdy w środku.
 *
 * Limity Analytics Engine (dokumentacja, stan na 2026-09): 20 blobów,
 * 20 doubles i 1 indeks na punkt danych, łącznie 16 kB blobów, indeks do
 * 96 bajtów, 250 punktów na wywołanie Workera, retencja 3 miesiące.
 */
const FIELDS = {
	index1: 'host — jedyny indeks, niska liczność',
	blob1: 'host',
	blob2: 'ścieżka bez query stringu, identyfikatory jako :id, max 256 znaków',
	blob3: "typ zdarzenia: 'pageview' | 'vital' | nazwa zdarzenia własnego",
	blob4: 'kraj z request.cf.country',
	blob5: 'host referrera, nigdy pełny adres. Puste = wejście bezpośrednie',
	blob6: "klasa urządzenia: 'mobile' | 'tablet' | 'desktop' | 'bot'",
	blob7: "rodzina przeglądarki: 'chrome' | 'safari' | 'firefox' | 'other'",
	blob8: 'skrót odwiedzającego (wariant B: sól rotowana co dobę)',
	blob9: "szczegół: kod odpowiedzi dla 'pageview', nazwa wskaźnika dla 'vital'",
	// Dołożone 2026-09-07, na końcu schematu — kolejność wcześniejszych pól bez zmian.
	blob10: 'utm_source (znormalizowany), puste gdy brak',
	blob11: 'utm_medium (znormalizowany)',
	blob12: 'utm_campaign (znormalizowany)',
	blob13: 'utm_content (znormalizowany)',
	blob14: 'utm_term (znormalizowany)',
	double1: 'wartość: czas odpowiedzi originu w ms albo wartość Web Vital'
} as const;

interface Env {
	WEB_EVENTS: AnalyticsEngineDataset;
	VISITOR_SALT: KVNamespace;
}

/** Maksymalna długość zapisywanej ścieżki. Dłuższe obcinamy. */
const MAX_PATH = 256;

/**
 * Mierzone hosty, w postaci bez prefiksu www.
 *
 * Zapisujemy zdarzenie wyłącznie dla tych adresów. Ruch spoza listy leci do
 * originu normalnie, tylko bez pomiaru — skanery odpytują zmyślone subdomeny
 * (`910nefpaernhcrd2.auraconsulting.pl` i podobne), a host jest naszym jedynym
 * indeksem i ma mieć niską liczność. Bez tej listy indeks rósłby o każdą
 * nazwę, jaką wymyśli bot.
 *
 * Dodanie nowego serwisu wymaga wpisu tutaj ORAZ trasy w panelu Cloudflare.
 * Sama trasa nie wystarczy — świadomy koszt tej osłony.
 */
const MEASURED_HOSTS = new Set([
	'utratadochodu.pl',
	'auraconsulting.pl',
	'cyber.auraconsulting.pl',
	'zarzad.auraconsulting.pl',
	'beautypolisa.eu',
	'rozwod.waw.pl',
	'grupowe.pro',
	'gwarancje.pro'
]);

/** Rozszerzenia, dla których nie zapisujemy odsłony — to zasoby, nie strony. */
const STATIC_EXTENSIONS =
	/\.(?:js|mjs|cjs|css|map|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|txt|xml)$/i;

/**
 * Awaryjne rozpoznawanie botów po User-Agencie. Używane, gdy
 * request.cf.botManagement nie jest dostępny — a nie jest na planie Free,
 * bo Bot Management to funkcja płatna. Na naszych strefach to jest ścieżka
 * podstawowa, nie awaryjna.
 */
const BOT_PATTERN =
	/bot|crawl|spider|slurp|facebookexternalhit|embedly|quora link preview|whatsapp|telegram|discord|preview|scraper|curl|wget|python-requests|headless|lighthouse|pingdom|uptime|monitor|semrush|ahrefs|mj12|dotbot|petal|bytespider|gptbot|claudebot|ccbot|perplexity/i;

/** Data w strefie Europe/Warsaw jako YYYY-MM-DD — klucz dobowej soli. */
const WARSAW_DAY = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'Europe/Warsaw',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

/**
 * Sól bieżącej doby, trzymana w pamięci izolatu. Bez tego każde żądanie
 * biłoby w KV; przy odczycie z KV liczy się nie koszt, tylko liczba operacji.
 */
let cachedSalt: { day: string; salt: string } | null = null;

/**
 * Host bez prefiksu www — inaczej `example.pl` i `www.example.pl` rozjeżdżają
 * statystyki na dwie pozycje mówiące o tej samej stronie.
 */
function normalizeHost(hostname: string): string {
	return hostname.toLowerCase().replace(/^www\./, '');
}

/**
 * Czy segment ścieżki wygląda na identyfikator. Konserwatywnie: liczby, UUID,
 * długi ciąg szesnastkowy albo długi token z cyfrą. Slug typu
 * `ubezpieczenie-d-and-o` ma zostać slugiem.
 *
 * Wyjątek na liczby z dat: adresy blogowe `/2026/09/tytul` są powszechne
 * i bez tego wyjątku zamieniałyby się w bezużyteczne `/:id/:id/tytul`.
 * Dlatego rok (cztery cyfry w zakresie 1900–2100) oraz jedno- i dwucyfrowe
 * segmenty (miesiąc, dzień, numer strony) zostają takie, jakie są.
 */
function looksLikeId(segment: string): boolean {
	if (/^\d+$/.test(segment)) {
		if (segment.length <= 2) return false;
		const year = Number(segment);
		if (segment.length === 4 && year >= 1900 && year <= 2100) return false;
		return true;
	}
	if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return true;
	if (/^[0-9a-f]{16,}$/i.test(segment)) return true;
	if (segment.length >= 20 && /\d/.test(segment) && !segment.includes('-')) return true;
	return false;
}

/**
 * Ścieżka bez query stringu, z identyfikatorami zamienionymi na :id.
 * Bez tej normalizacji lista top stron rozjeżdża się po tygodniu na tysiące
 * wpisów typu /zamowienie/48213 i przestaje cokolwiek mówić.
 */
function normalizePath(pathname: string): string {
	const normalized = pathname
		.split('/')
		.map((segment) => (looksLikeId(segment) ? ':id' : segment))
		.join('/');
	return normalized.length > MAX_PATH ? normalized.slice(0, MAX_PATH) : normalized;
}

/**
 * Sam host referrera. Pełny adres strony, z której ktoś przyszedł, potrafi
 * zawierać zapytanie wyszukiwarki albo identyfikator sesji.
 * Puste = wejście bezpośrednie.
 */
function referrerHost(referer: string | null, selfHost: string): string {
	if (!referer) return '';
	try {
		const host = normalizeHost(new URL(referer).hostname);
		// Przejście między podstronami tej samej witryny to nie jest źródło ruchu.
		return host === selfHost ? '' : host;
	} catch {
		return '';
	}
}

/** Rodzina przeglądarki. Pełnego User-Agenta nie zapisujemy — to element odcisku. */
function browserFamily(ua: string): string {
	if (/edg\//i.test(ua)) return 'other';
	if (/opr\/|opera/i.test(ua)) return 'other';
	if (/firefox\/|fxios/i.test(ua)) return 'firefox';
	if (/chrome\/|crios|chromium/i.test(ua)) return 'chrome';
	if (/safari\//i.test(ua)) return 'safari';
	return 'other';
}

/**
 * Czy żądanie pochodzi od bota. Najpierw wynik Bot Management, jeśli jest
 * dostępny; w przeciwnym razie lista wzorców User-Agenta.
 * W skali Cloudflare 1 oznacza pewnego bota, 99 pewnego człowieka.
 */
function isBot(cf: unknown, ua: string): boolean {
	const score = (cf as { botManagement?: { score?: number } } | undefined)?.botManagement?.score;
	if (typeof score === 'number') return score <= 30;
	return BOT_PATTERN.test(ua);
}

/** Klasa urządzenia. Boty zapisujemy osobno — chcemy widzieć ich udział, nie ukrywać go. */
function deviceClass(ua: string, bot: boolean): string {
	if (bot) return 'bot';
	if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua)) return 'tablet';
	if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(ua)) return 'mobile';
	return 'desktop';
}

/**
 * Losowa sól na bieżącą dobę, trzymana w KV pod kluczem daty warszawskiej.
 * Wygasa po 48 godzinach, więc wczorajszej soli fizycznie nie ma — a bez niej
 * nie da się zestawić wczorajszych skrótów z dzisiejszymi.
 *
 * KV jest spójne dopiero z czasem: przy pierwszych żądaniach doby dwa
 * równoległe wywołania mogą wylosować różne sole i ta sama osoba policzy się
 * dwa razy. Dotyczy to kilku pierwszych żądań po północy i świadomie na to
 * przystajemy — alternatywą byłby zamek rozproszony dla metryki poglądowej.
 */
async function dailySalt(env: Env): Promise<string> {
	const day = WARSAW_DAY.format(new Date());
	if (cachedSalt?.day === day) return cachedSalt.salt;

	const key = `salt:${day}`;
	let salt = await env.VISITOR_SALT.get(key);
	if (!salt) {
		const bytes = crypto.getRandomValues(new Uint8Array(32));
		salt = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
		// 48 godzin: sól przeżywa całą swoją dobę z zapasem i znika sama.
		await env.VISITOR_SALT.put(key, salt, { expirationTtl: 60 * 60 * 48 });
	}

	cachedSalt = { day, salt };
	return salt;
}

/**
 * Skrót odwiedzającego, wariant B z CLAUDE.md.
 *
 * Surowy adres IP jest wyłącznie wejściem do funkcji skrótu i nigdy nie
 * opuszcza pamięci. Sól jest konieczna: adresów IPv4 są cztery miliardy,
 * więc niesolony skrót odwraca się przez wyliczenie wszystkich możliwości.
 */
async function visitorHash(request: Request, env: Env, host: string): Promise<string> {
	const ip = request.headers.get('cf-connecting-ip') ?? '';
	if (!ip) return '';

	const salt = await dailySalt(env);
	const material = [ip, request.headers.get('user-agent') ?? '', host, WARSAW_DAY.format(new Date()), salt].join('|');
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
	// 16 bajtów wystarcza: kolizje są tu bez znaczenia, a blob jest o połowę krótszy.
	return [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Maksymalna długość zapisywanej wartości utm_*. Ucina literówki-potwory. */
const MAX_UTM = 64;

/**
 * Pięć parametrów utm_* z adresu, w kolejności z UTM_KEYS.
 *
 * To jedyny wyjątek od zasady „nie zapisujemy query stringów" i jest wąski
 * z premedytacją: bierzemy wartości spod pięciu znanych nazw, nigdy całego
 * query stringu. Świadomie pomijamy gclid i fbclid — to identyfikatory
 * reklamowe, czyli dokładnie ta klasa danych, której tu unikamy.
 *
 * Wartości normalizujemy tą samą funkcją co generator linków w HUB, żeby
 * `Wiosna 2026` i `wiosna-2026` były w panelu jedną kampanią, a nie dwiema.
 *
 * Parametry są tylko w pierwszym żądaniu. Bez ciasteczka nie przeniesiemy ich
 * na kolejne podstrony, więc mierzymy strony wejścia z kampanii, nie całą
 * ścieżkę odwiedzającego.
 */
function utmValues(url: URL): string[] {
	return UTM_KEYS.map((key) => slugifyUtm(url.searchParams.get(key)).slice(0, MAX_UTM));
}

/** Czy dla tego żądania w ogóle zapisujemy odsłonę. */
function shouldMeasure(request: Request, url: URL, host: string): boolean {
	if (!MEASURED_HOSTS.has(host)) return false;
	if (request.method !== 'GET') return false;
	if (url.pathname.startsWith('/api')) return false;
	if (STATIC_EXTENSIONS.test(url.pathname)) return false;
	return true;
}

/** Zapis jednego zdarzenia. Kolejność pól musi odpowiadać stałej FIELDS. */
async function writePageview(
	request: Request,
	env: Env,
	url: URL,
	host: string,
	status: number,
	durationMs: number
): Promise<void> {
	const ua = request.headers.get('user-agent') ?? '';
	const bot = isBot(request.cf, ua);

	env.WEB_EVENTS.writeDataPoint({
		indexes: [host],
		blobs: [
			host,
			normalizePath(url.pathname),
			'pageview',
			((request as { cf?: { country?: string } }).cf?.country) ?? '',
			referrerHost(request.headers.get('referer'), host),
			deviceClass(ua, bot),
			browserFamily(ua),
			await visitorHash(request, env, host),
			String(status),
			...utmValues(url)
		],
		doubles: [durationMs]
	});
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const host = normalizeHost(url.hostname);

		const started = Date.now();
		const response = await fetch(request);
		const durationMs = Date.now() - started;

		if (shouldMeasure(request, url, host)) {
			// waitUntil + try/catch: odpowiedź wraca do użytkownika natychmiast,
			// a każdy błąd pomiaru przełykamy po cichu. Awaria analityki nie ma
			// prawa zamienić się w błąd widoczny dla odwiedzającego.
			ctx.waitUntil(
				(async () => {
					try {
						await writePageview(request, env, url, host, response.status, durationMs);
					} catch (e) {
						// Log trafia do `wrangler tail`; cisza w tym miejscu ukrywałaby awarie zapisu.
						console.error(`analytics: ${e instanceof Error ? e.message : String(e)}`);
					}
				})()
			);
		}

		// Odpowiedź originu wraca nietknięta — Worker niczego w niej nie zmienia.
		return response;
	}
};

// Stała FIELDS istnieje jako dokumentacja kontraktu; eksport trzyma ją przy życiu
// dla narzędzi i czyni ją importowalną z panelu, gdy przyjdzie mapować kolumny.
export { FIELDS };
