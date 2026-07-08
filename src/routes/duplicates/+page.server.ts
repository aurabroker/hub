import { fail } from '@sveltejs/kit';
import { adminClient } from '$lib/server/supabase';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const db = adminClient();
	const [{ data: byEmail }, { data: byNip }] = await Promise.all([
		db.from('email_duplicates_by_email').select('*'),
		db.from('email_duplicates_by_nip').select('*')
	]);
	return {
		byEmail: (byEmail ?? []) as { email: string; ile: number; ids: number[]; firmy: string[] }[],
		byNip: (byNip ?? []) as { nip: string; ile: number; ids: number[]; firmy: string[] }[]
	};
};

export const actions: Actions = {
	/**
	 * Oznacza rekord jako duplikat (tag + wpis w historii). Nic nie usuwamy
	 * automatycznie — decyzja o scaleniu należy do operatora.
	 */
	mark: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number.parseInt(String(form.get('id') ?? ''), 10);
		const keepId = String(form.get('keep_id') ?? '');
		if (!Number.isFinite(id)) return fail(400, { error: 'Nieprawidłowy identyfikator rekordu' });

		const db = adminClient();
		const { data: company } = await db
			.from('crm_companies')
			.select('id, tag')
			.eq('id', id)
			.maybeSingle();
		if (!company) return fail(404, { error: `Nie znaleziono rekordu #${id}` });

		const tags = (company.tag ?? '')
			.split(',')
			.map((t: string) => t.trim())
			.filter(Boolean);
		if (!tags.includes('duplikat')) tags.push('duplikat');

		const { error } = await db
			.from('crm_companies')
			.update({ tag: tags.join(', ') })
			.eq('id', id);
		if (error) return fail(500, { error: error.message });

		await db.from('crm_history').insert({
			company_id: id,
			type: 'notatka',
			note: `Aura HUB: oznaczono jako duplikat${keepId ? ` (rekord główny: #${keepId})` : ''}`,
			author: locals.user?.email ?? 'Aura HUB'
		});
		return { success: `Rekord #${id} oznaczony tagiem „duplikat”` };
	}
};
