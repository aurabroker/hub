import { error, redirect } from '@sveltejs/kit';
import { BUCKET } from '$lib/server/sender';
import { adminClient } from '$lib/server/supabase';
import type { RequestHandler } from './$types';

/**
 * Publiczne pobieranie pliku z maila (tryb „linki zamiast załączników").
 * Adres zawiera niezgadywalny UUID zasobu; plik serwowany jest przez
 * krótkotrwały signed URL z prywatnego bucketa. Przeznaczone wyłącznie
 * do materiałów produktowych (OWU, ulotki) — nie do danych osobowych.
 */
export const GET: RequestHandler = async ({ params }) => {
	const db = adminClient();
	const { data: asset } = await db
		.from('email_assets')
		.select('storage_path, filename')
		.eq('id', params.id)
		.maybeSingle();
	if (!asset) error(404, 'Nie znaleziono pliku');

	const { data, error: signError } = await db.storage
		.from(BUCKET)
		.createSignedUrl(asset.storage_path, 600, { download: asset.filename });
	if (signError || !data) error(500, 'Nie udało się wygenerować linku do pliku');

	redirect(302, data.signedUrl);
};
