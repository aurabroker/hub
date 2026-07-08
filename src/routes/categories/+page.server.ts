import { fail } from '@sveltejs/kit';
import { adminClient } from '$lib/server/supabase';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const db = adminClient();
	const { data: categories } = await db.from('email_categories').select('*').order('sort_order');
	return { categories: categories ?? [] };
};

export const actions: Actions = {
	update: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'Brak identyfikatora kategorii' });

		const db = adminClient();
		const { error } = await db
			.from('email_categories')
			.update({
				name: String(form.get('name') ?? '').trim() || 'Bez nazwy',
				resend_template_id: String(form.get('resend_template_id') ?? '').trim() || null,
				subject: String(form.get('subject') ?? '').trim() || null,
				from_email: String(form.get('from_email') ?? '').trim() || null,
				active: form.get('active') === 'on',
				sort_order: Number.parseInt(String(form.get('sort_order') ?? '100'), 10) || 100
			})
			.eq('id', id);
		if (error) return fail(500, { error: error.message });
		return { success: 'Zapisano kategorię' };
	}
};
