import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdsArchiveEntry, AdsTrendPoint } from '$lib/ads/types';
import type { AdsReportRow, AdsReportStore } from './adsReports';
import { fetchAllRows } from './supabase';

/**
 * Magazyn raportów Google Ads na tabeli public.ads_reports.
 *
 * Klient przychodzi z zewnątrz — w praktyce `adminClient()` z kluczem service
 * role, bo tabela ma RLS tylko do odczytu dla administratorów, a zapis idzie
 * z webhooka bez sesji użytkownika.
 */
export function supabaseAdsStore(db: SupabaseClient): AdsReportStore {
	return {
		async upsert(row) {
			// onConflict: ponowne wysłanie tego samego tygodnia nadpisuje wiersz.
			const { error } = await db.from('ads_reports').upsert(row, { onConflict: 'period_end' });
			if (error) throw new Error(error.message);
		},

		async list() {
			// Pełna lista przez stronicowanie — PostgREST po cichu tnie do 1000 wierszy.
			return fetchAllRows<AdsArchiveEntry>(
				(from, to) =>
					db
						.from('ads_reports')
						.select('period_end, received_at, campaign')
						.order('period_end', { ascending: false })
						.range(from, to),
				'ads_reports'
			);
		},

		async get(periodEnd) {
			const { data, error } = await db
				.from('ads_reports')
				.select('period_end, campaign, generated_at, received_at, payload')
				.eq('period_end', periodEnd)
				.maybeSingle();
			if (error) throw new Error(`ads_reports: ${error.message}`);
			return (data as AdsReportRow | null) ?? null;
		},

		async trend(limit) {
			// Tylko KPI bieżącego tygodnia, nie cały raport — 26 tygodni po
			// kilkadziesiąt kB to niepotrzebny megabajt na każde otwarcie zakładki.
			const { data, error } = await db
				.from('ads_reports')
				.select('period_end, kpi:payload->kpi->current')
				.order('period_end', { ascending: false })
				.limit(limit);
			if (error) throw new Error(`ads_reports (trend): ${error.message}`);
			return ((data ?? []) as unknown as AdsTrendPoint[]).slice().reverse();
		}
	};
}
