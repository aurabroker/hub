import { adminClient } from '$lib/server/supabase';
import type { PageServerLoad } from './$types';

const STATUSES = ['queued', 'sending', 'sent', 'failed', 'bounced', 'skipped'];

export const load: PageServerLoad = async ({ url }) => {
	const db = adminClient();
	const status = url.searchParams.get('status');
	const source = url.searchParams.get('source');
	const categoryId = url.searchParams.get('category');
	const search = url.searchParams.get('q')?.trim();

	let query = db
		.from('email_messages')
		.select(
			'id, created_at, to_email, company_id, source, status, error, attempts, resend_id, sent_at, delivered_at, opened_at, clicked_at, email_categories ( code, name ), email_campaigns ( id, name )'
		)
		.order('created_at', { ascending: false })
		.limit(200);
	if (status && STATUSES.includes(status)) query = query.eq('status', status);
	if (source === 'campaign' || source === 'quick_send') query = query.eq('source', source);
	if (categoryId) query = query.eq('category_id', categoryId);
	if (search) query = query.ilike('to_email', `%${search}%`);

	const [{ data: messages }, { data: categories }, { data: statusRows }] = await Promise.all([
		query,
		db.from('email_categories').select('id, code, name').order('sort_order'),
		db.from('email_messages').select('status')
	]);

	const counts: Record<string, number> = {};
	for (const row of statusRows ?? []) {
		counts[row.status as string] = (counts[row.status as string] ?? 0) + 1;
	}

	return {
		messages: messages ?? [],
		categories: categories ?? [],
		counts,
		filters: { status, source, category: categoryId, q: search ?? '' }
	};
};
