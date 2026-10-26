import { env } from '$env/dynamic/private';
import { handleAdsReportPost } from '$lib/server/adsReports';
import { supabaseAdsStore } from '$lib/server/adsReportsStore';
import { adminClient } from '$lib/server/supabase';
import type { RequestHandler } from './$types';

/**
 * Przyjmuje tygodniowy raport Google Ads ze skryptu Google Ads Scripts
 * (co poniedziałek, za poprzedni pełny tydzień) i zapisuje go w ads_reports.
 *
 * Trasa jest celowo cienka — cała logika (token, limit rozmiaru, walidacja,
 * zapis) siedzi w `handleAdsReportPost`, testowanej bez Supabase i bez `$env`.
 *
 * Trasa jest publiczna przez prefiks /api/webhooks/ w hooks.server.ts;
 * chroni ją token ADS_REPORT_TOKEN w nagłówku `Authorization: Bearer …`.
 *
 * Skrypt MUSI wysyłać `Content-Type: application/json` (w UrlFetchApp opcja
 * `contentType: 'application/json'`). Bez niej UrlFetchApp wysyła
 * application/x-www-form-urlencoded bez nagłówka Origin, a wbudowana ochrona
 * CSRF SvelteKita odrzuca takie żądanie odpowiedzią 403 „Cross-site POST form
 * submissions are forbidden" — zanim ta funkcja w ogóle się wykona (to samo
 * dla text/plain). Na serwerze deweloperskim ta kontrola nie działa, więc
 * lokalnie problemu nie widać. Nie wyłączamy `csrf.checkOrigin` dla całej
 * aplikacji: osłabiłoby to każdy formularz panelu, a SvelteKit nie ma
 * wyjątku dla pojedynczej trasy.
 */
export const POST: RequestHandler = async ({ request }) => {
	return handleAdsReportPost(request, {
		token: env.ADS_REPORT_TOKEN,
		// Magazyn tworzymy leniwie: bez tokenu albo z błędnym tokenem nie ma
		// po co budować klienta Supabase (a brak jego zmiennych dałby 500 zamiast 401).
		store: {
			upsert: (row) => supabaseAdsStore(adminClient()).upsert(row),
			list: () => supabaseAdsStore(adminClient()).list(),
			get: (period) => supabaseAdsStore(adminClient()).get(period),
			trend: (limit) => supabaseAdsStore(adminClient()).trend(limit)
		}
	});
};
