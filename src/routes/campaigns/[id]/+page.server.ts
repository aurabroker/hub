import { error, fail } from '@sveltejs/kit';
import {
	CANCELED_REASON,
	closeFinishedCampaigns,
	materializeCampaign,
	previewAudience,
	processQueue,
	queueHealth,
	type SegmentFilters
} from '$lib/server/sender';
import { adminClient } from '$lib/server/supabase';
import type { Actions, PageServerLoad } from './$types';

const MESSAGE_STATUSES = ['queued', 'sending', 'sent', 'failed', 'bounced', 'skipped'] as const;
const RECIPIENTS_LIMIT = 500;

export const load: PageServerLoad = async ({ params, url }) => {
	const db = adminClient();
	const { data: campaign } = await db
		.from('email_campaigns')
		.select('*, email_categories ( code, name, resend_template_id, html_body, subject, from_email )')
		.eq('id', params.id)
		.maybeSingle();
	if (!campaign) error(404, 'Nie znaleziono kampanii');

	const statusFilter = url.searchParams.get('status');
	let messagesQuery = db
		.from('email_messages')
		.select('id, to_email, company_id, status, error, attempts, sent_at, opened_at, clicked_at, resend_id')
		.eq('campaign_id', params.id)
		.order('created_at', { ascending: true })
		.limit(RECIPIENTS_LIMIT);
	if (statusFilter) messagesQuery = messagesQuery.eq('status', statusFilter);

	// Liczniki jako zapytania COUNT: pobranie wierszy i liczenie w pamięci ucinało
	// się na 1000 (db_max_rows), więc kampania na 1385 adresów pokazywała zły postęp.
	const countFor = (status: string) =>
		db
			.from('email_messages')
			.select('id', { count: 'exact', head: true })
			.eq('campaign_id', params.id)
			.eq('status', status);
	const [{ data: messages }, health, ...countResults] = await Promise.all([
		messagesQuery,
		queueHealth(db),
		...MESSAGE_STATUSES.map(countFor)
	]);

	const counts: Record<string, number> = {};
	MESSAGE_STATUSES.forEach((status, i) => {
		const n = countResults[i].count ?? 0;
		if (n > 0) counts[status] = n;
	});

	let preview = null;
	if (campaign.status === 'draft') {
		preview = await previewAudience(
			db,
			(campaign.segment_json ?? {}) as SegmentFilters,
			campaign.audience_mode as string,
			campaign.category_id as string | null
		);
	}

	return {
		campaign,
		messages: messages ?? [],
		recipientsLimit: RECIPIENTS_LIMIT,
		counts,
		statusFilter,
		preview,
		health
	};
};

export const actions: Actions = {
	/** Start: materializacja odbiorców + przejście w 'sending' (albo 'scheduled'). */
	start: async ({ params }) => {
		const db = adminClient();
		const { data: campaign } = await db
			.from('email_campaigns')
			.select('id, status, scheduled_at, category_id')
			.eq('id', params.id)
			.maybeSingle();
		if (!campaign) return fail(404, { error: 'Nie znaleziono kampanii' });
		if (!['draft', 'scheduled', 'canceled'].includes(campaign.status as string)) {
			return fail(400, { error: 'Kampanię można uruchomić tylko ze statusu szkic/zaplanowana' });
		}
		if (!campaign.category_id) {
			return fail(400, { error: 'Kampania nie ma przypisanej kategorii' });
		}

		if (campaign.scheduled_at && new Date(campaign.scheduled_at as string) > new Date()) {
			await db.from('email_campaigns').update({ status: 'scheduled' }).eq('id', params.id);
			return { success: 'Kampania zaplanowana — wysyłkę uruchomi cron o wskazanym czasie' };
		}

		const { queued, skipped } = await materializeCampaign(db, params.id);
		await db.from('email_campaigns').update({ status: 'sending' }).eq('id', params.id);
		// Kampania bez nikogo w kolejce od razu dostaje status końcowy.
		await closeFinishedCampaigns(db);
		return {
			success: `Zmaterializowano odbiorców: ${queued} w kolejce, ${skipped} pominiętych. Wysyłka ruszy z kolejnymi partiami crona (albo przetwórz partię ręcznie).`
		};
	},

	/** Ręczne przetworzenie partii kolejki (gdy cron jeszcze nie działa). */
	process: async ({ url }) => {
		const result = await processQueue(adminClient(), url.origin, 20);
		return {
			success: `Partia przetworzona: wysłane ${result.sent}, błędy ${result.failed}, ponowienia ${result.requeued}${result.rateLimited ? ' (Resend: limit zapytań — reszta w kolejnej partii)' : ''}`
		};
	},

	/** Ponowienie nieudanych: failed → queued z wyzerowanym licznikiem prób. */
	retry: async ({ params }) => {
		const db = adminClient();
		const { data, error: updateError } = await db
			.from('email_messages')
			.update({ status: 'queued', attempts: 0, error: null })
			.eq('campaign_id', params.id)
			.eq('status', 'failed')
			.select('id');
		if (updateError) return fail(500, { error: updateError.message });
		await db
			.from('email_campaigns')
			.update({ status: 'sending' })
			.eq('id', params.id)
			.in('status', ['sent', 'failed']);
		return { success: `Przywrócono do kolejki: ${data?.length ?? 0} wiadomości` };
	},

	cancel: async ({ params }) => {
		const db = adminClient();
		await db
			.from('email_messages')
			.update({ status: 'skipped', error: CANCELED_REASON })
			.eq('campaign_id', params.id)
			.eq('status', 'queued');
		await db.from('email_campaigns').update({ status: 'canceled' }).eq('id', params.id);
		return { success: 'Kampania anulowana — wiadomości z kolejki oznaczone jako pominięte' };
	}
};
