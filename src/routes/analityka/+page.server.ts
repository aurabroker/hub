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
	loadBrokenPaths,
	loadCampaigns,
	loadChannels,
	loadHeatmap,
	loadHostBreakdown,
	loadTimeline,
	loadTopBrowsers,
	loadTopCountries,
	loadTopDevices,
	loadTopPaths,
	loadTopReferrers,
	loadTotals,
	loadVitalPaths,
	loadVitals,
	windows,
	type Totals,
	type VitalPathRow,
	type VitalSummary
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

const EMPTY_TOTALS: Totals = {
	pageviews: 0,
	visitors: 0,
	avgResponseMs: 0,
	p75ResponseMs: 0,
	errorShare: 0,
	botShare: 0
};

export const load: PageServerLoad = async ({ url }) => {
	const rangeParam = url.searchParams.get('zakres');
	const range: RangeKey = isRangeKey(rangeParam) ? rangeParam : DEFAULT_RANGE;

	const hostParam = url.searchParams.get('host');
	const host = isMeasuredHost(hostParam) ? hostParam : null;

	const { current, previous } = windows(range);
	const base = { range, host, rangeLabel: RANGES[range].label, refreshedAt: new Date().toISOString() };

	try {
		const [
			totals,
			previousTotals,
			timeline,
			hostBreakdown,
			paths,
			channels,
			campaigns,
			broken,
			heatmap,
			countries,
			devices,
			browsers,
			referrers,
			vitals,
			vitalPaths
		] = await Promise.all([
			loadTotals(current, host),
			loadTotals(previous, host),
			loadTimeline(current, host, range),
			loadHostBreakdown(current),
			loadTopPaths(current, host),
			loadChannels(current, host),
			loadCampaigns(current, host),
			loadBrokenPaths(current, host),
			loadHeatmap(current, host),
			loadTopCountries(current, host),
			loadTopDevices(current, host),
			loadTopBrowsers(current, host),
			loadTopReferrers(current, host),
			loadVitals(current, host),
			// LCP jest wskaźnikiem, który najczęściej da się naprawić po stronie
			// strony (obrazek bohatera, font, blokujący skrypt), więc tabela
			// „gdzie boli" jest właśnie dla niego.
			loadVitalPaths(current, host, 'LCP')
		]);

		return {
			...base,
			// Do filtra pokazujemy tylko serwisy, na których w tym oknie coś się działo.
			hosts: MEASURED_HOSTS.filter((h) => hostBreakdown.some((r) => r.host === h)),
			totals,
			previousTotals,
			timeline,
			hostBreakdown,
			paths,
			channels,
			campaigns,
			broken,
			heatmap,
			countries,
			devices,
			browsers,
			referrers,
			vitals,
			vitalPaths,
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
			...base,
			hosts: [] as string[],
			totals: EMPTY_TOTALS,
			previousTotals: EMPTY_TOTALS,
			timeline: [] as { label: string; value: number }[],
			hostBreakdown: [],
			paths: [],
			channels: [],
			campaigns: [],
			broken: [],
			heatmap: [],
			countries: [],
			devices: [],
			browsers: [],
			referrers: [],
			vitals: [] as VitalSummary[],
			vitalPaths: [] as VitalPathRow[],
			error: message
		};
	}
};
