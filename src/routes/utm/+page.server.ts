import { fail } from '@sveltejs/kit';
import { adminClient } from '$lib/server/supabase';
import {
	bitlyClicks,
	bitlyConfigured,
	bitlyMonthlyLimit,
	bitlyShorten,
	bitlyUsageThisMonth,
	shortLinkBase
} from '$lib/server/utm';
import { buildUtmUrl, normalizeUtmParts, parseHttpUrl, randomSlug, validateUtm } from '$lib/utm';
import type { Actions, PageServerLoad } from './$types';

/** Ile linków pokazujemy na liście. Starsze są dostępne przez wyszukiwarkę. */
const PAGE_SIZE = 200;

export const load: PageServerLoad = async ({ url, locals }) => {
	const db = adminClient();
	const showArchived = url.searchParams.get('archived') === '1';
	const search = (url.searchParams.get('q') ?? '').trim();

	let query = db
		.from('utm_links')
		.select('*')
		.eq('archived', showArchived)
		.order('created_at', { ascending: false })
		.limit(PAGE_SIZE);

	if (search) {
		const safe = search.replace(/[%,()]/g, ' ');
		query = query.or(`label.ilike.%${safe}%,utm_campaign.ilike.%${safe}%,final_url.ilike.%${safe}%`);
	}

	const [{ data: links }, { data: destinations }, { data: presets }, { data: categories }] =
		await Promise.all([
			query,
			db.from('utm_destinations').select('*').eq('active', true).order('sort_order'),
			db.from('utm_presets').select('*').eq('active', true).order('kind').order('sort_order'),
			db.from('email_categories').select('id, code, name').eq('active', true).order('sort_order')
		]);

	// Statystyki kliknięć są osobnym widokiem (nie relacją), więc sklejamy je w kodzie.
	const ids = (links ?? []).map((l) => l.id as string);
	const statsById = new Map<string, Record<string, unknown>>();
	if (ids.length) {
		const { data: stats } = await db.from('utm_link_stats').select('*').in('link_id', ids);
		for (const row of stats ?? []) statsById.set(row.link_id as string, row);
	}

	return {
		links: (links ?? []).map((link) => {
			const stats = statsById.get(link.id as string);
			return {
				...link,
				clicks_total: Number(stats?.clicks_total ?? 0),
				clicks_7d: Number(stats?.clicks_7d ?? 0),
				clicks_30d: Number(stats?.clicks_30d ?? 0),
				last_click_at: (stats?.last_click_at as string | null) ?? null
			};
		}),
		destinations: destinations ?? [],
		presets: presets ?? [],
		categories: categories ?? [],
		shortBase: shortLinkBase(url.origin),
		bitly: {
			configured: bitlyConfigured(),
			used: await bitlyUsageThisMonth(db),
			limit: bitlyMonthlyLimit()
		},
		filters: { showArchived, search },
		userId: locals.user?.id ?? null
	};
};

type PostgrestErrorLike = { code?: string; message?: string; details?: string };

function violates(error: PostgrestErrorLike, constraint: string): boolean {
	if (error.code !== '23505') return false;
	return `${error.message ?? ''} ${error.details ?? ''}`.includes(constraint);
}

const isSlugCollision = (error: PostgrestErrorLike) => violates(error, 'utm_links_slug_key');
const isParamsCollision = (error: PostgrestErrorLike) => violates(error, 'utm_links_params_uniq');

/** Wspólne czytanie parametrów UTM z formularza. */
function readParts(form: FormData) {
	const extra: Record<string, string> = {};
	const rawExtra = String(form.get('extra_params') ?? '').trim();
	// Format „klucz=wartość" po jednym w linii — prostszy dla operatora niż JSON.
	for (const line of rawExtra.split('\n')) {
		const idx = line.indexOf('=');
		if (idx <= 0) continue;
		const key = line.slice(0, idx).trim();
		const value = line.slice(idx + 1).trim();
		if (key && value) extra[key] = value;
	}
	return {
		source: String(form.get('utm_source') ?? ''),
		medium: String(form.get('utm_medium') ?? ''),
		campaign: String(form.get('utm_campaign') ?? ''),
		content: String(form.get('utm_content') ?? ''),
		term: String(form.get('utm_term') ?? ''),
		extra
	};
}

