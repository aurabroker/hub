import { error, fail } from '@sveltejs/kit';
import { materializeCampaign, previewAudience, processQueue, type SegmentFilters } from '$lib/server/sender';
import { adminClient } from '$lib/server/supabase';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const db = adminClient();
	const { data: campaign } = await db
		.from('email_campaigns')
		.select('*, email_categories ( code, name, resend_template_id )')
		.eq('id', params.id)
		.maybeSingle();
	if (!campaign) error(404, 'Nie znaleziono kampanii');

	const statusFilter = url.searchParams.get('status');
	let messagesQuery = db
		.from('email_messages')
		.select('id, to_email, company_id, status, error, attempts, sent_at, opened_at, clicked_at, resend_id')
		.eq('campaign_id', params.id)
		.order('created_at', { ascending: true })
		.limit(500);
	if (statusFilter) messagesQuery = messagesQuery.eq('status', statusFilter);

	const [{ data: messages }, { data: allStatuses }] = await Promise.all([
		messagesQuery,
		db.from('email_messages').select('status').eq('campaign_id', params.id)
	]);

	const counts: Record<string, number> = {};
	for (const m of allStatuses ?? []) {
		counts[m.status as string] = (counts[m.status as string] ?? 0) + 1;
	}

	let preview = null;
	if (campaign.status === 'draft') {
		preview = await previewAudience(
			db,
			(campaign.segment_json ?? {}) as SegmentFilters,
			campaign.audience_mode as string,
			campaign.category_id as string | null
		);
	}

	return { campaign, messages: messages ?? [], counts, statusFilter, preview };
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
		return {
			success: `Zmaterializowano odbiorców: ${queued} w kolejce, ${skipped} pominiętych. Wysyłka ruszy z kolejnymi partiami crona (albo przetwórz partię ręcznie).`
		};
	},

	/** Ręczne przetworzenie partii kolejki (gdy cron jeszcze nie działa). */
	process: async ({ url }) => {
		const result = await processQueue(adminClient(), url.origin, 20);
		return {
			success: `Partia przetworzona: wysłane ${result.sent}, błędy ${result.failed}, ponowienia ${result.requeued}`
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
			.update({ status: 'skipped', error: 'Kampania anulowana' })
			.eq('campaign_id', params.id)
			.eq('status', 'queued');
		await db.from('email_campaigns').update({ status: 'canceled' }).eq('id', params.id);
		return { success: 'Kampania anulowana — wiadomości z kolejki oznaczone jako pominięte' };
	}
};
