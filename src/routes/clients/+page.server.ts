import { adminClient } from '$lib/server/supabase';
import type { PageServerLoad } from './$types';
import type { UdClient } from '$lib/ud/types';

export const load: PageServerLoad = async () => {
	const db = adminClient();
	const res = await db.from('ud_clients').select('*').order('created_at', { ascending: false });

	return {
		clients: (res.data ?? []) as UdClient[],
		error: res.error?.message ?? null
	};
};
