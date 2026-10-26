/**
 * Polskie formatowanie liczb i dat dla zakładki Google Ads.
 *
 * Intl z locale pl-PL NIE grupuje liczb czterocyfrowych („1234,56 zł"), bo
 * tak każe norma dla tekstu ciągłego. W tabeli kosztów to przeszkadza: 1234
 * i 12 345 stoją jedno pod drugim i oko nie łapie rzędu wielkości. Dlatego
 * grupowanie robimy sami, od czterech cyfr w górę.
 *
 * Separatorem tysięcy i spacją przed „zł" jest spacja niełamiąca (U+00A0) —
 * zwykła pozwala przeglądarce złamać kwotę w pół między wierszami.
 *
 * Brak wartości (null, undefined, NaN, tekst niebędący liczbą) to zawsze
 * półpauza „–", nigdy „0". Zero to informacja, brak to brak informacji.
 */

/** Półpauza (U+2013) — znak braku wartości. */
export const DASH = '–';
/** Spacja niełamiąca (U+00A0) — separator tysięcy i odstęp przed jednostką. */
export const NBSP = ' ';
/**
 * Minus (U+2212) zamiast łącznika. Ma szerokość plusa, więc „+12,3%"
 * i „−12,3%" w kolumnie trzymają tę samą szerokość, i nie myli się z „–".
 */
export const MINUS = '−';

/**
 * Liczba z dowolnego wejścia albo null. Skrypt Google Ads przysyła liczby,
 * ale gdyby kiedyś przysłał tekst („170.4"), lepiej go przeczytać niż
 * pokazać pustkę.
 */
export function toNumber(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

/** Grupuje cyfry części całkowitej po trzy, od prawej. */
function groupDigits(digits: string): string {
	return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/**
 * Liczba z ustaloną liczbą miejsc po przecinku, z grupowaniem tysięcy.
 * Wynik zaokrąglony do zera nie dostaje znaku („−0,00" nic nie znaczy).
 */
export function formatNumber(value: unknown, decimals = 0): string {
	const n = toNumber(value);
	if (n === null) return DASH;
	const fixed = Math.abs(n).toFixed(decimals);
	const [int, frac] = fixed.split('.');
	const isZero = Number(fixed) === 0;
	const sign = n < 0 && !isZero ? MINUS : '';
	return `${sign}${groupDigits(int)}${frac ? `,${frac}` : ''}`;
}

/** Liczba całkowita: „1 234". */
export function formatInt(value: unknown): string {
	const n = toNumber(value);
	return n === null ? DASH : formatNumber(Math.round(n), 0);
}

/**
 * Liczba, która bywa ułamkowa (konwersje — Google dzieli je przy atrybucji):
 * całkowita bez przecinka, ułamkowa z najwyżej dwoma miejscami, bez zbędnych zer.
 */
export function formatCount(value: unknown): string {
	const n = toNumber(value);
	if (n === null) return DASH;
	if (Number.isInteger(n)) return formatNumber(n, 0);
	return formatNumber(n, 2).replace(/,?0+$/, '');
}

/** Kwota w złotych: „1 234,56 zł". */
export function formatMoney(value: unknown): string {
	const n = toNumber(value);
	return n === null ? DASH : `${formatNumber(n, 2)}${NBSP}zł`;
}

/** Ułamek jako procent z jednym miejscem: 0.0806 → „8,1%". */
export function formatPercent(fraction: unknown): string {
	const n = toNumber(fraction);
	return n === null ? DASH : `${formatNumber(n * 100, 1)}%`;
}

/**
 * Zmiana ze znakiem: plus dla wzrostu, minus dla spadku. Znak zależy od
 * wartości PO zaokrągleniu — „+0,0%" sugerowałoby ruch, którego nie widać.
 */
function signed(n: number, suffix: string): string {
	const rounded = Number(Math.abs(n).toFixed(1));
	const sign = rounded === 0 ? '' : n > 0 ? '+' : MINUS;
	return `${sign}${formatNumber(Math.abs(n), 1)}${suffix}`;
}

/** Zmiana względna (0.123 → „+12,3%"). */
export function formatChangePct(ratio: unknown): string {
	const n = toNumber(ratio);
	return n === null ? DASH : signed(n * 100, '%');
}

/**
 * Zmiana udziału w punktach procentowych. Wejściem jest różnica ułamków
 * (0.08 → „+8,0 pp"): z 25% na 33% to osiem punktów, a nie 32% wzrostu.
 */
export function formatPp(diff: unknown): string {
	const n = toNumber(diff);
	return n === null ? DASH : signed(n * 100, `${NBSP}pp`);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Czy tekst to prawdziwa data RRRR-MM-DD. Sam wzorzec przepuściłby
 * 2026-02-30, dlatego składamy datę i sprawdzamy, czy wróciły te same liczby.
 */
export function isIsoDate(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const m = ISO_DATE.exec(value);
	if (!m) return false;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const date = new Date(Date.UTC(y, mo - 1, d));
	return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * Data RRRR-MM-DD → „DD.MM.RRRR". Czytamy ją z tekstu, a nie przez `new Date`,
 * bo `new Date('2026-11-01')` to północ UTC i w strefie na zachód od Greenwich
 * zrobiłby się z niej 31 października.
 */
export function formatDate(value: unknown): string {
	if (!isIsoDate(value)) return DASH;
	const [y, m, d] = value.split('-');
	return `${d}.${m}.${y}`;
}

/** Krótka data do osi wykresu: „01.11". */
export function formatShortDate(value: unknown): string {
	if (!isIsoDate(value)) return DASH;
	const [, m, d] = value.split('-');
	return `${d}.${m}`;
}

/** Zakres dat: „26.10.2026 – 01.11.2026". */
export function formatPeriod(start: unknown, end: unknown): string {
	return `${formatDate(start)} ${DASH} ${formatDate(end)}`;
}

/** Przesuwa datę RRRR-MM-DD o podaną liczbę dni, w UTC (bez zmiany czasu). */
export function shiftIsoDate(value: string, days: number): string | null {
	if (!isIsoDate(value)) return null;
	const [y, m, d] = value.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const warsawFormatter = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Europe/Warsaw',
	hourCycle: 'h23',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit'
});

/** Chwila (ISO, UTC) → „DD.MM.RRRR GG:MM" w czasie warszawskim. */
export function formatWarsawDateTime(value: unknown): string {
	if (typeof value !== 'string' || !value) return DASH;
	const ts = Date.parse(value);
	if (!Number.isFinite(ts)) return DASH;
	const p: Record<string, string> = {};
	for (const part of warsawFormatter.formatToParts(new Date(ts))) p[part.type] = part.value;
	return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}

/**
 * Data i godzina z dziennika zmian Google Ads („2026-10-27 10:12:33", już
 * w strefie konta) → „27.10.2026 10:12". Bez przeliczania stref.
 */
export function formatLocalDateTime(value: unknown): string {
	if (typeof value !== 'string') return DASH;
	const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value.trim());
	if (!m) return value.trim() || DASH;
	return `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}`;
}

/** Tekst albo półpauza. */
export function formatText(value: unknown): string {
	if (typeof value === 'string') return value.trim() || DASH;
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	return DASH;
}

/** Wartość logiczna jako „tak" / „nie"; brak to półpauza, a nie „nie". */
export function formatYesNo(value: unknown): string {
	if (value === true) return 'tak';
	if (value === false) return 'nie';
	return DASH;
}
