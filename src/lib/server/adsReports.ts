import { isIsoDate } from '$lib/ads/format';
import type { AdsArchiveEntry, AdsTrendPoint, StoredAdsReport } from '$lib/ads/types';

/**
 * Przyjmowanie i przechowywanie tygodniowych raportów Google Ads.
 *
 * Logika żyje tutaj, a nie w pliku trasy, i NIE importuje `$env` — dostaje
 * token i magazyn z zewnątrz. Dzięki temu da się ją przetestować w całości
 * na samym obiekcie `Request` i magazynie w pamięci, bez Supabase i bez
 * zmiennych środowiskowych.
 *
 * Implementacja magazynu na Supabase jest osobno, w `adsReportsStore.ts`,
 * bo ciągnie za sobą `adminClient()` i `$env`.
 */

/** Limit rozmiaru raportu. Tydzień z setką haseł to kilkadziesiąt kB. */
export const MAX_REPORT_BYTES = 1_048_576;

/** Wiersz tabeli public.ads_reports. */
export interface AdsReportRow {
	period_end: string;
	campaign: string | null;
	generated_at: string | null;
	received_at: string;
	payload: StoredAdsReport;
}

/**
 * Magazyn raportów. Interfejs zamiast bezpośrednich wywołań Supabase, żeby
 * testy podstawiały tablicę w pamięci.
 */
export interface AdsReportStore {
	/** Zapis albo nadpisanie tygodnia (klucz: period_end). Rzuca przy błędzie. */
	upsert(row: AdsReportRow): Promise<void>;
	/** Archiwum bez treści raportów, od najnowszego. */
	list(): Promise<AdsArchiveEntry[]>;
	/** Jeden tydzień z pełną treścią albo null. */
	get(periodEnd: string): Promise<AdsReportRow | null>;
	/** KPI bieżącego tygodnia z `limit` najnowszych raportów, od najstarszego. */
	trend(limit: number): Promise<AdsTrendPoint[]>;
}

// ---------------------------------------------------------------------------
// Odpowiedzi
// ---------------------------------------------------------------------------

function reply(status: number, body: Record<string, unknown>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
	});
}

