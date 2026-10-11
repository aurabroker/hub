import { fail } from '@sveltejs/kit';
import { adminClient } from '$lib/server/supabase';
import { processQueue, queueHealth } from '$lib/server/sender';
import { backfillPending, backfillStats } from '$lib/server/stats';
import type { Actions, PageServerLoad } from './$types';

const STATUSES = ['queued', 'sending', 'sent', 'failed', 'bounced', 'skipped'];

interface MessageRow {
	id: string;
	created_at: string;
	to_email: string;
	company_id: number | null;
	source: string;
	status: string;
	error: string | null;
	attempts: number;
	resend_id: string | null;
	sent_at: string | null;
	delivered_at: string | null;
	opened_at: string | null;
	clicked_at: string | null;
	stats_backfilled_at: string | null;
	email_categories: { code: string; name: string } | null;
	email_campaigns: { id: string; name: string } | null;
}

export const load: PageServerLoad = async ({ url }) => {
	const db = adminClient();
	const status = url.searchParams.get('status');
	const source = url.searchParams.get('source');
	const categoryId = url.searchParams.get('category');
	const search = url.searchParams.get('q')?.trim();

	let query = db
		.from('email_messages')
		.select(
			'id, created_at, to_email, company_id, source, status, error, attempts, resend_id, sent_at, delivered_at, opened_at, clicked_at, stats_backfilled_at, email_categories ( code, name ), email_campaigns ( id, name )'
		)
		.order('created_at', { ascending: false })
		.limit(200);
	if (status && STATUSES.includes(status)) query = query.eq('status', status);
	if (source === 'campaign' || source === 'quick_send' || source === 'auto')
		query = query.eq('source', source);
	if (categoryId) query = query.eq('category_id', categoryId);
	if (search) query = query.ilike('to_email', `%${search}%`);

	// Liczniki jako COUNT na status: pobranie wszystkich wierszy ucinało się na 1000
	// (db_max_rows) i pokazywało np. „sent (0)” przy 2,5 tys. wysłanych.
	const countFor = (s: string) =>
		db.from('email_messages').select('id', { count: 'exact', head: true }).eq('status', s);
	const [{ data: messages }, { data: categories }, pendingBackfill, health, ...countResults] =
		await Promise.all([
			query,
			db.from('email_categories').select('id, code, name').order('sort_order'),
			backfillPending(db),
			queueHealth(db),
			...STATUSES.map(countFor)
		]);

	const counts: Record<string, number> = {};
	STATUSES.forEach((s, i) => {
		const n = countResults[i].count ?? 0;
		if (n > 0) counts[s] = n;
	});

	return {
		// PostgREST zwraca relacje to-one jako obiekty; bez wygenerowanych typów DB rzutujemy jawnie
		messages: (messages ?? []) as unknown as MessageRow[],
		categories: categories ?? [],
		counts,
		pendingBackfill,
		health,
		filters: { status, source, category: categoryId, q: search ?? '' }
	};
};

export const actions: Actions = {
	/**
	 * Partia całej kolejki (automat, kampanie, „do wszystkich”). Przycisk na stronie
	 * kampanii znika po jej zakończeniu, a wiadomości bez kampanii też muszą mieć
	 * czym ruszyć, gdy cron nie działa.
	 */
	process: async ({ url }) => {
		try {
			const result = await processQueue(adminClient(), url.origin, 20);
			return {
				processed: `Partia przetworzona: wysłane ${result.sent}, błędy ${result.failed}, ponowienia ${result.requeued}, wstrzymane (duplikat / blokada) ${result.withheld}${result.held ? `, czekają na poprawkę szablonu ${result.held}` : ''}${result.rateLimited ? ' (Resend: limit zapytań — reszta w kolejnej partii)' : ''}`
			};
		} catch (e) {
			return fail(500, { error: e instanceof Error ? e.message : String(e) });
		}
	},

	/** Uzupełnia statystyki z API Resend dla maili sprzed subskrypcji email.opened. */
	backfill: async () => {
		try {
			const result = await backfillStats(adminClient());
			return { backfill: result };
		} catch (e) {
			return fail(500, { error: e instanceof Error ? e.message : String(e) });
		}
	}
};
