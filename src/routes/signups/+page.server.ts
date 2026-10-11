import { adminClient, fetchAllRows } from '$lib/server/supabase';
import type { PageServerLoad } from './$types';
import type { CrmCompany } from '$lib/ud/types';

export const load: PageServerLoad = async () => {
	const db = adminClient();
	// Stronami: jedno zapytanie oddawało tylko 1000 wierszy (db_max_rows),
	// a „Łącznie w bazie” pokazywało 1000 zamiast faktycznej liczby kontaktów.
	try {
		const signups = await fetchAllRows<CrmCompany>(
			(from, to) =>
				db
					.from('crm_companies')
					.select('*')
					.order('created_at', { ascending: false, nullsFirst: false })
					.order('id', { ascending: false })
					.range(from, to),
			'crm_companies'
		);
		return { signups, error: null };
	} catch (e) {
		return { signups: [] as CrmCompany[], error: e instanceof Error ? e.message : String(e) };
	}
};