export const actions: Actions = {
	/** Tworzy link: normalizuje parametry, skleja adres i nadaje slug krótkiego linku. */
	create: async ({ request, locals }) => {
		const form = await request.formData();
		const db = adminClient();

		const destinationId = String(form.get('destination_id') ?? '').trim();
		let baseUrl = String(form.get('base_url') ?? '').trim();

		if (destinationId) {
			const { data: destination } = await db
				.from('utm_destinations')
				.select('base_url')
				.eq('id', destinationId)
				.maybeSingle();
			if (!destination) return fail(400, { error: 'Nie znaleziono wybranego serwisu' });
			// Ścieżka dopisana ręcznie ma pierwszeństwo nad adresem startowym serwisu.
			baseUrl = baseUrl || (destination.base_url as string);
		}
		if (!baseUrl) return fail(400, { error: 'Wskaż serwis albo wpisz adres docelowy' });

		const parts = readParts(form);
		const invalid = validateUtm(baseUrl, parts);
		if (invalid) return fail(400, { error: invalid });

		const normalized = normalizeUtmParts(parts);
		const label = String(form.get('label') ?? '').trim() || normalized.campaign;
		const categoryId = String(form.get('category_id') ?? '').trim();

		const row = {
			label,
			destination_id: destinationId || null,
			base_url: baseUrl,
			utm_source: normalized.source,
			utm_medium: normalized.medium,
			utm_campaign: normalized.campaign,
			utm_content: normalized.content,
			utm_term: normalized.term,
			extra_params: normalized.extra,
			final_url: buildUtmUrl(baseUrl, parts),
			category_id: categoryId || null,
			notes: String(form.get('notes') ?? '').trim() || null,
			created_by: locals.user?.id ?? null
		};

		// Dwa różne unikalne indeksy zwracają ten sam kod 23505: komplet parametrów
		// (błąd operatora) i slug (kolizja losowania). Rozróżniamy je po nazwie
		// więzu — przy kolizji sluga po prostu losujemy nowy.
		let error = null;
		for (let attempt = 0; attempt < 3; attempt++) {
			({ error } = await db.from('utm_links').insert({ ...row, slug: randomSlug() }));
			if (!error || !isSlugCollision(error)) break;
		}

		if (error) {
			return fail(500, {
				error: isParamsCollision(error)
					? 'Taki komplet parametrów już istnieje — poszukaj go na liście zamiast tworzyć duplikat'
					: error.message
			});
		}
		return { success: `Utworzono link „${label}”` };
	},

	/** Edycja opisu. Parametrów UTM nie zmieniamy — link mógł już trafić do obiegu. */
	update: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'Brak identyfikatora linku' });

		const categoryId = String(form.get('category_id') ?? '').trim();
		const external = String(form.get('short_url_external') ?? '').trim();
		if (external && !parseHttpUrl(external)) {
			return fail(400, { error: 'Krótki link zewnętrzny musi być adresem http(s)' });
		}

		const { error } = await adminClient()
			.from('utm_links')
			.update({
				label: String(form.get('label') ?? '').trim() || 'Bez nazwy',
				notes: String(form.get('notes') ?? '').trim() || null,
				category_id: categoryId || null,
				short_url_external: external || null
			})
			.eq('id', id);
		if (error) return fail(500, { error: error.message });
		return { success: 'Zapisano zmiany' };
	},

	/** Archiwizacja zwalnia komplet parametrów, ale krótki link nadal przekierowuje. */
	archive: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const archived = String(form.get('archived') ?? '') === '1';
		if (!id) return fail(400, { error: 'Brak identyfikatora linku' });

		const { error } = await adminClient().from('utm_links').update({ archived }).eq('id', id);
		if (error) return fail(500, { error: error.message });
		return {
			success: archived
				? 'Link zarchiwizowany — krótki adres i kod QR nadal działają'
				: 'Link przywrócony'
		};
	},

	/**
	 * Skraca link w Bitly. Świadome kliknięcie, nigdy automat — plan Starter ma
	 * 50 linków na miesiąc i automatyczne skracanie wyczerpałoby limit w kilka dni.
	 */
	shorten: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'Brak identyfikatora linku' });

		const db = adminClient();
		const { data: link } = await db
			.from('utm_links')
			.select('id, label, final_url, bitly_id, short_url_external')
			.eq('id', id)
			.maybeSingle();
		if (!link) return fail(404, { error: 'Nie znaleziono linku' });
		if (link.bitly_id) return fail(400, { error: 'Ten link ma już skrót Bitly' });

		const limit = bitlyMonthlyLimit();
		const used = await bitlyUsageThisMonth(db);
		if (used >= limit) {
			return fail(400, {
				error: `Miesięczny limit Bitly wyczerpany (${used} z ${limit}). Skróć link ręcznie albo poczekaj do nowego miesiąca.`
			});
		}

		const result = await bitlyShorten(link.final_url as string);
		if (!result.ok) return fail(502, { error: result.error });

		const { error } = await db
			.from('utm_links')
			.update({
				bitly_id: result.id,
				short_url_external: result.link,
				bitly_shortened_at: new Date().toISOString(),
				bitly_clicks: 0,
				bitly_synced_at: new Date().toISOString()
			})
			.eq('id', id);
		if (error) return fail(500, { error: error.message });

		return { success: `Skrócono „${link.label}” → ${result.link} (${used + 1} z ${limit} w tym miesiącu)` };
	},

	/**
	 * Pobiera liczniki kliknięć z Bitly. Krótkie linki Bitly celują prosto
	 * w adres docelowy, więc ich kliknięcia nie przechodzą przez /l/ i nie ma
	 * ich w utm_clicks — bez tej synchronizacji raport byłby niepełny.
	 */
	syncBitly: async () => {
		const db = adminClient();
		const { data: links } = await db
			.from('utm_links')
			.select('id, bitly_id')
			.not('bitly_id', 'is', null);

		if (!links?.length) return { success: 'Brak linków skróconych w Bitly' };

		let synced = 0;
		const problems: string[] = [];
		for (const link of links) {
			const result = await bitlyClicks(link.bitly_id as string);
			if (!result.ok) {
				problems.push(result.error);
				// Jeden powtarzalny błąd (brak API w planie, zły token) dotyczy
				// wszystkich linków — nie ma sensu przepalać limitu na resztę.
				break;
			}
			await db
				.from('utm_links')
				.update({ bitly_clicks: result.clicks, bitly_synced_at: new Date().toISOString() })
				.eq('id', link.id);
			synced++;
		}

		if (problems.length && !synced) return fail(502, { error: problems[0] });
		return {
			success: problems.length
				? `Zsynchronizowano ${synced} z ${links.length}. Przerwano: ${problems[0]}`
				: `Zsynchronizowano liczniki Bitly dla ${synced} linków`
		};
	}
};
