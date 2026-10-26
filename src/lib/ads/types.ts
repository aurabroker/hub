/**
 * Kontrakt tygodniowego raportu Google Ads (kampania UD_2026, utratadochodu.pl).
 *
 * Raport wpycha skrypt Google Ads Scripts na POST /api/webhooks/ads-report,
 * co poniedziałek około 06:00, za poprzedni pełny tydzień (pon–ndz).
 * Kwoty są w złotych. Udziały (`ctr`, `search_is`, `lost_is_*`) to ułamki:
 * 0.25 znaczy 25%.
 *
 * Typy opisują to, co skrypt OBIECUJE wysłać. Walidacja na wejściu sprawdza
 * tylko pola, bez których raport nie ma sensu (okres, KPI, alerty) — reszta
 * może zniknąć przy zmianie skryptu, więc widok czyta wszystko ostrożnie.
 */

export type AlertLevel = 'KRYTYCZNE' | 'UWAGA' | 'INFO';
export type MatchType = 'EXACT' | 'PHRASE' | 'BROAD';
export type ChangeFlag = '' | 'REKOMENDACJA' | 'AUTO-REKOMENDACJA';

export interface AdsPeriod {
	start: string;
	end: string;
	prev_start: string;
	prev_end: string;
}

export interface AdsSettings {
	status: string;
	primary_status: string;
	primary_status_reasons: string;
	bidding_strategy: string;
	target_cpa: number | null;
	google_search: boolean;
	search_partners: boolean;
	content_network: boolean;
	daily_budget: number;
}

export interface AdsKpi {
	impressions: number;
	clicks: number;
	cost: number;
	conversions: number;
	other_networks_cost: number;
	ctr: number | null;
	cpc: number | null;
	cpa: number | null;
	search_is: number | null;
	lost_is_rank: number | null;
	lost_is_budget: number | null;
}

export interface AdsDaily {
	date: string;
	period: 'current' | 'previous';
	impressions: number;
	clicks: number;
	cost: number;
	conversions: number;
	other_networks_clicks: number;
	other_networks_cost: number;
}

export interface AdsConversion {
	date: string;
	conversion_action: string;
	conversions: number;
}

export interface AdsKeyword {
	ad_group: string;
	ad_group_status: string;
	keyword: string;
	match_type: MatchType;
	status: string;
	quality_score: number | null;
	impressions: number;
	clicks: number;
	cost: number;
	conversions: number;
	cpa: number | null;
}

export interface AdsSearchTerm {
	search_term: string;
	ad_group: string;
	impressions: number;
	clicks: number;
	cost: number;
	conversions: number;
}

export interface AdsChange {
	date_time: string;
	source: string;
	source_code: string;
	flag: ChangeFlag;
	resource: string;
	resource_code: string;
	operation: string;
	operation_code: string;
	object: string;
	details: string;
}

export interface AdsAlert {
	level: AlertLevel;
	code: string;
	message: string;
}

export interface AdsReport {
	campaign: string;
	script_version: string;
	generated_at: string;
	generated_local: string;
	period: AdsPeriod;
	settings: AdsSettings;
	kpi: { current: AdsKpi; previous: AdsKpi };
	daily: AdsDaily[];
	conversions: AdsConversion[];
	keywords: AdsKeyword[];
	search_terms: AdsSearchTerm[];
	changes: AdsChange[];
	alerts: AdsAlert[];
	markdown: string;
}

/**
 * Raport taki, jaki faktycznie leży w bazie: każde pole może nie istnieć.
 * Widok pracuje wyłącznie na tym typie, żeby kompilator pilnował ostrożnego
 * czytania.
 */
export interface StoredAdsReport {
	campaign?: string;
	script_version?: string;
	generated_at?: string;
	generated_local?: string;
	period?: Partial<AdsPeriod>;
	settings?: Partial<AdsSettings>;
	kpi?: { current?: Partial<AdsKpi>; previous?: Partial<AdsKpi> };
	daily?: Partial<AdsDaily>[];
	conversions?: Partial<AdsConversion>[];
	keywords?: Partial<AdsKeyword>[];
	search_terms?: Partial<AdsSearchTerm>[];
	changes?: Partial<AdsChange>[];
	alerts?: Partial<AdsAlert>[];
	markdown?: string;
}

/** Wpis archiwum: jeden zapisany tydzień, bez treści raportu. */
export interface AdsArchiveEntry {
	period_end: string;
	received_at: string | null;
	campaign: string | null;
}

/** Punkt trendu: KPI bieżącego tygodnia z jednego zapisanego raportu. */
export interface AdsTrendPoint {
	period_end: string;
	kpi: Partial<AdsKpi> | null;
}
