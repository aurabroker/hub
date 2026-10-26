import {
	DASH,
	formatChangePct,
	formatCount,
	formatDate,
	formatInt,
	formatLocalDateTime,
	formatMoney,
	formatPercent,
	formatPeriod,
	formatPp,
	formatShortDate,
	formatText,
	formatWarsawDateTime,
	formatYesNo,
	isIsoDate,
	shiftIsoDate,
	toNumber
} from './format';
import type { AdsArchiveEntry, AdsKpi, AdsTrendPoint, StoredAdsReport } from './types';

/**
 * Model widoku zakładki Google Ads.
 *
 * Całe formatowanie, porównania i ocena „czy skrypt żyje" są tutaj, w czystych
 * funkcjach — komponent dostaje gotowe teksty i tylko je układa. Dzięki temu
 * test renderuje stronę z tego samego modelu, który buduje `load`.
 */

/** Po ilu dniach bez raportu uznajemy, że skrypt przestał działać. */
export const STALE_AFTER_DAYS = 8;
/** Ile ostatnich tygodni pokazuje trend. */
export const TREND_WEEKS = 26;
/** Poniżej tylu tygodni wykres trendu nic nie mówi — zamiast niego komunikat. */
export const MIN_TREND_WEEKS = 3;

// ---------------------------------------------------------------------------
// Wybór tygodnia
// ---------------------------------------------------------------------------

/**
 * Tydzień do pokazania. Parametr z adresu przechodzi przez walidację daty
 * i musi istnieć w archiwum; inaczej pokazujemy najnowszy i mówimy o tym.
 */
export function pickWeek(
	archive: AdsArchiveEntry[],
	requested: string | null
): { period: string | null; missing: string | null } {
	const latest = archive[0]?.period_end ?? null;
	if (!requested) return { period: latest, missing: null };
	if (isIsoDate(requested) && archive.some((a) => a.period_end === requested)) {
		return { period: requested, missing: null };
	}
	return { period: latest, missing: requested.slice(0, 40) };
}

