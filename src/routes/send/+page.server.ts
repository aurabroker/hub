import { fail } from '@sveltejs/kit';
import { EMAIL_RE } from '$lib/categories';
import { quickSend } from '$lib/server/sender';
import { adminClient } from '$lib/server/supabase';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const db = adminClient();
	const { data: categories } = await db
		.from('email_categories')
		.select('id, code, name, resend_template_id, email_category_assets ( email_assets ( id, name, filename ) )')
		.eq('active', true)
		.order('sort_order');

	return {
		// Prefill adresu przy wejściu z karty/listy Klienta: /send?email=...
		prefillEmail: url.searchParams.get('email') ?? '',
		categories: (categories ?? []).map((c) => ({
			id: c.id as string,
			code: c.code as string,
			name: c.name as string,
			hasTemplate: Boolean(c.resend_template_id),
			attachments: ((c.email_category_assets ?? []) as unknown as { email_assets: { filename: string } | null }[])
				.map((r) => r.email_assets?.filename)
				.filter((f): f is string => Boolean(f))
		}))
	};
};

export const actions: Actions = {
	default: async ({ request, url }) => {
		const form = await request.formData();
		const toEmail = String(form.get('email') ?? '').trim();
		const categoryIds = form.getAll('categories').map(String).filter(Boolean);

		if (!EMAIL_RE.test(toEmail)) {
			return fail(400, { error: 'Podaj poprawny adres e-mail', email: toEmail, categoryIds });
		}
		if (categoryIds.length === 0) {
			return fail(400, { error: 'Zaznacz co najmniej jedną kategorię', email: toEmail, categoryIds });
		}

		const results = await quickSend(adminClient(), toEmail, categoryIds, url.origin);
		return { results, email: toEmail };
	}
};
