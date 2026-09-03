import { fail } from '@sveltejs/kit';
import { adminClient } from '$lib/server/supabase';
import { PRESET_KINDS, parseHttpUrl, slugifyUtm } from '$lib/utm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const db = adminClient();
	const [{ data: destinations }, { data: presets }] = await Promise.all([
		db.from('utm_destinations').select('*').order('sort_order'),
		db.from('utm_presets').select('*').order('kind').order('sort_order')
	]);
	return { destinations: destinations ?? [], presets: presets ?? [] };
};

export const actions: Actions = {
	/** Nowy serwis = nowa pozycja na liście celów w generatorze. */
	createDestination: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const baseUrl = String(form.get('base_url') ?? '').trim();
		const code = slugifyUtm(String(form.get('code') ?? '') || name);

		if (!name || !code) return fail(400, { error: 'Podaj nazwę serwisu' });
		const parsed = parseHttpUrl(baseUrl);
		if (!parsed) return fail(400, { error: 'Adres startowy musi być poprawnym adresem http(s)' });

		const { error } = await adminClient().from('utm_destinations').insert({
			code,
			name,
			base_url: baseUrl.replace(/\/+$/, ''),
			sort_order: Number.parseInt(String(form.get('sort_order') ?? '100'), 10) || 100,
			notes: String(form.get('notes') ?? '').trim() || null
		});
		if (error) {
			return fail(500, {
				error: error.code === '23505' ? `Serwis o kodzie „${code}” już istnieje` : error.message
			});
		}
		return { success: `Dodano serwis „${name}”` };
	},

	updateDestination: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const baseUrl = String(form.get('base_url') ?? '').trim();
		if (!id) return fail(400, { error: 'Brak identyfikatora serwisu' });
		if (!parseHttpUrl(baseUrl)) {
			return fail(400, { error: 'Adres startowy musi być poprawnym adresem http(s)' });
		}

		const { error } = await adminClient()
			.from('utm_destinations')
			.update({
				name: String(form.get('name') ?? '').trim() || 'Bez nazwy',
				base_url: baseUrl.replace(/\/+$/, ''),
				active: form.get('active') === 'on',
				sort_order: Number.parseInt(String(form.get('sort_order') ?? '100'), 10) || 100,
				notes: String(form.get('notes') ?? '').trim() || null
			})
			.eq('id', id);
		if (error) return fail(500, { error: error.message });
		return { success: 'Zapisano serwis' };
	},

	/** Wartości słownika są normalizowane tą samą funkcją co parametry linku. */
	createPreset: async ({ request }) => {
		const form = await request.formData();
		const kind = String(form.get('kind') ?? '');
		const value = slugifyUtm(String(form.get('value') ?? ''));

		if (!(PRESET_KINDS as readonly string[]).includes(kind)) {
			return fail(400, { error: 'Nieznany rodzaj wpisu' });
		}
		if (!value) return fail(400, { error: 'Podaj wartość' });

		const { error } = await adminClient().from('utm_presets').insert({
			kind,
			value,
			label: String(form.get('label') ?? '').trim() || null,
			sort_order: Number.parseInt(String(form.get('sort_order') ?? '100'), 10) || 100
		});
		if (error) {
			return fail(500, {
				error: error.code === '23505' ? `Wartość „${value}” już jest w tym słowniku` : error.message
			});
		}
		return { success: `Dodano „${value}” do słownika` };
	},

	/**
	 * Wpisy wyłączamy zamiast kasować — wartość mogła zostać użyta w linkach,
	 * które są już w obiegu, a raport ma je nadal poprawnie opisywać.
	 */
	togglePreset: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'Brak identyfikatora wpisu' });

		const { error } = await adminClient()
			.from('utm_presets')
			.update({ active: String(form.get('active') ?? '') === '1' })
			.eq('id', id);
		if (error) return fail(500, { error: error.message });
		return { success: 'Zapisano słownik' };
	}
};
