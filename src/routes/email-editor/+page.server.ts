import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { adminClient } from '$lib/server/supabase';
import { sendResendEmail } from '$lib/server/resend';
import { renderEmailHtml } from '$lib/email/render';
import { EMAIL_RE } from '$lib/categories';
import type { Actions, PageServerLoad } from './$types';

const SAMPLE_VARS: Record<string, string> = {
	firma: 'Przykładowa Firma sp. z o.o.',
	kontakt: 'Jan Kowalski',
	miasto: 'Warszawa',
	nip: '1234567890'
};

export const load: PageServerLoad = async ({ locals }) => {
	const db = adminClient();
	const { data: categories } = await db
		.from('email_categories')
		.select('id, code, name, subject, from_email, resend_template_id, html_body')
		.eq('active', true)
		.order('sort_order');

	return {
		categories: (categories ?? []).map((c) => ({
			id: c.id as string,
			code: c.code as string,
			name: c.name as string,
			subject: (c.subject as string | null) ?? '',
			hasTemplate: Boolean(c.resend_template_id),
			html_body: (c.html_body as string | null) ?? ''
		})),
		testEmail: locals.user?.email ?? ''
	};
};

export const actions: Actions = {
	// Zapis treści HTML + tematu w sekcji (email_categories).
	save: async ({ request }) => {
		const form = await request.formData();
		const categoryId = String(form.get('categoryId') ?? '').trim();
		const subject = String(form.get('subject') ?? '').trim();
		const html = String(form.get('html') ?? '');

		if (!categoryId) return fail(400, { error: 'Wybierz sekcję' });
		if (html.trim() && !subject) {
			return fail(400, { error: 'Ustaw temat maila — przy treści HTML jest wymagany' });
		}

		const { error } = await adminClient()
			.from('email_categories')
			.update({ html_body: html, subject: subject || null })
			.eq('id', categoryId);
		if (error) return fail(500, { error: error.message });

		return { saved: true };
	},

	// Wysyłka testowa bieżącej treści na wskazany adres (z przykładowymi zmiennymi).
	test: async ({ request }) => {
		const form = await request.formData();
		const categoryId = String(form.get('categoryId') ?? '').trim();
		const subject = String(form.get('subject') ?? '').trim();
		const html = String(form.get('html') ?? '');
		const toEmail = String(form.get('testEmail') ?? '').trim();

		if (!EMAIL_RE.test(toEmail)) return fail(400, { error: 'Podaj poprawny adres do testu', testError: true });
		if (!subject) return fail(400, { error: 'Ustaw temat maila przed testem', testError: true });
		if (!html.trim()) return fail(400, { error: 'Treść jest pusta', testError: true });

		let fromEmail = env.RESEND_FROM ?? '';
		if (categoryId) {
			const { data: cat } = await adminClient()
				.from('email_categories')
				.select('from_email')
				.eq('id', categoryId)
				.maybeSingle();
			fromEmail = (cat?.from_email as string | null) || fromEmail;
		}
		if (!fromEmail) return fail(500, { error: 'Brak adresu nadawcy (RESEND_FROM / sekcja)', testError: true });

		const rendered = renderEmailHtml(html, SAMPLE_VARS, {
			unsubscribeUrl: env.RESEND_UNSUBSCRIBE_URL
		});
		const res = await sendResendEmail({
			from: fromEmail,
			to: toEmail,
			subject: `[TEST] ${subject}`,
			html: rendered
		});
		if (!res.ok) return fail(502, { error: res.error ?? 'Błąd wysyłki testowej', testError: true });

		return { tested: toEmail };
	}
};
