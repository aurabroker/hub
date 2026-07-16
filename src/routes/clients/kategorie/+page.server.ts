import { fail } from '@sveltejs/kit';
import { adminClient } from '$lib/server/supabase';
import { dailySendStatus, enqueueCategoryBlast } from '$lib/server/sender';
import { EMAIL_RE, hasRodoConsent, normalizeInterest } from '$lib/categories';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const db = adminClient();

	const [catsRes, companiesRes, status, pendingRes] = await Promise.all([
		db
			.from('email_categories')
			.select('id, code, name, resend_template_id')
			.eq('active', true)
			.order('sort_order'),
		db.from('crm_companies').select('id, email, rodo, ubezpieczenie').limit(20000),
		dailySendStatus(db),
		db
			.from('email_messages')
			.select('category_id')
			.is('campaign_id', null)
			.in('status', ['queued', 'sending'])
	]);

	const totals = new Map<string, number>();
	const eligible = new Map<string, number>();
	for (const c of companiesRes.data ?? []) {
		const row = c as { email: string | null; rodo: string | null; ubezpieczenie: string | null };
		const code = normalizeInterest(row.ubezpieczenie);
		totals.set(code, (totals.get(code) ?? 0) + 1);
		const email = (row.email ?? '').trim();
		if (EMAIL_RE.test(email) && hasRodoConsent(row.rodo)) {
			eligible.set(code, (eligible.get(code) ?? 0) + 1);
		}
	}

	const pendingByCat = new Map<string, number>();
	for (const p of pendingRes.data ?? []) {
		const id = (p as { category_id: string | null }).category_id;
		if (id) pendingByCat.set(id, (pendingByCat.get(id) ?? 0) + 1);
	}

	const categories = (catsRes.data ?? []).map((c) => ({
		id: c.id as string,
		code: c.code as string,
		name: c.name as string,
		hasTemplate: Boolean(c.resend_template_id),
		total: totals.get(c.code as string) ?? 0,
		eligible: eligible.get(c.code as string) ?? 0,
		pending: pendingByCat.get(c.id as string) ?? 0
	}));

	return { categories, status, error: catsRes.error?.message ?? companiesRes.error?.message ?? null };
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
