import type { SupabaseClient, User } from '@supabase/supabase-js';

declare global {
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
