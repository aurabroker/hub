import { adminClient } from '$lib/server/supabase';
import type { PageServerLoad } from './$types';
import type { CrmClient } from '$lib/ud/types';

export const load: PageServerLoad = async () => {
	const db = adminClient();
	const res = await db
		.from('crm_clients')
		.select('*')
		.order('created_at', { ascending: false, nullsFirst: false });

	return {
		clients: (res.data ?? []) as CrmClient[],
		error: res.error?.message ?? null
	};
};
