import type { SupabaseClient, User } from '@supabase/supabase-js';

declare global {
	/** Wstrzykiwane przez Vite przy buildzie (vite.config.ts → define). */
	const __APP_VERSION__: string;
	const __APP_COMMIT__: string;
	const __APP_BUILT_AT__: string;

	namespace App {
		interface Locals {
			/** Client związany z sesją zalogowanego użytkownika (anon key + cookies). */
			supabase: SupabaseClient;
			user: User | null;
			isAdmin: boolean;
		}
	}
}

export {};
