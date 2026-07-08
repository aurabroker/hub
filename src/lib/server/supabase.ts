import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

/**
 * Client z kluczem service role — wyłącznie po stronie serwera.
 * Omija RLS; dostęp do tras panelu pilnuje hooks.server.ts (admin only).
 */
export function adminClient(): SupabaseClient {
	if (!env.SUPABASE_SERVICE_ROLE_KEY || !publicEnv.PUBLIC_SUPABASE_URL) {
		throw new Error('Brak PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY w środowisku');
	}
	return createClient(publicEnv.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
}
