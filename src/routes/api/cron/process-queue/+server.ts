import { json, text } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { adminClient } from '$lib/server/supabase';
import { processQueue } from '$lib/server/sender';
import type { RequestHandler } from './$types';

/**
 * Przetwarzanie kolejki wysyłki — wywoływane cyklicznie przez Workera (cron)
 * albo ręcznie. Chronione sekretem QUEUE_CRON_SECRET.
 */
export const POST: RequestHandler = async ({ request, url }) => {
	const secret = env.QUEUE_CRON_SECRET;
	const provided =
		request.headers.get('x-cron-secret') ??
		request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
	if (!secret || provided !== secret) {
		return text('Brak autoryzacji', { status: 401 });
	}

	const limit = Math.min(Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 50);
	const result = await processQueue(adminClient(), url.origin, limit);
	return json(result);
};
