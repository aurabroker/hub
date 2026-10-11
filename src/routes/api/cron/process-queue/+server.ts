import { json, text } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { adminClient } from '$lib/server/supabase';
import { cronSecretFrom, secretMatches } from '$lib/server/secrets';
import { processQueue } from '$lib/server/sender';
import type { RequestHandler } from './$types';

/**
 * Przetwarzanie kolejki wysyłki — wywoływane cyklicznie przez Workera (cron)
 * albo ręcznie. Chronione sekretem QUEUE_CRON_SECRET.
 */
export const POST: RequestHandler = async ({ request, url }) => {
	const secret = env.QUEUE_CRON_SECRET?.trim();
	if (!secret || !secretMatches(cronSecretFrom(request), secret)) {
		return text('Brak autoryzacji', { status: 401 });
	}

	const limit = Math.min(Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 50);
	const result = await processQueue(adminClient(), url.origin, limit);
	return json(result);
};
