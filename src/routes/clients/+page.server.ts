import { adminClient } from '$lib/server/supabase';
import type { PageServerLoad } from './$types';
import type { CrmCompany } from '$lib/ud/types';

export interface ClientSendStat {
	/** Ile maili realnie wyszło (sent_at ustawione). */
	sent: number;
	/** Ile z wysłanych zostało otwartych. */
	opened: number;
	/** Data ostatniej wysyłki (ISO) lub null. */
	lastSentAt: string | null;
}

export const load: PageServerLoad = async () => {
	const db = adminClient();

	const [clientsRes, statsRes] = await Promise.all([
		db
			.from('crm_companies')
			.select('*')
			.order('created_at', { ascending: false, nullsFirst: false }),
		db
			.from('email_messages')
			.select('company_id, sent_at, opened_at')
			.not('company_id', 'is', null)
			.not('sent_at', 'is', null)
			.limit(100000)
	]);

	// Agregacja wysyłek per Klient (company_id) — jeden przebieg po wierszach.
	const sendStats: Record<number, ClientSendStat> = {};
	for (const row of statsRes.data ?? []) {
		const cid = row.company_id as number;
		const stat = (sendStats[cid] ??= { sent: 0, opened: 0, lastSentAt: null });
		stat.sent++;
		if (row.opened_at) stat.opened++;
		const sentAt = row.sent_at as string | null;
		if (sentAt && (!stat.lastSentAt || sentAt > stat.lastSentAt)) stat.lastSentAt = sentAt;
	}

	return {
		clients: (clientsRes.data ?? []) as CrmCompany[],
		sendStats,
		error: clientsRes.error?.message ?? null
	};
};
