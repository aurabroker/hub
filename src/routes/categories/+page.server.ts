import { fail } from '@sveltejs/kit';
import { adminClient } from '$lib/server/supabase';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const db = adminClient();
	const { data: categories } = await db.from('email_categories').select('*').order('sort_order');
	return { categories: categories ?? [] };
};

export const actions: Actions = {
	/** Nowa kategoria = nowy typ maila widoczny w szybkiej wysyłce i kampaniach. */
	create: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const code = String(form.get('code') ?? '')
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9_]+/g, '_')
			.replace(/^_+|_+$/g, '');
		if (!name || !code) {
			return fail(400, { error: 'Podaj nazwę i kod kategorii (kod: małe litery, cyfry, podkreślenia)' });
		}

		const db = adminClient();
		const { error } = await db.from('email_categories').insert({
			code,
			name,
			resend_template_id: String(form.get('resend_template_id') ?? '').trim() || null,
			subject: String(form.get('subject') ?? '').trim() || null,
			attachment_mode: form.get('attachment_mode') === 'links' ? 'links' : 'attachments',
			sort_order: Number.parseInt(String(form.get('sort_order') ?? '100'), 10) || 100,
			active: true
		});
		if (error) {
			return fail(500, {
				error: error.code === '23505' ? `Kategoria o kodzie „${code}” już istnieje` : error.message
			});
		}
		return { success: `Utworzono kategorię „${name}” (${code})` };
	},

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
				attachment_mode: form.get('attachment_mode') === 'links' ? 'links' : 'attachments',
				active: form.get('active') === 'on',
				sort_order: Number.parseInt(String(form.get('sort_order') ?? '100'), 10) || 100
			})
			.eq('id', id);
		if (error) return fail(500, { error: error.message });
		return { success: 'Zapisano kategorię' };
	}
};
