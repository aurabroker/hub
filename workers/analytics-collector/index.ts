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
// Lista mierzonych hostów oraz definicje Core Web Vitals są wspólne z panelem —
// jedna definicja, zero drifty. Collector bierze stąd dozwolone nazwy
// wskaźników i górne granice wartości, panel te same progi do oceny.
import { MEASURED_HOSTS, VITALS, isVitalName, type VitalName } from '../../src/lib/analytics';
import { VITALS_SCRIPT } from './vitals-client';

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
 * Mierzone hosty jako zbiór, do szybkiego sprawdzenia przy każdym żądaniu.
 * Sama lista mieszka w `src/lib/analytics.ts`, wspólna z panelem.
 */
const MEASURED = new Set<string>(MEASURED_HOSTS);

/** Rozszerzenia, dla których nie zapisujemy odsłony — to zasoby, nie strony. */
const STATIC_EXTENSIONS =
	/\.(?:js|mjs|cjs|css|map|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|txt|xml)$/i;

/**
 * Ścieżki, o które pyta wyłącznie skaner podatności.
 *
 * Powód jest empiryczny: w pierwszych godzinach zbierania zobaczyliśmy
 * `/.env`, `/phpinfo.php`, `/dashboard/.env` i `/server-info.php` w top
 * stronach. Te żądania dostają od naszych serwisów odpowiedź 200, bo strony
 * nie zwracają 404 na nieznany adres, więc ani filtr po kodzie odpowiedzi, ani
 * rozpoznawanie po User-Agencie ich nie odsiewa — skanery podszywają się pod
 * Chrome na desktopie.
 *
 * Rozszerzenie `.php` jest tu jako całość, bo żaden z mierzonych serwisów nie
 * serwuje PHP: w danych `.php` pojawiło się wyłącznie w adresach typu
 * `/adminfuns.php` czy `/this_is_a_new_hello_world.php`. Gdyby któryś serwis
 * kiedyś stanął na WordPressie, ten fragment wzorca trzeba usunąć.
 *
 * Oznaczamy je jako bota, a nie pomijamy: udział automatów ma być widoczny.
 * Wersje z `%2e` i `%2f` są tu dlatego, że `URL.pathname` nie dekoduje
 * procentów, a skanery świadomie tak maskują adresy.
 */
const PROBE_PATTERN =
	/(?:^|\/|%2f)(?:\.|%2e)(?:env|git|aws|ssh|svn|hg|vscode|idea)\b|\.php\b|\.bak$|key\.json|service-account|credentials\.json|id_rsa|server-(?:info|status)|wp-config|wp-includes|wp-content|wp-json|setup-config\.php|\/vendor\/|\/actuator\b|\/telescope\b|\/cgi-bin\//i;

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
function isBot(cf: unknown, ua: string, pathname: string): boolean {
	// Adres, o który pyta tylko skaner, przesądza sprawę niezależnie od reszty.
	if (PROBE_PATTERN.test(pathname)) return true;
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
	if (!MEASURED.has(host)) return false;
	if (request.method !== 'GET') return false;
	if (url.pathname.startsWith('/api')) return false;
	// /.well-known/ to uzgodnienia między przeglądarką a serwerem, nie strony.
	if (url.pathname.startsWith('/.well-known/')) return false;
	if (STATIC_EXTENSIONS.test(url.pathname)) return false;
	return true;
}

/** Puste wartości utm_* dla zdarzeń, które nie pochodzą ze strony wejścia. */
const NO_UTM = ['', '', '', '', ''];

/**
 * Zapis jednego zdarzenia. Kolejność blobów musi odpowiadać stałej FIELDS —
 * SQL API zwraca kolumny bez nazw, więc pomyłka tutaj po cichu przestawia
 * wszystkie zapytania panelu. Dlatego zapis jest w jednym miejscu, wspólnym
 * dla odsłon i wskaźników z przeglądarki.
 */
function writeEvent(
	env: Env,
	event: {
		host: string;
		path: string;
		type: string;
		country: string;
		referrer: string;
		device: string;
		browser: string;
		visitor: string;
		detail: string;
		utm: string[];
		value: number;
	}
): void {
	env.WEB_EVENTS.writeDataPoint({
		indexes: [event.host],
		blobs: [
			event.host,
			event.path,
			event.type,
			event.country,
			event.referrer,
			event.device,
			event.browser,
			event.visitor,
			event.detail,
			...event.utm
		],
		doubles: [event.value]
	});
}

