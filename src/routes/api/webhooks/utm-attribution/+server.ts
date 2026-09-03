import { json, text } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { adminClient } from '$lib/server/supabase';
import { slugifyUtm } from '$lib/utm';
import type { RequestHandler } from './$types';

/**
 * Przyjmuje źródło pozyskania leada z landingów i zapisuje je w utm_attributions.
 *
 * ŚWIADOMIE bez CORS: endpoint wywołuje BACKEND landingu, nie przeglądarka.
 * Sekret wysłany z JavaScriptu w przeglądarce byłby jawny dla każdego, kto
 * otworzy podgląd źródła, a wtedy każdy mógłby zaśmiecić raport. Landing ma
 * przekazać parametry UTM do swojego backendu razem z formularzem, a backend
 * wywołuje ten endpoint.
 *
 * Trasa jest publiczna przez prefiks /api/webhooks/ w hooks.server.ts.
 */

interface AttributionPayload {
	email?: string;
	company_id?: number | string;
	lead_intake_id?: string;
	slug?: string;
	utm_source?: string;
	utm_medium?: string;
	utm_campaign?: string;
	utm_content?: string;
	utm_term?: string;
	landing_url?: string;
	referrer?: string;
	gclid?: string;
	fbclid?: string;
	first_seen_at?: string;
}

/** Porównanie odporne na pomiar czasu — sekret nie może wyciec bajt po bajcie. */
function secretMatches(provided: string | null, expected: string): boolean {
	if (!provided || provided.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < expected.length; i++) {
		diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
	}
	return diff === 0;
}

function clean(value: unknown, max = 500): string | null {
	const v = typeof value === 'string' ? value.trim() : '';
	return v ? v.slice(0, max) : null;
}

export const POST: RequestHandler = async ({ request }) => {
	const secret = (env.UTM_INGEST_SECRET ?? '').trim();
	if (!secret) return text('Endpoint nieskonfigurowany — brak UTM_INGEST_SECRET', { status: 503 });
	if (!secretMatches(request.headers.get('x-utm-secret'), secret)) {
		return text('Nieprawidłowy sekret', { status: 401 });
	}

	let payload: AttributionPayload;
	try {
		payload = (await request.json()) as AttributionPayload;
	} catch {
		return text('Nieprawidłowy JSON', { status: 400 });
	}

	const db = adminClient();
	const email = clean(payload.email, 320)?.toLowerCase() ?? null;

	// Slug krótkiego linku wiąże lead z konkretnym linkiem z biblioteki.
	let linkId: string | null = null;
	const slug = clean(payload.slug, 64);
	if (slug) {
		const { data: link } = await db.from('utm_links').select('id').eq('slug', slug).maybeSingle();
		linkId = (link?.id as string) ?? null;
	}

	// Gdy landing zna tylko adres e-mail, dopinamy lead do kontaktu w CRM.
	// Tabela CRM jest tylko czytana — struktura pozostaje nietknięta.
	let companyId = Number.parseInt(String(payload.company_id ?? ''), 10);
	if (!Number.isFinite(companyId) && email) {
		const { data: company } = await db
			.from('crm_companies')
			.select('id')
			.ilike('email', email)
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle();
		companyId = Number(company?.id ?? Number.NaN);
	}

	const { error } = await db.from('utm_attributions').insert({
		company_id: Number.isFinite(companyId) ? companyId : null,
		lead_intake_id: clean(payload.lead_intake_id, 64),
		email,
		link_id: linkId,
		// Normalizujemy tak samo jak przy generowaniu, inaczej „Facebook" z landingu
		// nie skleiłby się w raporcie z „facebook" z linku.
		utm_source: slugifyUtm(payload.utm_source) || null,
		utm_medium: slugifyUtm(payload.utm_medium) || null,
		utm_campaign: slugifyUtm(payload.utm_campaign) || null,
		utm_content: slugifyUtm(payload.utm_content) || null,
		utm_term: slugifyUtm(payload.utm_term) || null,
		landing_url: clean(payload.landing_url, 1000),
		referrer: clean(payload.referrer, 1000),
		gclid: clean(payload.gclid, 200),
		fbclid: clean(payload.fbclid, 200),
		first_seen_at: clean(payload.first_seen_at, 40)
	});

	if (error) return text(`Zapis nieudany: ${error.message}`, { status: 500 });
	return json({ ok: true });
};
