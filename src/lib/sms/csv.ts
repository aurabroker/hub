/**
 * Generowanie pliku CSV do importu kontaktów w SMSAPI.
 *
 * Konstrukcja wzorowana na pliku importowym SMSAPI:
 *   Imię;Nazwisko;Numer telefonu;Opis;Płeć;Data urodzenia;Miasto;Email;Numer buta
 *   Jan;Kowalski;48500000000;Opis 1;Mężczyzna;14-07-1974;Katowice;jk@op.pl;44
 *
 * - separator: średnik
 * - telefon: 48 + 9 cyfr, bez plusa i spacji
 * - data urodzenia: DD-MM-YYYY (w CRM nie mamy tej danej — kolumna zostaje pusta)
 */

/** Kolejność kolumn = kolejność w pliku wzorcowym (nie zmieniać bez zmiany mapowania w SMSAPI). */
export const SMSAPI_HEADER = [
	'Imię',
	'Nazwisko',
	'Numer telefonu',
	'Opis',
	'Płeć',
	'Data urodzenia',
	'Miasto',
	'Email',
	'Numer buta'
] as const;

export const CSV_SEPARATOR = ';';

export interface SmsContact {
	imie: string;
	nazwisko: string;
	telefon: string;
	opis: string;
	miasto: string;
	email: string;
}

/**
 * Normalizacja numeru do formatu SMSAPI (48XXXXXXXXX).
 * Zwraca null, gdy numer nie jest polskim numerem 9-cyfrowym.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
	const digits = String(raw ?? '').replace(/\D/g, '');
	if (digits.length === 9) return `48${digits}`;
	// 48XXXXXXXXX (11 cyfr) albo 0048XXXXXXXXX (13 cyfr)
	if (digits.length === 11 && digits.startsWith('48')) return digits;
	if (digits.length === 13 && digits.startsWith('0048')) return digits.slice(2);
	// numer krajowy z wiodącym zerem
	if (digits.length === 10 && digits.startsWith('0')) return `48${digits.slice(1)}`;
	return null;
}

/** Czy numer wygląda na polską komórkę (SMS nie dojdzie na stacjonarny). */
export function isMobile(msisdn: string): boolean {
	const local = msisdn.slice(2);
	return /^(45|5[0-9]|6[0-9]|7[0-9]|88)/.test(local);
}

/**
 * Rozbicie pola `contact` ("Jan Kowalski") na imię i nazwisko.
 * Pierwszy człon = imię, reszta = nazwisko (obsługuje nazwiska dwuczłonowe).
 */
export function splitName(contact: string | null | undefined): { imie: string; nazwisko: string } {
	const parts = String(contact ?? '')
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (parts.length === 0) return { imie: '', nazwisko: '' };
	if (parts.length === 1) return { imie: parts[0], nazwisko: '' };
	return { imie: parts[0], nazwisko: parts.slice(1).join(' ') };
}

/** Escapowanie pojedynczej wartości CSV (RFC 4180, separator średnik). */
export function escapeCsv(value: string): string {
	const v = String(value ?? '').replace(/\r?\n/g, ' ').trim();
	if (v.includes(CSV_SEPARATOR) || v.includes('"')) {
		return `"${v.replace(/"/g, '""')}"`;
	}
	return v;
}

/**
 * Buduje zawartość pliku CSV.
 * `withBom` dodaje znacznik UTF-8 — Excel bez niego pokazuje polskie znaki jako krzaki.
 */
export function buildSmsapiCsv(contacts: SmsContact[], withBom = false): string {
	const lines: string[] = [SMSAPI_HEADER.join(CSV_SEPARATOR)];

	for (const c of contacts) {
		lines.push(
			[
				escapeCsv(c.imie),
				escapeCsv(c.nazwisko),
				escapeCsv(c.telefon),
				escapeCsv(c.opis),
				'', // Płeć — brak danych w CRM
				'', // Data urodzenia — brak danych w CRM
				escapeCsv(c.miasto),
				escapeCsv(c.email),
				'' // Numer buta — pole przykładowe ze wzorca
			].join(CSV_SEPARATOR)
		);
	}

	// CRLF = standard CSV, bezpieczne dla Excela i importerów.
	return (withBom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}