/** Kraj z Cloudflare. Puste, gdy nie ma go w żądaniu (np. wywołanie lokalne). */
function country(request: Request): string {
	return (request as { cf?: { country?: string } }).cf?.country ?? '';
}

/** Zapis odsłony. */
async function writePageview(
	request: Request,
	env: Env,
	url: URL,
	host: string,
	status: number,
	durationMs: number
): Promise<void> {
	const ua = request.headers.get('user-agent') ?? '';
	const bot = isBot(request.cf, ua, url.pathname);

	writeEvent(env, {
		host,
		path: normalizePath(url.pathname),
		type: 'pageview',
		country: country(request),
		referrer: referrerHost(request.headers.get('referer'), host),
		device: deviceClass(ua, bot),
		browser: browserFamily(ua),
		visitor: await visitorHash(request, env, host),
		detail: String(status),
		utm: utmValues(url),
		value: durationMs
	});
}

// --- Core Web Vitals -------------------------------------------------------

/** Adres, pod którym przeglądarka zgłasza wskaźniki. */
const VITALS_PATH = '/__vitals';

/** Adres skryptu mierzącego. Ta sama domena co strona — CSP `script-src 'self'` przepuszcza. */
const VITALS_SCRIPT_PATH = '/__vitals.js';

/** Górna granica zgłoszenia. Pięć wskaźników mieści się w ~150 bajtach. */
const MAX_VITALS_BODY = 2048;

/** Ile wskaźników przyjmujemy z jednego zgłoszenia. Wskaźników jest pięć. */
const MAX_VITALS_PER_REQUEST = 8;

/**
 * Prosty licznik częstotliwości, trzymany w pamięci izolatu.
 *
 * Endpoint jest publiczny, więc bez tego jeden skrypt w pętli dopisałby do
 * datasetu tyle wierszy, ile zdąży. Ograniczenie jest świadomie płytkie:
 * izolatów Workera jest wiele i każdy liczy osobno, więc realny limit jest
 * wielokrotnością tego poniżej. To zapora na przypadkową pętlę i pojedynczego
 * amatora, nie na rozproszony zalew — na tamto jest Rate Limiting w panelu
 * Cloudflare, jeśli kiedyś będzie potrzebny.
 */
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
const RATE_MAX_KEYS = 5000;
const rateCounters = new Map<string, { windowStart: number; count: number }>();

function overRateLimit(key: string): boolean {
	const now = Date.now();
	// Mapa nie ma szansy rosnąć w nieskończoność: po przekroczeniu rozmiaru
	// czyścimy ją w całości. Gubi to bieżące okna, co przy minutowym oknie
	// kosztuje najwyżej jedną minutę pobłażliwości.
	if (rateCounters.size > RATE_MAX_KEYS) rateCounters.clear();

	const entry = rateCounters.get(key);
	if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
		rateCounters.set(key, { windowStart: now, count: 1 });
		return false;
	}
	entry.count += 1;
	return entry.count > RATE_LIMIT;
}

/** Odpowiedź bez treści. Przeglądarka i tak jej nie czyta — sendBeacon jest ślepy. */
function noContent(status = 204): Response {
	return new Response(null, { status, headers: { 'cache-control': 'no-store' } });
}

/**
 * Czy zgłoszenie przyszło z mierzonej strony.
 *
 * Endpoint świadomie nie ma nagłówków CORS, ale samo ich pominięcie nie
 * wystarcza: `sendBeacon` z obcej domeny i tak wyśle żądanie, tylko odpowiedzi
 * nie przeczyta. Origin jest przy metodzie POST wysyłany zawsze, więc jego brak
 * albo obca wartość to powód do odrzucenia.
 */
function sameSiteOrigin(request: Request, host: string): boolean {
	const origin = request.headers.get('origin');
	if (!origin) return false;
	try {
		const url = new URL(origin);
		return url.protocol === 'https:' && normalizeHost(url.hostname) === host;
	} catch {
		return false;
	}
}

/** Wartości spoza zakresu to błąd skryptu albo próba zaśmiecenia danych. */
function validVitalValue(name: VitalName, value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= VITALS[name].max;
}

/**
 * Zgłoszenie Core Web Vitals z przeglądarki.
 *
 * Wejście publiczne, więc każde pole jest sprawdzane: metoda, Origin, rozmiar
 * ciała, liczba wskaźników, nazwy z zamkniętej listy i zakresy wartości.
 * Ścieżkę bierzemy ze zgłoszenia (przeglądarka wie, na której podstronie była),
 * ale normalizujemy ją tą samą funkcją co odsłony i nie przyjmujemy niczego,
 * co nie zaczyna się od ukośnika — query stringu tam z definicji nie ma.
 */
