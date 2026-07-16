import { error, fail } from '@sveltejs/kit';
import { adminClient } from '$lib/server/supabase';
import { dailySendStatus, enqueueCategoryBlast } from '$lib/server/sender';
import {
	CANONICAL_CODES,
	CODE_LABELS,
	EMAIL_RE,
	hasRodoConsent,
	normalizeInterest,
	type CanonicalCode
} from '$lib/categories';
import type { Actions, PageServerLoad } from './$types';
import type { CrmCompany } from '$lib/ud/types';

export const load: PageServerLoad = async ({ params }) => {
	const code = params.code as CanonicalCode;
	if (!CANONICAL_CODES.includes(code)) throw error(404, 'Nieznana kategoria');

	const db = adminClient();
	const [catRes, companiesRes, status] = await Promise.all([
		db
			.from('email_categories')
			.select('id, code, name, resend_template_id')
			.eq('code', code)
			.eq('active', true)
			.maybeSingle(),
		db.from('crm_companies').select('*').order('created_at', { ascending: false, nullsFirst: false }),
		dailySendStatus(db)
	]);

	const companies = ((companiesRes.data ?? []) as CrmCompany[]).filter(
		(c) => normalizeInterest(c.ubezpieczenie) === code
	);
	let eligible = 0;
	for (const c of companies) {
		if (EMAIL_RE.test((c.email ?? '').trim()) && hasRodoConsent(c.rodo)) eligible++;
	}

	const category = catRes.data
		? {
				id: catRes.data.id as string,
				name: catRes.data.name as string,
				hasTemplate: Boolean(catRes.data.resend_template_id)
			}
		: null;

	return {
		code,
		label: CODE_LABELS[code],
		category,
		companies,
		eligible,
		status,
		error: companiesRes.error?.message ?? null
	};
};

export const actions: Actions = {
	blast: async ({ request }) => {
		const form = await request.formData();
		const categoryId = String(form.get('categoryId') ?? '').trim();
		if (!categoryId) return fail(400, { error: 'Brak identyfikatora kategorii' });
		try {
			const blast = await enqueueCategoryBlast(adminClient(), categoryId);
			return { blast };
		} catch (e) {
			return fail(500, { error: e instanceof Error ? e.message : String(e) });
		}
	}
};
