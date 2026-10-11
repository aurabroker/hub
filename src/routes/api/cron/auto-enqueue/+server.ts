import { json, text } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { adminClient } from '$lib/server/supabase';
import { cronSecretFrom, secretMatches } from '$lib/server/secrets';
import { enqueueAutoSend } from '$lib/server/sender';
import type { RequestHandler } from './$types';

/**
 * Automatyczna wysyłka: kolejkuje nowe zapisy dla sekcji z włączonym automatem.
 * Świadomie ODDZIELONE od /api/cron/process-queue — każde wywołanie ma własny
 * budżet subrequestów Cloudflare, więc kolejkowanie nie przewraca wysyłki.
 * Chronione tym samym sekretem QUEUE_CRON_SECRET.
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.QUEUE_CRON_SECRET;
	if (!secret || !secretMatches(cronSecretFrom(request), secret)) {
		return text('Brak autoryzacji', { status: 401 });
	}

	const result = await enqueueAutoSend(adminClient());
	return json(result);
};
