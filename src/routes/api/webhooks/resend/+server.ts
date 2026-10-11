import { json, text } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { attemptsToRoundEnd } from '$lib/server/sender';
import { adminClient } from '$lib/server/supabase';
import { verifySvixSignature } from '$lib/server/svix';
import type { RequestHandler } from './$types';

/** Mapowanie typu zdarzenia Resend na kolumnę znacznika czasu. */
const EVENT_COLUMNS: Record<string, string> = {
	'email.delivered': 'delivered_at',
	'email.opened': 'opened_at',
	'email.clicked': 'clicked_at',
	'email.bounced': 'bounced_at',
	'email.complained': 'complained_at'
};

/**
 * Resend przyjął żądanie, ale maila nie dostarczył: adres na liście blokad
 * (wcześniejsze odbicie lub skarga) albo błąd po stronie Resend. Bez obsługi
 * tych zdarzeń wiadomość zostawała w HUB jako „wysłana”.
 * Wymaga zasubskrybowania email.suppressed i email.failed w webhooku Resend.
 */
const UNDELIVERED_EVENTS: Record<string, { status: string; error: string }> = {
	// 'bounced', bo to adres zablokowany — trafia do blokad HUB i nie wraca przy „Ponów nieudane”.
	'email.suppressed': {
		status: 'bounced',
		error: 'Resend nie wysłał: adres na liście blokad (wcześniejsze odbicie lub skarga)'
	},
	'email.failed': { status: 'failed', error: 'Resend nie wysłał maila' }
};

interface ResendWebhookEvent {
	type: string;
	created_at?: string;
	data?: { email_id?: string; failed?: { reason?: string } };
}

export const POST: RequestHandler = async ({ request }) => {
	if (!env.RESEND_WEBHOOK_SECRET) {
		return text('Webhook nieskonfigurowany', { status: 503 });
	}

	const payload = await request.text();
	const valid = await verifySvixSignature(
		env.RESEND_WEBHOOK_SECRET,
		payload,
		request.headers.get('svix-id'),
		request.headers.get('svix-timestamp'),
		request.headers.get('svix-signature')
	);
	if (!valid) {
		return text('Nieprawidłowy podpis', { status: 401 });
	}

	let event: ResendWebhookEvent;
	try {
		event = JSON.parse(payload) as ResendWebhookEvent;
	} catch {
		return text('Nieprawidłowy JSON', { status: 400 });
	}

	const column = EVENT_COLUMNS[event.type];
	const undelivered = UNDELIVERED_EVENTS[event.type];
	const resendId = event.data?.email_id;
	if ((!column && !undelivered) || !resendId) {
		// Zdarzenie spoza subskrybowanych typów — potwierdź, żeby Resend nie ponawiał
		return json({ ignored: true });
	}

	const db = adminClient();
	const { data: message, error: loadError } = await db
		.from('email_messages')
		.select('id, status, attempts, delivered_at, opened_at, clicked_at, bounced_at, complained_at')
		.eq('resend_id', resendId)
		.maybeSingle();
	// Błąd bazy = 500, żeby Resend ponowił zdarzenie zamiast je zgubić.
	if (loadError) return text('Błąd bazy', { status: 500 });
	if (!message) {
		return json({ ignored: true, reason: 'nieznany resend_id' });
	}

	const row = message as Record<string, unknown> & { id: string; status: string; attempts: number };
	const update: Record<string, unknown> = {};
	// Pierwsze zdarzenie wygrywa (np. pierwsza data otwarcia)
	if (column && !row[column]) {
		update[column] = event.created_at ?? new Date().toISOString();
	}
	if (event.type === 'email.bounced' && row.status !== 'bounced') {
		update.status = 'bounced';
	}
	if (undelivered && row.status === 'sent') {
		const reason = event.data?.failed?.reason;
		update.status = undelivered.status;
		update.error = reason ? `${undelivered.error}: ${reason}` : undelivered.error;
		// „Ponów nieudane” musi wysłać naprawdę, czyli z nowym kluczem idempotencji.
		update.attempts = attemptsToRoundEnd(row.attempts ?? 0);
	}
	if (Object.keys(update).length > 0) {
		const { error: updateError } = await db.from('email_messages').update(update).eq('id', row.id);
		if (updateError) return text('Błąd bazy', { status: 500 });
	}

	return json({ ok: true });
};
