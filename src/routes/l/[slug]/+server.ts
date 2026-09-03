import { error, redirect } from '@sveltejs/kit';
import { adminClient } from '$lib/server/supabase';
import { recordClick } from '$lib/server/utm';
import type { RequestHandler } from './$types';

/**
 * Publiczne przekierowanie krótkiego linku: /l/{slug} → adres docelowy z UTM-ami.
 * Kliknięcie zapisujemy do utm_clicks; błąd zapisu nie może zablokować
 * przekierowania, bo dla użytkownika liczy się dotarcie na stronę.
 *
 * Linki archiwalne nadal działają — raz wydrukowana ulotka albo kod QR nie
 * przestaje istnieć, bo ktoś schował link w HUB.
 */
export const GET: RequestHandler = async ({ params, request, platform }) => {
	const db = adminClient();
	const { data: link } = await db
		.from('utm_links')
		.select('id, final_url')
		.eq('slug', params.slug)
		.maybeSingle();

	if (!link?.final_url) error(404, 'Nie znaleziono linku');

	// waitUntil pozwala odpowiedzieć przekierowaniem natychmiast, a zapis
	// kliknięcia dokończyć już po odesłaniu odpowiedzi.
	const write = recordClick(db, link.id as string, request).catch(() => undefined);
	const ctx = platform?.context as { waitUntil?: (p: Promise<unknown>) => void } | undefined;
	if (ctx?.waitUntil) ctx.waitUntil(write);
	else await write;

	redirect(302, link.final_url as string);
};
