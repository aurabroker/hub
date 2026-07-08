import { error, redirect } from '@sveltejs/kit';
import { BUCKET } from '$lib/server/sender';
import { adminClient } from '$lib/server/supabase';
import type { RequestHandler } from './$types';

/** Podgląd/pobranie pliku z prywatnego bucketa przez krótkotrwały signed URL. */
export const GET: RequestHandler = async ({ params }) => {
	const db = adminClient();
	const { data: asset } = await db
		.from('email_assets')
		.select('storage_path')
		.eq('id', params.id)
		.maybeSingle();
	if (!asset) error(404, 'Nie znaleziono pliku');

	const { data, error: signError } = await db.storage
		.from(BUCKET)
		.createSignedUrl(asset.storage_path, 60);
	if (signError || !data) error(500, 'Nie udało się wygenerować linku');

	redirect(303, data.signedUrl);
};
