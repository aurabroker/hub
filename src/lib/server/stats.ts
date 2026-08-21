import type { SupabaseClient } from '@supabase/supabase-js';
import { getResendEmail } from './resend';

/**
 * Uzupełnianie statystyk z API Resend dla maili wysłanych, zanim webhook
 * subskrybował dane zdarzenie (np. email.opened).
 *
 * OGRANICZENIE: API Resend zwraca tylko `last_event` — ostatnie zdarzenie, bez
 * znaczników czasu. Wiemy więc CZY mail otwarto, ale nie KIEDY. Uzupełniony
 * znacznik jest przybliżony (czas dostarczenia albo wysyłki), a kolumna
 * stats_backfilled_at odróżnia takie wpisy od danych z webhooka.
 */

/** Odstęp między zapytaniami — Resend limituje do ~2 req/s. */
const REQUEST_DELAY_MS = 550;
/** Ile maili na jedno uruchomienie (limit czasu funkcji + limit zapytań). */
export const BACKFILL_BATCH = 25;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BackfillResult {
	sprawdzono: number;
	otwarcia: number;
	klikniecia: number;
	odbicia: number;
	pozostalo: number;
	bledy: number;
	/** Resend odrzucił zapytania z powodu limitu — spróbuj ponownie za chwilę. */
	rateLimited?: boolean;
}

/** Ile maili wciąż czeka na uzupełnienie. */
export async function backfillPending(db: SupabaseClient): Promise<number> {
	const { count } = await db
		.from('email_messages')
		.select('id', { count: 'exact', head: true })
		.eq('status', 'sent')
		.not('resend_id', 'is', null)
		.is('stats_backfilled_at', null);
	return count ?? 0;
}

export async function backfillStats(
	db: SupabaseClient,
	batch = BACKFILL_BATCH
): Promise<BackfillResult> {
	const result: BackfillResult = {
		sprawdzono: 0,
		otwarcia: 0,
		klikniecia: 0,
		odbicia: 0,
		pozostalo: 0,
		bledy: 0
	};

	const { data: rows, error } = await db
		.from('email_messages')
		.select('id, resend_id, sent_at, delivered_at, opened_at, clicked_at, bounced_at')
		.eq('status', 'sent')
		.not('resend_id', 'is', null)
		.is('stats_backfilled_at', null)
		.order('sent_at', { ascending: false })
		.limit(batch);
	if (error) throw new Error(`email_messages: ${error.message}`);

	for (const [index, row] of (rows ?? []).entries()) {
		if (index > 0) await sleep(REQUEST_DELAY_MS);

		const res = await getResendEmail(row.resend_id as string);
		if (res.rateLimited) {
			result.rateLimited = true;
			break;
		}
		if (!res.ok) {
			result.bledy++;
			continue;
		}
		result.sprawdzono++;

		// Przybliżony czas zdarzenia — API nie podaje właściwego.
		const approx = (row.delivered_at as string | null) ?? (row.sent_at as string | null);
		const update: Record<string, unknown> = { stats_backfilled_at: new Date().toISOString() };

		switch (res.lastEvent) {
			case 'clicked':
				// Kliknięcie implikuje otwarcie — uzupełniamy oba.
				if (!row.clicked_at) {
					update.clicked_at = approx;
					result.klikniecia++;
				}
				if (!row.opened_at) {
					update.opened_at = approx;
					result.otwarcia++;
				}
				break;
			case 'opened':
				if (!row.opened_at) {
					update.opened_at = approx;
					result.otwarcia++;
				}
				break;
			case 'bounced':
				if (!row.bounced_at) {
					update.bounced_at = approx;
					update.status = 'bounced';
					result.odbicia++;
				}
				break;
			case 'delivered':
				if (!row.delivered_at) update.delivered_at = approx;
				break;
			default:
				// sent / queued / delivery_delayed / complained itd. — nic nie zmieniamy
				break;
		}

		const { error: updErr } = await db.from('email_messages').update(update).eq('id', row.id);
		if (updErr) result.bledy++;
	}

	result.pozostalo = await backfillPending(db);
	return result;
}
