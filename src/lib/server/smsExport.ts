import type { SupabaseClient } from '@supabase/supabase-js';
import { hasRodoConsent, normalizeInterest, CODE_LABELS } from '$lib/categories';
import { isMobile, normalizePhone, splitName, type SmsContact } from '$lib/sms/csv';

export interface SmsExportFilters {
	/** Kody kanoniczne kategorii; puste = wszystkie. */
	kategorie?: string[];
	/** Pomijaj kontakty bez zgody RODO (wyraźny sprzeciw). */
	tylkoZgoda?: boolean;
	/** Pomijaj numery, które nie wyglądają na komórki. */
	tylkoKomorki?: boolean;
	/** Usuwaj powtórzone numery (pierwszy wygrywa). */
	deduplikuj?: boolean;
}

export interface SmsExportStats {
	kontaktow: number;
	bezNumeru: number;
	stacjonarne: number;
	bezZgody: number;
	duplikaty: number;
	doEksportu: number;
}

const COLUMNS = 'id, company, contact, phone, email, city, ubezpieczenie, rodo';

/**
 * Dobiera kontakty do eksportu SMSAPI i liczy, co odpadło i dlaczego.
 * Jedno źródło prawdy dla podglądu i pobierania pliku.
 */
export async function collectSmsContacts(
	db: SupabaseClient,
	filters: SmsExportFilters
): Promise<{ contacts: SmsContact[]; stats: SmsExportStats }> {
	const { data, error } = await db.from('crm_companies').select(COLUMNS).limit(20000);
	if (error) throw new Error(`crm_companies: ${error.message}`);

	const rows = (data ?? []) as {
		id: number;
		company: string | null;
		contact: string | null;
		phone: string | null;
		email: string | null;
		city: string | null;
		ubezpieczenie: string | null;
		rodo: string | null;
	}[];

	const wanted = new Set(filters.kategorie ?? []);
	const stats: SmsExportStats = {
		kontaktow: 0,
		bezNumeru: 0,
		stacjonarne: 0,
		bezZgody: 0,
		duplikaty: 0,
		doEksportu: 0
	};

	const seen = new Set<string>();
	const contacts: SmsContact[] = [];

	for (const row of rows) {
		const code = normalizeInterest(row.ubezpieczenie);
		if (wanted.size > 0 && !wanted.has(code)) continue;
		stats.kontaktow++;

		if (filters.tylkoZgoda !== false && !hasRodoConsent(row.rodo)) {
			stats.bezZgody++;
			continue;
		}

		const msisdn = normalizePhone(row.phone);
		if (!msisdn) {
			stats.bezNumeru++;
			continue;
		}
		if (filters.tylkoKomorki !== false && !isMobile(msisdn)) {
			stats.stacjonarne++;
			continue;
		}
		if (filters.deduplikuj !== false) {
			if (seen.has(msisdn)) {
				stats.duplikaty++;
				continue;
			}
			seen.add(msisdn);
		}

		const { imie, nazwisko } = splitName(row.contact);
		// Opis daje kontekst w panelu SMSAPI: firma + kategoria zapytania.
		const opis = [row.company?.trim(), CODE_LABELS[code]].filter(Boolean).join(' — ');

		contacts.push({
			imie,
			nazwisko,
			telefon: msisdn,
			opis,
			miasto: row.city?.trim() ?? '',
			email: row.email?.trim() ?? ''
		});
	}

	stats.doEksportu = contacts.length;
	return { contacts, stats };
}

/** Odczyt filtrów z query stringa — wspólny dla strony i endpointu pobierania. */
export function parseSmsFilters(url: URL): SmsExportFilters {
	return {
		kategorie: url.searchParams.getAll('kat').filter(Boolean),
		tylkoZgoda: url.searchParams.get('zgoda') !== '0',
		tylkoKomorki: url.searchParams.get('komorki') !== '0',
		deduplikuj: url.searchParams.get('dedup') !== '0'
	};
}
