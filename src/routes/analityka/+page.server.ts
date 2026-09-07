import {
	DEFAULT_RANGE,
	MEASURED_HOSTS,
	RANGES,
	isMeasuredHost,
	isRangeKey,
	type RangeKey
} from '$lib/analytics';
import {
	AnalyticsConfigError,
	loadActiveHosts,
	loadCampaigns,
	loadTimeline,
	loadTopBrowsers,
	loadTopCountries,
	loadTopDevices,
	loadTopPaths,
	loadTopReferrers,
	loadTotals,
	windows
} from '$lib/server/analytics';
import type { PageServerLoad } from './$types';

/**
 * Panel własnej analityki. Wszystkie zapytania wykonuje serwer — token do
 * Analytics Engine nigdy nie trafia do przeglądarki, która dostaje gotowe liczby.
 *
 * Zakres i host czytamy z adresu, więc stan panelu da się zalinkować i odświeżyć.
 * Obie wartości przechodzą przez walidację wobec list zamkniętych: host trafia
 * wprost do zapytania SQL, więc dowolny ciąg z adresu byłby dziurą.
 */
export const load: PageServerLoad = async ({ url }) => {
	const rangeParam = url.searchParams.get('zakres');
	const range: RangeKey = isRangeKey(rangeParam) ? rangeParam : DEFAULT_RANGE;

	const hostParam = url.searchParams.get('host');
	const host = isMeasuredHost(hostParam) ? hostParam : null;

	const { current, previous } = windows(range);

	try {
		const [
			totals,
			previousTotals,
			timeline,
			paths,
			countries,
			referrers,
			devices,
			browsers,
			campaigns,
			activeHosts
		] = await Promise.all([
			loadTotals(current, host),
			loadTotals(previous, host),
			loadTimeline(current, host, range),
			loadTopPaths(current, host),
			loadTopCountries(current, host),
			loadTopReferrers(current, host),
			loadTopDevices(current, host),
			loadTopBrowsers(current, host),
			loadCampaigns(current, host),
			loadActiveHosts(current)
		]);

		return {
			range,
			host,
			rangeLabel: RANGES[range].label,
			hosts: MEASURED_HOSTS.filter((h) => activeHosts.includes(h)),
			refreshedAt: new Date().toISOString(),
			totals,
			previousTotals,
			timeline,
			paths,
			countries,
			referrers,
			devices,
			browsers,
			campaigns,
			error: null as string | null
		};
	} catch (e) {
		// Panel jest narzędziem roboczym: lepiej pokazać powód awarii na stronie
		// niż wysypać całą trasę błędem 500 bez wskazówki, co poprawić.
		const message =
			e instanceof AnalyticsConfigError
				? e.message
				: `Nie udało się pobrać danych z Analytics Engine. ${e instanceof Error ? e.message : String(e)}`;

		return {
			range,
			host,
			rangeLabel: RANGES[range].label,
			hosts: [] as string[],
			refreshedAt: new Date().toISOString(),
			totals: { pageviews: 0, visitors: 0, avgResponseMs: 0, errorShare: 0, botShare: 0 },
			previousTotals: { pageviews: 0, visitors: 0, avgResponseMs: 0, errorShare: 0, botShare: 0 },
			timeline: [] as { label: string; value: number }[],
			paths: [],
			countries: [],
			referrers: [],
			devices: [],
			browsers: [],
			campaigns: [],
			error: message
		};
	}
};
