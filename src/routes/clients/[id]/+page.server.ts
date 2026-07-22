import { error } from '@sveltejs/kit';
import { adminClient } from '$lib/server/supabase';
import type { PageServerLoad } from './$types';
import type { CrmCompany } from '$lib/ud/types';

export interface ClientEmailRow {
	id: string;
	created_at: string;
	to_email: string;
	source: string;
	status: string;
	error: string | null;
	resend_id: string | null;
	sent_at: string | null;
	delivered_at: string | null;
	opened_at: string | null;
	clicked_at: string | null;
	bounced_at: string | null;
	email_categories: { code: string; name: string } | null;
	email_campaigns: { id: string; name: string } | null;
}

export const load: PageServerLoad = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id)) throw error(404, 'Nieprawidłowy identyfikator Klienta');

	const db = adminClient();
	const res = await db.from('crm_companies').select('*').eq('id', id).maybeSingle();
	if (res.error) throw error(500, res.error.message);
	if (!res.data) throw error(404, 'Nie znaleziono Klienta o wskazanym identyfikatorze');

	// Historia wysyłek e-mail do tego Klienta (powiązanie po company_id).
	const emailsRes = await db
		.from('email_messages')
		.select(
			'id, created_at, to_email, source, status, error, resend_id, sent_at, delivered_at, opened_at, clicked_at, bounced_at, email_categories ( code, name ), email_campaigns ( id, name )'
		)
		.eq('company_id', id)
		.order('created_at', { ascending: false });

	return {
		client: res.data as CrmCompany,
		// PostgREST zwraca relacje to-one jako obiekty; bez wygenerowanych typów DB rzutujemy jawnie
		emails: (emailsRes.data ?? []) as unknown as ClientEmailRow[],
		emailsError: emailsRes.error?.message ?? null
	};
};
