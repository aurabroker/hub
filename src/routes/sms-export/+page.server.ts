import { adminClient } from '$lib/server/supabase';
import { collectSmsContacts, parseSmsFilters } from '$lib/server/smsExport';
import { CANONICAL_CODES, CODE_LABELS } from '$lib/categories';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const filters = parseSmsFilters(url);
	const { contacts, stats } = await collectSmsContacts(adminClient(), filters);

	return {
		stats,
		filters: {
			kategorie: filters.kategorie ?? [],
			tylkoZgoda: filters.tylkoZgoda !== false,
			tylkoKomorki: filters.tylkoKomorki !== false,
			deduplikuj: filters.deduplikuj !== false
		},
		kategorie: CANONICAL_CODES.map((code) => ({ code, label: CODE_LABELS[code] })),
		// Podgląd pierwszych wierszy — kontrola przed pobraniem całości.
		podglad: contacts.slice(0, 8),
		query: url.search
	};
};
