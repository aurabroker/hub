import { json, text } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
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

interface ResendWebhookEvent {
	type: string;
	created_at?: string;
	data?: { email_id?: string };
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
	const resendId = event.data?.email_id;
	if (!column || !resendId) {
		// Zdarzenie spoza subskrybowanych typów — potwierdź, żeby Resend nie ponawiał
		return json({ ignored: true });
	}

	const db = adminClient();
	const { data: message } = await db
		.from('email_messages')
		.select('id, status, delivered_at, opened_at, clicked_at, bounced_at, complained_at')
		.eq('resend_id', resendId)
		.maybeSingle();
	if (!message) {
		return json({ ignored: true, reason: 'nieznany resend_id' });
	}

	const row = message as Record<string, unknown> & { id: string; status: string };
	const update: Record<string, unknown> = {};
	// Pierwsze zdarzenie wygrywa (np. pierwsza data otwarcia)
	if (!row[column]) {
		update[column] = event.created_at ?? new Date().toISOString();
	}
	if (event.type === 'email.bounced' && row.status !== 'bounced') {
		update.status = 'bounced';
	}
	if (Object.keys(update).length > 0) {
		await db.from('email_messages').update(update).eq('id', row.id);
	}

	return json({ ok: true });
};
