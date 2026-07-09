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
