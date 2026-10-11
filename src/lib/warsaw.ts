/**
 * Czas warszawski po obu stronach (serwer i przeglądarka).
 *
 * Funkcje Cloudflare liczą w UTC, więc `new Date('2026-10-11T12:00')` z pola
 * <input type="datetime-local"> to na serwerze 12:00 UTC, czyli 14:00 w Warszawie
 * latem. Stałe przesunięcie o godzinę nie działa (zmiana czasu dwa razy w roku),
 * dlatego offset liczymy dla konkretnej chwili przez Intl.
 */

export const WARSAW_TZ = 'Europe/Warsaw';

const partsFormatter = new Intl.DateTimeFormat('en-US', {
	timeZone: WARSAW_TZ,
	hourCycle: 'h23',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit'
});

function warsawParts(ts: number): Record<string, number> {
	const out: Record<string, number> = {};
	for (const p of partsFormatter.formatToParts(new Date(ts))) {
		if (p.type !== 'literal') out[p.type] = Number(p.value);
	}
	return out;
}

/** O ile czas warszawski wyprzedza UTC w danej chwili (ms). */
function warsawOffsetMs(ts: number): number {
	const p = warsawParts(ts);
	const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
	return asUtc - Math.floor(ts / 1000) * 1000;
}

/**
 * Czas „ścienny” w Warszawie (`YYYY-MM-DDTHH:mm`, format datetime-local) → ISO w UTC.
 * Zwraca null dla niepoprawnego wejścia.
 */
export function warsawLocalToIso(local: string): string | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim());
	if (!m) return null;
	const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
	// Dwa przebiegi: offset zależy od chwili, a chwila od offsetu (granica zmiany czasu).
	let ts = wall - warsawOffsetMs(wall);
	ts = wall - warsawOffsetMs(ts);
	return new Date(ts).toISOString();
}

/** ISO (UTC) → wartość pola datetime-local w czasie warszawskim. */
export function isoToWarsawLocal(iso: string | null | undefined): string {
	if (!iso) return '';
	const ts = Date.parse(iso);
	if (!Number.isFinite(ts)) return '';
	const p = warsawParts(ts);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Początek bieżącej doby w Warszawie jako ISO (UTC). */
export function startOfWarsawDayIso(now = Date.now()): string {
	const p = warsawParts(now);
	const pad = (n: number) => String(n).padStart(2, '0');
	return warsawLocalToIso(`${p.year}-${pad(p.month)}-${pad(p.day)}T00:00`) as string;
}
