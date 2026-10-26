import { TREND_WEEKS, buildAdsView, pickWeek } from '$lib/ads/view';
import { supabaseAdsStore } from '$lib/server/adsReportsStore';
import { adminClient } from '$lib/server/supabase';
import type { PageServerLoad } from './$types';

/**
 * Zakładka „Google Ads": tygodniowe raporty kampanii UD_2026, które wpycha
 * skrypt Google Ads na /api/webhooks/ads-report.
 *
 * Tydzień czytamy z adresu (?tydzien=RRRR-MM-DD), więc widok da się zalinkować.
 * Load tylko pobiera dane — liczby, porównania i ocenę świeżości składa
 * `buildAdsView`, ten sam, którego używa test renderowania.
 */
export const load: PageServerLoad = async ({ url }) => {
	const requested = url.searchParams.get('tydzien');
	const now = new Date();

	try {
		const store = supabaseAdsStore(adminClient());
		const archive = await store.list();
		const { period, missing } = pickWeek(archive, requested);

		const [row, trend] = await Promise.all([
			period ? store.get(period) : Promise.resolve(null),
			archive.length > 0 ? store.trend(TREND_WEEKS) : Promise.resolve([])
		]);

		return buildAdsView({
			archive,
			period,
			missingWeek: missing,
			report: row?.payload ?? null,
			trend,
			now
		});
	} catch (e) {
		// Jak w analityce: powód awarii na stronie zamiast gołego błędu 500.
		return buildAdsView({
			archive: [],
			period: null,
			report: null,
			trend: [],
			now,
			error: `Nie udało się wczytać raportów Google Ads. ${e instanceof Error ? e.message : String(e)}`
		});
	}
};