function fail(status: number, error: string, details?: string[]): Response {
	return reply(status, details ? { ok: false, error, details } : { ok: false, error });
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

async function sha256(text: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/**
 * Porównanie tokenu odporne na pomiar czasu.
 *
 * Oba teksty najpierw idą przez SHA-256, a porównujemy skróty — zawsze po
 * 32 bajty. Bezpośrednie porównanie znak po znaku zdradzałoby długość tokenu
 * (wcześniejsze wyjście przy innej długości), a pętla XOR bez przerywania
 * nie zdradza, na którym bajcie wystąpiła różnica.
 */
export async function tokenMatches(provided: string | null, expected: string): Promise<boolean> {
	const [a, b] = await Promise.all([sha256(provided ?? ''), sha256(expected)]);
	let diff = provided ? 0 : 1;
	for (let i = 0; i < b.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

/** Token z `Authorization: Bearer …`, bez białych znaków na brzegach. */
function bearerToken(request: Request): string | null {
	const header = request.headers.get('authorization');
	const m = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
	return m?.[1].trim() || null;
}

// ---------------------------------------------------------------------------
// Treść
// ---------------------------------------------------------------------------

/**
 * Czyta ciało żądania z bieżącym licznikiem bajtów. Nagłówek Content-Length
 * sprawdzamy osobno, ale nie wystarcza: może go nie być (transfer kawałkami)
 * albo może kłamać. Zwraca null, gdy treść przekroczy limit — czytanie
 * przerywamy od razu, bez ładowania reszty do pamięci.
 */
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
	if (!request.body) return new Uint8Array(0);
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > max) {
			await reader.cancel().catch(() => {});
			return null;
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Sprawdza pola, bez których raportu nie da się zapisać ani pokazać.
 * Zbiera WSZYSTKIE błędy naraz — autor skryptu poprawia je jednym przebiegiem,
 * a nie po jednym na każde wysłanie.
 */
export function validateReport(payload: unknown): string[] {
	if (!isObject(payload)) return ['Treść raportu musi być obiektem JSON.'];
	const errors: string[] = [];

	const period = payload.period;
	const end = isObject(period) ? period.end : undefined;
	if (!isObject(period)) {
		errors.push('Brak obiektu period.');
	} else if (typeof end !== 'string' || end === '') {
		errors.push('Brak pola period.end (ostatni dzień okresu, RRRR-MM-DD).');
	} else if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) {
		errors.push(`Pole period.end musi mieć format RRRR-MM-DD (jest: „${end.slice(0, 40)}").`);
	} else if (!isIsoDate(end)) {
		errors.push(`Pole period.end nie jest prawdziwą datą: ${end}.`);
	}

	const kpi = payload.kpi;
	if (!isObject(kpi)) {
		errors.push('Brak obiektu kpi.');
	} else {
		if (!isObject(kpi.current)) errors.push('Brak obiektu kpi.current (KPI bieżącego tygodnia).');
		if (!isObject(kpi.previous)) errors.push('Brak obiektu kpi.previous (KPI tygodnia wcześniej).');
	}

	if (!Array.isArray(payload.alerts)) errors.push('Pole alerts musi być tablicą (może być pusta).');

	return errors;
}

/** Znacznik czasu tylko wtedy, gdy to prawdziwa data ISO; inaczej null. */
function isoTimestamp(value: unknown): string | null {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
	const ts = Date.parse(value);
	return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

// ---------------------------------------------------------------------------
// Obsługa POST
// ---------------------------------------------------------------------------

export interface AdsReportDeps {
	/** ADS_REPORT_TOKEN ze środowiska; pusty = endpoint wyłączony. */
	token: string | undefined | null;
	store: AdsReportStore;
	now?: () => Date;
}

/**
 * POST /api/webhooks/ads-report.
 *
 * Kolejność kontroli jest celowa: najpierw konfiguracja i token, dopiero
 * potem czytanie treści. Bez tokenu nikt nie zmusi serwera do wczytania
 * megabajta ani do parsowania JSON-a.
 */
export async function handleAdsReportPost(request: Request, deps: AdsReportDeps): Promise<Response> {
	const token = (deps.token ?? '').trim();
	if (!token) return fail(503, 'Endpoint nieskonfigurowany — brak ADS_REPORT_TOKEN');

	if (!(await tokenMatches(bearerToken(request), token))) {
		return fail(401, 'Brak lub nieprawidłowy token (Authorization: Bearer …)');
	}

	const declared = Number(request.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > MAX_REPORT_BYTES) {
		return fail(413, 'Raport większy niż 1 MB');
	}
	const bytes = await readCapped(request, MAX_REPORT_BYTES);
	if (!bytes) return fail(413, 'Raport większy niż 1 MB');

	let payload: unknown;
	try {
		payload = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return fail(400, 'Nieprawidłowy JSON');
	}

	const errors = validateReport(payload);
	if (errors.length > 0) return fail(400, 'Raport nie przeszedł walidacji', errors);

	const report = payload as StoredAdsReport & Record<string, unknown>;
	const periodEnd = report.period!.end as string;
	const campaign = typeof report.campaign === 'string' ? report.campaign.trim().slice(0, 200) : '';

	try {
		await deps.store.upsert({
			period_end: periodEnd,
			campaign: campaign || null,
			generated_at: isoTimestamp(report.generated_at),
			received_at: (deps.now?.() ?? new Date()).toISOString(),
			payload: report
		});
	} catch (e) {
		console.error('[ads-report] zapis nieudany', periodEnd, e instanceof Error ? e.message : e);
		return fail(500, 'Zapis raportu nieudany');
	}

	return reply(200, { ok: true, period_end: periodEnd });
}
