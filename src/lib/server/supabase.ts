import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

/**
 * Client z kluczem service role — wyłącznie po stronie serwera.
 * Omija RLS; dostęp do tras panelu pilnuje hooks.server.ts (admin only).
 */
export function adminClient(): SupabaseClient {
	// Akceptujemy też nazwę SERVICE_ROLE (tak bywa nazywany klucz w panelu Supabase)
	const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE;
	if (!serviceKey || !publicEnv.PUBLIC_SUPABASE_URL) {
		throw new Error(
			'Brak zmiennych środowiskowych: PUBLIC_SUPABASE_URL i/lub SUPABASE_SERVICE_ROLE_KEY (alias: SERVICE_ROLE). Dodaj je w Cloudflare Pages → Settings → Variables and Secrets i zrób redeploy.'
		);
	}
	return createClient(publicEnv.PUBLIC_SUPABASE_URL, serviceKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
}

/**
 * Rozmiar strony przy pobieraniu pełnych list.
 *
 * ⚠️ PostgREST w Supabase ma twardy limit `db_max_rows` — w tym projekcie
 * wynosi 1000. Zapytanie z `.limit(20000)` NIE zwraca błędu: dostaje status
 * 200 i po cichu przyciętą odpowiedź (nagłówek `Content-Range: 0-999/*`).
 * Dlatego pełnych list nigdy nie wolno czytać jednym dużym `.limit()` —
 * trzeba stronicować przez `.range()`.
 */
export const PAGE_SIZE = 1000;

/** Bezpiecznik: przerywa stronicowanie, gdyby zapytanie nie miało końca. */
const MAX_PAGES = 200;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Pobiera WSZYSTKIE wiersze zapytania, stronicując po PAGE_SIZE.
 *
 * `page` dostaje zakres i ma zwrócić gotowe zapytanie z `.range(from, to)`.
 * Zapytanie MUSI mieć deterministyczne sortowanie (np. `.order('id')`),
 * inaczej kolejne strony mogą się powtórzyć albo pominąć wiersze.
 *
 * Przykład:
 *   await fetchAllRows((from, to) =>
 *     db.from('crm_companies').select('*').order('id').range(from, to), 'crm_companies');
 */
export async function fetchAllRows<T>(
	page: (from: number, to: number) => PromiseLike<PageResult<T>>,
	label = 'zapytanie'
): Promise<T[]> {
	const all: T[] = [];
	for (let index = 0; index < MAX_PAGES; index++) {
		const from = index * PAGE_SIZE;
		const { data, error } = await page(from, from + PAGE_SIZE - 1);
		if (error) throw new Error(`${label}: ${error.message}`);
		const rows = data ?? [];
		all.push(...rows);
		// Niepełna strona = koniec danych.
		if (rows.length < PAGE_SIZE) return all;
	}
	throw new Error(`${label}: przekroczono ${MAX_PAGES} stron — przerwano dla bezpieczeństwa`);
}
