import { adminClient } from '$lib/server/supabase';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const db = adminClient();
	const [{ data: campaigns }, { data: messages }] = await Promise.all([
		db
			.from('email_campaigns')
			.select('*, email_categories ( code, name )')
			.order('created_at', { ascending: false }),
		db.from('email_messages').select('campaign_id, status').not('campaign_id', 'is', null)
	]);

	const counts = new Map<string, Record<string, number>>();
	for (const m of messages ?? []) {
		const key = m.campaign_id as string;
		const entry = counts.get(key) ?? {};
		entry[m.status as string] = (entry[m.status as string] ?? 0) + 1;
		counts.set(key, entry);
	}

	return {
		campaigns: (campaigns ?? []).map((c) => ({
			...c,
			counts: counts.get(c.id as string) ?? {}
		}))
	};
};
