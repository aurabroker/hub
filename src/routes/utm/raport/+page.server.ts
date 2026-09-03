import { adminClient } from '$lib/server/supabase';
import type { PageServerLoad } from './$types';

/**
 * Skuteczność kampanii. Kliknięcia sklejamy z dwóch źródeł, bo mamy dwie drogi
 * do strony: własne przekierowanie /l/ (liczone w utm_clicks) oraz krótkie
 * linki Bitly, które celują prosto w adres docelowy (liczone przez API Bitly,
 * pobierane akcją „Statystyki Bitly” w generatorze).
 */
export const load: PageServerLoad = async () => {
	const db = adminClient();

	const [{ data: rows }, { data: recent }, { count: attributionCount }] = await Promise.all([
		db.from('utm_campaign_performance').select('*').order('clicks_total', { ascending: false }).limit(200),
		db
			.from('utm_attributions')
			.select('id, email, company_id, utm_source, utm_medium, utm_campaign, landing_url, created_at')
			.order('created_at', { ascending: false })
			.limit(50),
		db.from('utm_attributions').select('id', { count: 'exact', head: true })
	]);

	const performance = rows ?? [];
	return {
		performance,
		recent: recent ?? [],
		totals: {
			campaigns: new Set(performance.map((r) => r.utm_campaign)).size,
			clicks: performance.reduce((sum, r) => sum + Number(r.clicks_total ?? 0), 0),
			leads: performance.reduce((sum, r) => sum + Number(r.leads ?? 0), 0),
			attributions: attributionCount ?? 0
		}
	};
};
