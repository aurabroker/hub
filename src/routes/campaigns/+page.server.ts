import { queueHealth } from '$lib/server/sender';
import { adminClient, fetchAllRows } from '$lib/server/supabase';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const db = adminClient();
	// Statusy wszystkich wiadomości kampanijnych czytamy stronami: jedno zapytanie
	// ucinało się na 1000 wierszach (db_max_rows) i starsze kampanie pokazywały 0 wysłanych.
	const [{ data: campaigns }, messages, health] = await Promise.all([
		db
			.from('email_campaigns')
			.select('*, email_categories ( code, name )')
			.order('created_at', { ascending: false }),
		fetchAllRows<{ campaign_id: string; status: string }>(
			(from, to) =>
				db
					.from('email_messages')
					.select('campaign_id, status')
					.not('campaign_id', 'is', null)
					.order('id')
					.range(from, to),
			'email_messages (kampanie)'
		),
		queueHealth(db)
	]);

	const counts = new Map<string, Record<string, number>>();
	for (const m of messages) {
		const entry = counts.get(m.campaign_id) ?? {};
		entry[m.status] = (entry[m.status] ?? 0) + 1;
		counts.set(m.campaign_id, entry);
	}

	return {
		campaigns: (campaigns ?? []).map((c) => ({
			...c,
			counts: counts.get(c.id as string) ?? {}
		})),
		health
	};
};
