import { adminClient } from '$lib/server/supabase';
import { collectSmsContacts, parseSmsFilters } from '$lib/server/smsExport';
import { buildSmsapiCsv } from '$lib/sms/csv';
import type { RequestHandler } from './$types';

/** Pobranie pliku CSV do importu kontaktów w SMSAPI. */
export const GET: RequestHandler = async ({ url }) => {
	const filters = parseSmsFilters(url);
	const withBom = url.searchParams.get('bom') === '1';

	const { contacts } = await collectSmsContacts(adminClient(), filters);
	const csv = buildSmsapiCsv(contacts, withBom);

	const stamp = new Date().toISOString().slice(0, 10);
	const filename = `smsapi-kontakty-${stamp}.csv`;

	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'no-store'
		}
	});
};