/** Nazwa pobieranego pliku: tylko bezpieczne znaki ASCII. */
export function markdownFilename(campaign: string | null | undefined, periodEnd: string): string {
	const safe = (campaign ?? '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
	const date = isIsoDate(periodEnd) ? periodEnd : 'raport';
	return `google-ads-${safe || 'kampania'}-${date}.md`;
}

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------

/** good — wzrost to dobra wiadomość; bad — zła; neutral — zależy od kontekstu. */
type Polarity = 'good' | 'bad' | 'neutral';
type Kind = 'count' | 'money' | 'fraction';

interface KpiSpec {
	key: keyof AdsKpi;
	label: string;
	kind: Kind;
	up: Polarity;
	tone: string;
}

/**
 * Osiem metryk w kolejności czytania. Koszt jest neutralny: więcej wydanych
 * pieniędzy jest dobre przy rosnących konwersjach i złe bez nich — kolor
 * wydałby wyrok, którego sama liczba nie uzasadnia.
 */
export const KPI_SPECS: KpiSpec[] = [
	{ key: 'clicks', label: 'Kliknięcia', kind: 'count', up: 'good', tone: 'var(--data-1)' },
	{ key: 'cost', label: 'Koszt', kind: 'money', up: 'neutral', tone: 'var(--data-4)' },
	{ key: 'conversions', label: 'Konwersje', kind: 'count', up: 'good', tone: 'var(--data-6)' },
	{ key: 'cpa', label: 'Koszt konwersji', kind: 'money', up: 'bad', tone: 'var(--data-3)' },
	{ key: 'ctr', label: 'CTR', kind: 'fraction', up: 'good', tone: 'var(--data-2)' },
	{ key: 'search_is', label: 'Udział w wyświetleniach', kind: 'fraction', up: 'good', tone: 'var(--data-1)' },
	{ key: 'lost_is_budget', label: 'Utrata udziału przez budżet', kind: 'fraction', up: 'bad', tone: 'var(--data-5)' },
	{ key: 'lost_is_rank', label: 'Utrata udziału przez pozycję', kind: 'fraction', up: 'bad', tone: 'var(--data-5)' }
];

export type ChangeTone = 'good' | 'bad' | 'neutral' | 'none';

export interface KpiView {
	key: string;
	label: string;
	value: string;
	previous: string;
	change: string;
	/** Kierunek zmiany: 1 wzrost, -1 spadek, 0 brak albo bez zmian. */
	direction: 1 | 0 | -1;
	/** Ocena zmiany — to ona nadaje kolor, nie sam kierunek. */
	tone: ChangeTone;
	color: string;
	spark: number[];
}

function formatValue(kind: Kind, value: unknown): string {
	if (kind === 'money') return formatMoney(value);
	if (kind === 'fraction') return formatPercent(value);
	return formatCount(value);
}

/**
 * Zmiana tydzień do tygodnia.
 *
 * Liczby i kwoty: zmiana względna w procentach; bez poprzedniej wartości
 * (null albo zero) nie ma od czego liczyć — półpauza zamiast „+∞%".
 * Udziały: różnica w punktach procentowych; zero tydzień wcześniej jest tu
 * zwykłą wartością (z 0% na 5% to +5 pp).
 */
export function kpiChange(
	kind: Kind,
	current: unknown,
	previous: unknown
): { text: string; direction: 1 | 0 | -1 } {
	const cur = toNumber(current);
	const prev = toNumber(previous);
	if (cur === null || prev === null) return { text: DASH, direction: 0 };

	if (kind === 'fraction') {
		const diff = cur - prev;
		const text = formatPp(diff);
		return { text, direction: Math.abs(diff) < 0.0005 ? 0 : diff > 0 ? 1 : -1 };
	}

	if (prev === 0) return { text: DASH, direction: 0 };
	const ratio = (cur - prev) / prev;
	return { text: formatChangePct(ratio), direction: Math.abs(ratio) < 0.0005 ? 0 : ratio > 0 ? 1 : -1 };
}

function changeTone(polarity: Polarity, direction: 1 | 0 | -1, text: string): ChangeTone {
	if (text === DASH) return 'none';
	if (direction === 0 || polarity === 'neutral') return 'neutral';
	const upIsGood = polarity === 'good';
	return (direction === 1) === upIsGood ? 'good' : 'bad';
}

export function buildKpis(
	current: Partial<AdsKpi> | undefined,
	previous: Partial<AdsKpi> | undefined,
	trend: AdsTrendPoint[]
): KpiView[] {
	return KPI_SPECS.map((spec) => {
		const cur = current?.[spec.key];
		const prev = previous?.[spec.key];
		const change = kpiChange(spec.kind, cur, prev);
		const spark = trend
			.map((t) => toNumber(t.kpi?.[spec.key]))
			.filter((v): v is number => v !== null);
		return {
			key: spec.key,
			label: spec.label,
			value: formatValue(spec.kind, cur),
			previous: formatValue(spec.kind, prev),
			change: change.text,
			direction: change.direction,
			tone: changeTone(spec.up, change.direction, change.text),
			color: spec.tone,
			// Sparkline z jednego punktu to kropka — rysujemy dopiero od dwóch.
			spark: spark.length >= 2 ? spark : []
		};
	});
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

export interface TrendSeries {
	key: string;
	title: string;
	unit: string;
	color: string;
	/** `display` to wartość po polsku do tooltipa („1 234,56 zł", „8,5"). */
	points: { label: string; title: string; value: number; display: string }[];
}

/**
 * Serie do wykresów trendu. Każda metryka ma własny wykres, bo skale są
 * nieporównywalne: kilkadziesiąt kliknięć i kilkaset złotych na jednej osi
 * spłaszczyłyby kliknięcia do kreski.
 *
 * Wartości zostają dokładne, a tekst do tooltipa przychodzi gotowy — wykres
 * sam pokazałby surową liczbę JS („8.5", „1234.56"). Etykiety osi formatuje
 * strona (`formatInt`), bo funkcja nie przejdzie z `load` do przeglądarki.
 */
export function buildTrend(trend: AdsTrendPoint[]): TrendSeries[] {
	const series = (
		key: keyof AdsKpi,
		title: string,
		unit: string,
		color: string,
		display: (n: number) => string
	): TrendSeries => ({
		key,
		title,
		unit,
		color,
		points: trend.flatMap((t) => {
			const v = toNumber(t.kpi?.[key]);
			// Tydzień bez wartości pomijamy, a nie rysujemy jako zero: koszt
			// konwersji bez konwersji nie wynosi 0 zł, tylko nie istnieje.
			if (v === null) return [];
			const start = shiftIsoDate(t.period_end, -6);
			return [
				{
					label: formatShortDate(t.period_end),
					title: start ? formatPeriod(start, t.period_end) : formatDate(t.period_end),
					value: v,
					display: display(v)
				}
			];
		})
	});

	return [
		series('clicks', 'Kliknięcia', 'tygodniowo', 'var(--data-1)', formatInt),
		series('cost', 'Koszt', 'zł tygodniowo', 'var(--data-4)', formatMoney),
		series('conversions', 'Konwersje', 'tygodniowo', 'var(--data-6)', formatCount),
		series('cpa', 'Koszt konwersji', 'zł', 'var(--data-3)', formatMoney)
	];
}

// ---------------------------------------------------------------------------
// Alerty
// ---------------------------------------------------------------------------

const LEVEL_ORDER: Record<string, number> = { KRYTYCZNE: 0, UWAGA: 1, INFO: 2 };

export interface AlertView {
	level: string;
	/** Klasa wyglądu: error / warning / info. */
	kind: 'error' | 'warning' | 'info';
	code: string;
	message: string;
}

/** Alerty od najpoważniejszego. Nieznany poziom ląduje na końcu jako INFO. */
export function buildAlerts(alerts: unknown): AlertView[] {
	if (!Array.isArray(alerts)) return [];
	return alerts
		.filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
		.map((a, i) => {
			const level = typeof a.level === 'string' ? a.level.trim().toUpperCase() : '';
			return {
				i,
				rank: LEVEL_ORDER[level] ?? 3,
				view: {
					level: level in LEVEL_ORDER ? level : 'INFO',
					kind: level === 'KRYTYCZNE' ? 'error' : level === 'UWAGA' ? 'warning' : 'info',
					code: formatText(a.code),
					message: formatText(a.message)
				} satisfies AlertView
			};
		})
		// Stabilnie: w obrębie poziomu kolejność ze skryptu.
		.sort((a, b) => a.rank - b.rank || a.i - b.i)
		.map((a) => a.view);
}

// ---------------------------------------------------------------------------
// Tabele
// ---------------------------------------------------------------------------

/** Tablica z raportu albo pusta — pole może zniknąć albo przyjść jako null. */
function rows(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value)
		? value.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
		: [];
}

const MATCH_TYPE_LABEL: Record<string, string> = {
	EXACT: 'ścisłe',
	PHRASE: 'do wyrażenia',
	BROAD: 'przybliżone'
};

export function matchTypeLabel(value: unknown): string {
	const key = typeof value === 'string' ? value.trim().toUpperCase() : '';
	return MATCH_TYPE_LABEL[key] ?? formatText(value);
}

/** Kolor plakietki statusu z Google Ads. Tekst zostaje oryginalnym kodem. */
export function statusBadge(value: unknown): 'success' | 'warning' | 'muted' {
	const key = typeof value === 'string' ? value.trim().toUpperCase() : '';
	if (key === 'ENABLED') return 'success';
	if (key === 'PAUSED') return 'warning';
	return 'muted';
}

/** Zmiany wprowadzone przez rekomendacje Google — to je trzeba przejrzeć. */
const RECOMMENDATION_FLAGS = new Set(['REKOMENDACJA', 'AUTO-REKOMENDACJA']);

function buildSettings(settings: unknown): { label: string; value: string; badge?: string }[] {
	if (typeof settings !== 'object' || settings === null) return [];
	const s = settings as Record<string, unknown>;
	const reasons = Array.isArray(s.primary_status_reasons)
		? s.primary_status_reasons.filter((r) => typeof r === 'string').join(', ')
		: s.primary_status_reasons;
	return [
		{ label: 'Status', value: formatText(s.status), badge: statusBadge(s.status) },
		{ label: 'Status główny', value: formatText(s.primary_status) },
		{ label: 'Powody statusu', value: formatText(reasons) },
		{ label: 'Strategia stawek', value: formatText(s.bidding_strategy) },
		{ label: 'Docelowy CPA', value: formatMoney(s.target_cpa) },
		{ label: 'Budżet dzienny', value: formatMoney(s.daily_budget) },
		{ label: 'Sieć wyszukiwania Google', value: formatYesNo(s.google_search) },
		{ label: 'Partnerzy wyszukiwania', value: formatYesNo(s.search_partners) },
		{ label: 'Sieć reklamowa', value: formatYesNo(s.content_network) }
	];
}

// ---------------------------------------------------------------------------
// Całość
// ---------------------------------------------------------------------------

export interface AdsViewInput {
	archive: AdsArchiveEntry[];
	/** Tydzień wybrany przez `pickWeek`. */
	period: string | null;
	/** Tydzień z adresu, którego nie ma w archiwum. */
	missingWeek?: string | null;
	report: StoredAdsReport | null;
	trend: AdsTrendPoint[];
	now: Date;
	error?: string | null;
}

/** Czy najnowszy raport jest starszy niż STALE_AFTER_DAYS. */
export function isStale(receivedAt: string | null | undefined, now: Date): boolean {
	const ts = receivedAt ? Date.parse(receivedAt) : Number.NaN;
	if (!Number.isFinite(ts)) return false;
	return now.getTime() - ts > STALE_AFTER_DAYS * 86_400_000;
}

export function buildAdsView(input: AdsViewInput) {
	const { archive, report, trend, now } = input;
	const latest = archive[0] ?? null;
	const r: StoredAdsReport = report ?? {};
	const period = r.period ?? {};

	const generated =
		typeof r.generated_local === 'string' && r.generated_local.trim()
			? r.generated_local.trim()
			: formatWarsawDateTime(r.generated_at);

	return {
		error: input.error ?? null,
		empty: archive.length === 0,
		missingWeek: input.missingWeek ?? null,

		// Ostrzeżenie dotyczy NAJNOWSZEGO raportu, nie oglądanego: przeglądanie
		// starego tygodnia nie znaczy, że skrypt przestał działać.
		stale:
			latest && isStale(latest.received_at, now)
				? {
						lastPeriod: formatDate(latest.period_end),
						lastReceived: formatWarsawDateTime(latest.received_at)
					}
				: null,

		weeks: archive.map((a) => {
			const start = shiftIsoDate(a.period_end, -6);
			return {
				value: a.period_end,
				label: start ? formatPeriod(start, a.period_end) : formatDate(a.period_end),
				selected: a.period_end === input.period
			};
		}),

		header: report
			? {
					campaign: formatText(r.campaign),
					period: formatPeriod(period.start, period.end ?? input.period),
					previousPeriod: formatPeriod(period.prev_start, period.prev_end),
					generated,
					scriptVersion: typeof r.script_version === 'string' ? r.script_version : ''
				}
			: null,

		downloadHref:
			report && input.period && typeof r.markdown === 'string' && r.markdown.trim()
				? `/google-ads/pobierz/${input.period}`
				: null,

		alerts: buildAlerts(r.alerts),
		// Sparkline kończy się na oglądanym tygodniu: jej końcowa kropka stoi
		// przy liczbie z karty, więc późniejsze tygodnie udawałyby historię,
		// która do tej liczby nie prowadzi.
		kpis: report
			? buildKpis(
					r.kpi?.current,
					r.kpi?.previous,
					input.period ? trend.filter((t) => t.period_end <= input.period!) : trend
				)
			: [],

		/** Wszystkie tygodnie w archiwum — trend pokazuje najwyżej TREND_WEEKS z nich. */
		savedWeeks: archive.length,
		trendWeeks: trend.length,
		trend: trend.length >= MIN_TREND_WEEKS ? buildTrend(trend) : [],

		settings: buildSettings(r.settings),

		conversions: rows(r.conversions).map((c) => ({
			date: formatDate(c.date),
			action: formatText(c.conversion_action),
			conversions: formatCount(c.conversions)
		})),

		keywords: rows(r.keywords).map((k) => ({
			keyword: formatText(k.keyword),
			adGroup: formatText(k.ad_group),
			matchType: matchTypeLabel(k.match_type),
			status: formatText(k.status),
			statusBadge: statusBadge(k.status),
			qualityScore: formatInt(k.quality_score),
			impressions: formatInt(k.impressions),
			clicks: formatInt(k.clicks),
			cost: formatMoney(k.cost),
			conversions: formatCount(k.conversions),
			cpa: formatMoney(k.cpa)
		})),

		searchTerms: rows(r.search_terms).map((t) => ({
			term: formatText(t.search_term),
			adGroup: formatText(t.ad_group),
			impressions: formatInt(t.impressions),
			clicks: formatInt(t.clicks),
			cost: formatMoney(t.cost),
			conversions: formatCount(t.conversions)
		})),

		changes: rows(r.changes).map((c) => {
			const flag = typeof c.flag === 'string' ? c.flag.trim().toUpperCase() : '';
			return {
				when: formatLocalDateTime(c.date_time),
				source: formatText(c.source),
				resource: formatText(c.resource),
				operation: formatText(c.operation),
				object: formatText(c.object),
				details: formatText(c.details),
				flag: RECOMMENDATION_FLAGS.has(flag) ? flag : '',
				recommended: RECOMMENDATION_FLAGS.has(flag)
			};
		})
	};
}

export type AdsView = ReturnType<typeof buildAdsView>;
