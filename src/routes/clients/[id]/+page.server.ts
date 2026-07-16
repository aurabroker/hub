import { error } from '@sveltejs/kit';
import { adminClient } from '$lib/server/supabase';
import type { PageServerLoad } from './$types';
import type { CrmCompany } from '$lib/ud/types';

export const load: PageServerLoad = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id)) throw error(404, 'Nieprawidłowy identyfikator Klienta');

	const db = adminClient();
	const res = await db.from('crm_companies').select('*').eq('id', id).maybeSingle();
	if (res.error) throw error(500, res.error.message);
	if (!res.data) throw error(404, 'Nie znaleziono Klienta o wskazanym identyfikatorze');

	return { client: res.data as CrmCompany };
};
