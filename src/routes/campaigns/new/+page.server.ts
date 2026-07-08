import { fail, redirect } from '@sveltejs/kit';
import { previewAudience, type SegmentFilters } from '$lib/server/sender';
import { adminClient } from '$lib/server/supabase';
import type { Actions, PageServerLoad } from './$types';

function parseSegment(form: FormData): SegmentFilters {
	const filters: SegmentFilters = {};
	const kategorie = form.getAll('seg_kategorie').map(String).filter(Boolean);
	const statusy = form.getAll('seg_statusy').map(String).filter(Boolean);
	const miasto = String(form.get('seg_miasto') ?? '').trim();
	const tag = String(form.get('seg_tag') ?? '').trim();
	const leadSource = String(form.get('seg_lead_source') ?? '').trim();
	if (kategorie.length > 0) filters.kategorie = kategorie;
	if (statusy.length > 0) filters.statusy = statusy;
	if (miasto) filters.miasto = miasto;
	if (tag) filters.tag = tag;
	if (leadSource) filters.lead_source = leadSource;
	return filters;
}

function echo(form: FormData) {
	return {
		name: String(form.get('name') ?? ''),
		category_id: String(form.get('category_id') ?? ''),
		subject: String(form.get('subject') ?? ''),
		from_email: String(form.get('from_email') ?? ''),
		audience_mode: String(form.get('audience_mode') ?? 'all'),
		scheduled_at: String(form.get('scheduled_at') ?? ''),
		seg_kategorie: form.getAll('seg_kategorie').map(String),
		seg_statusy: form.getAll('seg_statusy').map(String),
		seg_miasto: String(form.get('seg_miasto') ?? ''),
		seg_tag: String(form.get('seg_tag') ?? ''),
		seg_lead_source: String(form.get('seg_lead_source') ?? '')
	};
}

export const load: PageServerLoad = async () => {
	const db = adminClient();
	const { data: categories } = await db
		.from('email_categories')
		.select('id, code, name')
		.eq('active', true)
		.order('sort_order');
	return { categories: categories ?? [] };
};

export const actions: Actions = {
	preview: async ({ request }) => {
		const form = await request.formData();
		const categoryId = String(form.get('category_id') ?? '') || null;
		const preview = await previewAudience(
			adminClient(),
			parseSegment(form),
			String(form.get('audience_mode') ?? 'all'),
			categoryId
		);
		return { preview, values: echo(form) };
	},

	create: async ({ request, locals }) => {
		const form = await request.formData();
		const values = echo(form);
		if (!values.name.trim()) {
			return fail(400, { error: 'Podaj nazwę kampanii', values });
		}
		if (!values.category_id) {
			return fail(400, { error: 'Wybierz kategorię (sekcję) kampanii', values });
		}

		const db = adminClient();
		const { data, error } = await db
			.from('email_campaigns')
			.insert({
				name: values.name.trim(),
				category_id: values.category_id,
				subject: values.subject.trim() || null,
				from_email: values.from_email.trim() || null,
				segment_json: parseSegment(form),
				audience_mode: values.audience_mode,
				scheduled_at: values.scheduled_at ? new Date(values.scheduled_at).toISOString() : null,
				status: 'draft',
				created_by: locals.user?.id ?? null
			})
			.select('id')
			.single();
		if (error) return fail(500, { error: error.message, values });

		redirect(303, `/campaigns/${data.id}`);
	}
};
