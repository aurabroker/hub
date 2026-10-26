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
