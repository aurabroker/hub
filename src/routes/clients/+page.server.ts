import { adminClient, fetchAllRows } from '$lib/server/supabase';
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

	// Obie listy przekraczają 1000 wierszy, a PostgREST tnie odpowiedź do
	// db_max_rows bez błędu — stąd stronicowanie zamiast jednego .limit().
	let clients: CrmCompany[] = [];
	let messages: { company_id: number; sent_at: string | null; opened_at: string | null }[] = [];
	let error: string | null = null;

	try {
		[clients, messages] = await Promise.all([
			fetchAllRows<CrmCompany>(
				(from, to) =>
					db
						.from('crm_companies')
						.select('*')
						// id jako drugi klucz sortowania: created_at bywa puste i się powtarza,
						// a bez jednoznacznej kolejności strony mogłyby gubić wiersze.
						.order('created_at', { ascending: false, nullsFirst: false })
						.order('id', { ascending: false })
						.range(from, to),
				'crm_companies'
			),
			fetchAllRows<{ company_id: number; sent_at: string | null; opened_at: string | null }>(
				(from, to) =>
					db
						.from('email_messages')
						.select('company_id, sent_at, opened_at')
						.not('company_id', 'is', null)
						.not('sent_at', 'is', null)
						.order('id')
						.range(from, to),
				'email_messages'
			)
		]);
	} catch (err) {
		error = (err as Error).message;
	}

	// Agregacja wysyłek per Klient (company_id) — jeden przebieg po wierszach.
	const sendStats: Record<number, ClientSendStat> = {};
	for (const row of messages) {
		const cid = row.company_id as number;
		const stat = (sendStats[cid] ??= { sent: 0, opened: 0, lastSentAt: null });
		stat.sent++;
		if (row.opened_at) stat.opened++;
		const sentAt = row.sent_at as string | null;
		if (sentAt && (!stat.lastSentAt || sentAt > stat.lastSentAt)) stat.lastSentAt = sentAt;
	}

	return { clients, sendStats, error };
};
