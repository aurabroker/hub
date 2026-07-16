import { adminClient } from '$lib/server/supabase';
import type { PageServerLoad } from './$types';
import type { CrmCompany } from '$lib/ud/types';

export const load: PageServerLoad = async () => {
	const db = adminClient();
	const res = await db
		.from('crm_companies')
		.select('*')
		.order('created_at', { ascending: false, nullsFirst: false });

	return {
		signups: (res.data ?? []) as CrmCompany[],
		error: res.error?.message ?? null
	};
};
