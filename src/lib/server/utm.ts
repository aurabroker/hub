import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

/**
 * Warstwa serwerowa modułu UTM: zapis kliknięć własnego przekierowania
 * oraz integracja z Bitly (skracanie na żądanie + pobieranie liczników).
 */

const BITLY_API = 'https://api-ssl.bitly.com/v4';

/** Domyślny limit linków na miesiąc — plan Starter. Nadpisywalny zmienną. */
export const BITLY_DEFAULT_MONTHLY_LIMIT = 50;

export function bitlyMonthlyLimit(): number {
	const raw = Number.parseInt(String(env.BITLY_MONTHLY_LIMIT ?? ''), 10);
	return Number.isFinite(raw) && raw > 0 ? raw : BITLY_DEFAULT_MONTHLY_LIMIT;
}

export function bitlyConfigured(): boolean {
	return Boolean((env.BITLY_TOKEN ?? '').trim());
}

/**
 * Baza krótkich linków. Domyślnie bierzemy origin bieżącego żądania, żeby
 * moduł działał też na preview deploymentach bez dodatkowej konfiguracji.
 */
export function shortLinkBase(origin: string): string {
	return (publicEnv.PUBLIC_SHORT_LINK_BASE || origin || '').replace(/\/+$/, '');
}

/**
 * Skrót adresu IP. Solimy sekretem — bez soli hash adresu IPv4 jest odwracalny
 * atakiem słownikowym w kilka sekund, więc przy braku sekretu nie zapisujemy nic.
 */
export async function hashIp(ip: string | null): Promise<string | null> {
	const salt = (env.UTM_INGEST_SECRET ?? '').trim();
	if (!ip || !salt) return null;
	const bytes = new TextEncoder().encode(`${salt}:${ip}`);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Zapisuje kliknięcie krótkiego linku. Błąd zapisu nie może zablokować przekierowania. */
export async function recordClick(
	db: SupabaseClient,
	linkId: string,
	request: Request
): Promise<void> {
	const ip =
		request.headers.get('cf-connecting-ip') ??
		request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		null;

	await db.from('utm_clicks').insert({
		link_id: linkId,
		referer: request.headers.get('referer')?.slice(0, 500) ?? null,
		user_agent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
		ip_hash: await hashIp(ip),
		country: request.headers.get('cf-ipcountry') ?? null
	});
}

/** Ile linków skrócono w bieżącym miesiącu kalendarzowym. */
export async function bitlyUsageThisMonth(db: SupabaseClient): Promise<number> {
	const now = new Date();
	const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
	const { count } = await db
		.from('utm_links')
		.select('id', { count: 'exact', head: true })
		.not('bitly_id', 'is', null)
		.gte('bitly_shortened_at', from);
	return count ?? 0;
}

type BitlyShortenResult =
	| { ok: true; id: string; link: string }
	| { ok: false; error: string };

/** Skraca adres w Bitly. Link celuje prosto w adres docelowy (decyzja projektowa). */
export async function bitlyShorten(longUrl: string): Promise<BitlyShortenResult> {
	const token = (env.BITLY_TOKEN ?? '').trim();
	if (!token) {
		return { ok: false, error: 'Brak BITLY_TOKEN — ustaw zmienną albo wklej krótki link ręcznie' };
	}

	const body: Record<string, string> = { long_url: longUrl };
	const domain = (env.BITLY_DOMAIN ?? '').trim();
	if (domain) body.domain = domain;

	let response: Response;
	try {
		response = await fetch(`${BITLY_API}/shorten`, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	} catch (err) {
		return { ok: false, error: `Bitly nieosiągalne: ${(err as Error).message}` };
	}

	const payload = (await response.json().catch(() => null)) as
		| { id?: string; link?: string; message?: string; description?: string }
		| null;

	if (!response.ok || !payload?.id || !payload?.link) {
		return { ok: false, error: bitlyError(response.status, payload) };
	}
	return { ok: true, id: payload.id, link: payload.link };
}

/** Pobiera sumaryczną liczbę kliknięć krótkiego linku z API Bitly. */
export async function bitlyClicks(
	bitlyId: string
): Promise<{ ok: true; clicks: number } | { ok: false; error: string }> {
	const token = (env.BITLY_TOKEN ?? '').trim();
	if (!token) return { ok: false, error: 'Brak BITLY_TOKEN' };

	const url = `${BITLY_API}/bitlinks/${encodeURIComponent(bitlyId)}/clicks/summary?unit=day&units=-1`;
	let response: Response;
	try {
		response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
	} catch (err) {
		return { ok: false, error: `Bitly nieosiągalne: ${(err as Error).message}` };
	}

	const payload = (await response.json().catch(() => null)) as
		| { total_clicks?: number; message?: string; description?: string }
		| null;

	if (!response.ok || typeof payload?.total_clicks !== 'number') {
		return { ok: false, error: bitlyError(response.status, payload) };
	}
	return { ok: true, clicks: payload.total_clicks };
}

/**
 * Czytelny komunikat błędu. 403 na niższych planach oznacza zwykle brak
 * dostępu do API, a 422 wyczerpany limit linków — obie sytuacje operator
 * musi zobaczyć wprost, a nie jako „błąd 403".
 */
function bitlyError(
	status: number,
	payload: { message?: string; description?: string } | null
): string {
	const detail = payload?.description || payload?.message || '';
	if (status === 401) return 'Bitly odrzucił token (401) — sprawdź BITLY_TOKEN';
	if (status === 403) {
		return `Bitly odmówił dostępu (403) — Twój plan może nie obejmować API. ${detail}`.trim();
	}
	if (status === 429 || status === 422) {
		return `Bitly: limit wyczerpany lub adres odrzucony (${status}). ${detail}`.trim();
	}
	return `Bitly zwrócił błąd ${status}. ${detail}`.trim();
}
