import { error } from '@sveltejs/kit';
import { isIsoDate } from '$lib/ads/format';
import { markdownFilename } from '$lib/ads/view';
import { supabaseAdsStore } from '$lib/server/adsReportsStore';
import { adminClient } from '$lib/server/supabase';
import type { RequestHandler } from './$types';

/**
 * Pobranie raportu tygodniowego w Markdownie, tak jak go wygenerował skrypt.
 *
 * Markdown idzie WYŁĄCZNIE jako plik do pobrania, nigdy jako HTML na stronie:
 * zawiera wyszukiwane hasła, czyli tekst wpisany przez dowolnego użytkownika
 * Google, a wyrenderowany przez {@html} byłby gotową dziurą XSS.
 *
 * Trasa jest za bramką administratora (hooks.server.ts), jak cały panel.
 */
export const GET: RequestHandler = async ({ params }) => {
	if (!isIsoDate(params.period)) error(404, 'Nie ma takiego tygodnia');

	const row = await supabaseAdsStore(adminClient()).get(params.period);
	const markdown = row?.payload?.markdown;
	if (typeof markdown !== 'string' || !markdown.trim()) {
		error(404, 'Raport za ten tydzień nie ma wersji Markdown');
	}

	const filename = markdownFilename(row?.campaign ?? row?.payload?.campaign, params.period);

	return new Response(markdown, {
		headers: {
			'Content-Type': 'text/markdown; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