async function handleVitals(request: Request, env: Env, host: string): Promise<Response> {
	if (request.method !== 'POST') return noContent(405);
	if (!sameSiteOrigin(request, host)) return noContent(403);

	const declared = Number(request.headers.get('content-length') ?? 0);
	if (declared > MAX_VITALS_BODY) return noContent(413);

	const raw = await request.text();
	if (raw.length > MAX_VITALS_BODY) return noContent(413);

	let body: { p?: unknown; m?: unknown };
	try {
		body = JSON.parse(raw);
	} catch {
		return noContent(400);
	}

	const path = typeof body.p === 'string' && body.p.startsWith('/') ? body.p.split('?')[0] : null;
	if (!path || !Array.isArray(body.m) || body.m.length === 0) return noContent(400);

	const ua = request.headers.get('user-agent') ?? '';
	const bot = isBot(request.cf, ua, path);
	const visitor = await visitorHash(request, env, host);

	// Klucz limitu: skrót odwiedzającego, a przy jego braku sam adres IP —
	// który i tak nigdzie nie jest zapisywany, tylko trzymany w pamięci.
	if (overRateLimit(visitor || (request.headers.get('cf-connecting-ip') ?? 'brak'))) {
		return noContent(429);
	}

	const shared = {
		host,
		path: normalizePath(path),
		type: 'vital',
		country: country(request),
		referrer: '',
		device: deviceClass(ua, bot),
		browser: browserFamily(ua),
		visitor,
		utm: NO_UTM
	};

	for (const item of body.m.slice(0, MAX_VITALS_PER_REQUEST)) {
		if (!Array.isArray(item) || item.length !== 2) continue;
		const [name, value] = item as [unknown, unknown];
		if (typeof name !== 'string' || !isVitalName(name)) continue;
		if (!validVitalValue(name, value)) continue;
		writeEvent(env, { ...shared, detail: name, value });
	}

	return noContent();
}

/** Skrypt mierzący, serwowany z tej samej domeny co strona. */
function vitalsScript(): Response {
	return new Response(VITALS_SCRIPT, {
		headers: {
			'content-type': 'application/javascript; charset=utf-8',
			// Godzina: zmiana skryptu rozchodzi się po świecie w rozsądnym czasie,
			// a przeglądarka nie pobiera go przy każdej odsłonie.
			'cache-control': 'public, max-age=3600',
			'x-content-type-options': 'nosniff'
		}
	});
}

/**
 * Doklejenie znacznika skryptu do strony HTML.
 *
 * To jedyne miejsce, w którym Worker zmienia odpowiedź originu, i kosztuje
 * dokładnie jeden element `<script defer>` przed `</head>`. Alternatywą było
 * dopisanie tego znacznika ręcznie w ośmiu serwisach i pilnowanie, żeby nie
 * wypadł przy kolejnym przebudowaniu któregoś z nich.
 *
 * `HTMLRewriter` pracuje strumieniowo, więc nie buforuje strony w pamięci
 * i nie opóźnia pierwszego bajtu. Jeśli serwis ma politykę CSP wymagającą
 * nonce, skrypt zostanie zablokowany — zniknie wtedy pomiar wskaźników, ale
 * nie strona.
 */
function injectVitalsScript(response: Response): Response {
	const type = response.headers.get('content-type') ?? '';
	if (response.status !== 200 || !type.includes('text/html')) return response;

	return new HTMLRewriter()
		.on('head', {
			element(element) {
				element.append(`<script src="${VITALS_SCRIPT_PATH}" defer></script>`, { html: true });
			}
		})
		.transform(response);
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const host = normalizeHost(url.hostname);

		// Trasy analityki obsługujemy sami, bez ruszania originu. Tylko na
		// mierzonych hostach — na pozostałych `/__vitals` to zwykły adres strony.
		if (MEASURED.has(host)) {
			if (url.pathname === VITALS_PATH) return handleVitals(request, env, host);
			if (url.pathname === VITALS_SCRIPT_PATH) return vitalsScript();
		}

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

			// Strona HTML dostaje znacznik skryptu Web Vitals. Poza tym jednym
			// dopiskiem odpowiedź originu wraca nietknięta.
			return injectVitalsScript(response);
		}

		return response;
	}
};

// Stała FIELDS istnieje jako dokumentacja kontraktu; eksport trzyma ją przy życiu
// dla narzędzi i czyni ją importowalną z panelu, gdy przyjdzie mapować kolumny.
export { FIELDS };
