/**
 * Media do maili: grafiki i PDF-y pod stałym, publicznym adresem.
 *
 * Pliki leżą w kubełku R2 `aura-media`, wystawionym bezpośrednio pod
 * https://media.auraexpert.pl (własna domena kubełka). Adres nie przechodzi
 * przez HUB, więc obrazki w wysłanych mailach działają także wtedy, gdy panel
 * leży, a transfer z R2 nic nie kosztuje. HUB tylko wgrywa, podmienia i usuwa.
 *
 * Konsekwencja, której nie wolno zgubić: **wszystko w kubełku jest publiczne**.
 * Żadnych danych osobowych, polis ani umów — do tego jest prywatna Biblioteka
 * załączników (`/library`).
 *
 * Ten plik nie ma importów, żeby dało się go testować bez środowiska Workers.
 */

export const MEDIA_PUBLIC_BASE = 'https://media.auraexpert.pl';

/** Twardy limit na plik. Grafika do maila powinna mieć ułamek tego. */
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;

/** Od tej wielkości grafika spowalnia otwarcie maila na telefonie — panel ostrzega. */
export const MEDIA_HEAVY_IMAGE_BYTES = 500 * 1024;

/**
 * Pamięć podręczna Cloudflare przed kubełkiem. Krótka, bo podmiana i usunięcie
 * nie czyszczą cache'u brzegowego — po tym czasie stara wersja znika z sieci
 * Cloudflare. Skrzynek, które już pobrały obrazek (Gmail, Apple Mail), to nie dotyczy.
 */
export const MEDIA_CACHE_SECONDS = 600;

/**
 * Szerokość kolumny treści w mailach z edytora HUB: kontener 600 px minus
 * 2 × 32 px marginesu (`src/lib/email/render.ts`). Outlook na Windows ignoruje
 * CSS i rysuje obrazek w rozmiarze z atrybutu `width` — bez niego rozpycha maila.
 */
export const EMAIL_CONTENT_WIDTH = 536;

/** Foldery podpowiadane w formularzu (marki z maili). Można wpisać też własny. */
export const MEDIA_DEFAULT_FOLDERS = [
	'beautypolisa',
	'utratadochodu',
	'auraexpert',
	'auraconsulting',
	'grupowe',
	'gwarancje',
	'rozwod',
	'wspolne'
] as const;

export type MediaType = { mime: string; ext: string; label: string; image: boolean };

/**
 * Dozwolone typy.
 * - Bez SVG: na publicznej domenie to furtka do XSS, a klienci pocztowi go nie pokazują.
 * - Bez WebP: Outlook na Windows (silnik Worda) i starsze Apple Mail go nie wyświetlają,
 *   a odbiorcy firmowi siedzą głównie w Outlooku — zamiast nagłówka byłaby pusta ramka.
 */
const TYPES: Record<string, MediaType> = {
	jpg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPG', image: true },
	png: { mime: 'image/png', ext: 'png', label: 'PNG', image: true },
	gif: { mime: 'image/gif', ext: 'gif', label: 'GIF', image: true },
	pdf: { mime: 'application/pdf', ext: 'pdf', label: 'PDF', image: false }
};

export const MEDIA_ACCEPT = 'image/jpeg,image/png,image/gif,application/pdf,.jpg,.jpeg,.png,.gif,.pdf';

/** Wartość `accept` dla podmiany: tylko typ, który już jest pod tym adresem. */
export function acceptForType(type: MediaType | null): string {
	if (!type) return MEDIA_ACCEPT;
	return type.ext === 'jpg' ? 'image/jpeg,.jpg,.jpeg' : `${type.mime},.${type.ext}`;
}

/**
 * Typ rozpoznany po pierwszych bajtach, nie po rozszerzeniu ani po typie
 * podanym przez przeglądarkę — żeby pod `.jpg` nie trafiła strona HTML.
 */
export function detectMediaType(b: Uint8Array): MediaType | null {
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return TYPES.jpg;
	if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a)
		return TYPES.png;
	if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61)
		return TYPES.gif;
	if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return TYPES.pdf;
	return null;
}

/** WebP rozpoznajemy osobno, żeby powiedzieć wprost, co z nim zrobić. */
export function isWebp(b: Uint8Array): boolean {
	return b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
}

/** Typ wynikający z rozszerzenia klucza (`.jpeg` traktujemy jak `.jpg`). */
export function typeForKey(key: string): MediaType | null {
	const raw = key.split('.').pop()?.toLowerCase();
	if (!raw) return null;
	const ext = raw === 'jpeg' ? 'jpg' : raw;
	return Object.hasOwn(TYPES, ext) ? TYPES[ext] : null;
}

/** Wymiary obrazka z nagłówka (PNG IHDR, GIF, znacznik SOFn w JPEG). Null, gdy nie da się odczytać. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
	const t = detectMediaType(b);
	if (!t || !t.image) return null;
	if (t.ext === 'png' && b.length >= 24) {
		return { width: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], height: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] };
	}
	if (t.ext === 'gif' && b.length >= 10) {
		return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
	}
	if (t.ext === 'jpg') {
		let i = 2;
		while (i + 9 < b.length) {
			if (b[i] !== 0xff) return null;
			const marker = b[i + 1];
			if (marker === 0xff) { i += 1; continue; }
			const len = (b[i + 2] << 8) | b[i + 3];
			// SOF0–SOF15 bez DHT (C4), JPG (C8) i DAC (CC)
			if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
				return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
			}
			if (marker === 0xda || len < 2) return null;
			i += 2 + len;
		}
	}
	return null;
}

/**
 * Czy JPEG niesie w EXIF współrzędne GPS (znacznik 0x8825 w IFD0). Zdjęcie
 * z telefonu zrobione w domu zdradzałoby wtedy publicznie adres — odrzucamy je
 * zamiast po cichu wycinać metadane (to wymagałoby przepisania pliku).
 */
export function hasExifGps(b: Uint8Array): boolean {
	if (detectMediaType(b)?.ext !== 'jpg') return false;
	let i = 2;
	while (i + 4 < b.length) {
		if (b[i] !== 0xff) return false;
		const marker = b[i + 1];
		if (marker === 0xda || marker === 0xd9) return false;
		const len = (b[i + 2] << 8) | b[i + 3];
		if (len < 2) return false;
		if (marker === 0xe1 && len >= 16 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66 && b[i + 8] === 0 && b[i + 9] === 0) {
			const tiff = i + 10;
			const end = Math.min(b.length, i + 2 + len);
			const le = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
			const be = b[tiff] === 0x4d && b[tiff + 1] === 0x4d;
			if (!le && !be) return false;
			const u16 = (p: number) => (le ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
			const u32 = (p: number) => (le ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0 : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0);
			const ifd0 = tiff + u32(tiff + 4);
			if (ifd0 + 2 > end) return false;
			const count = u16(ifd0);
			for (let n = 0; n < count; n++) {
				const entry = ifd0 + 2 + n * 12;
				if (entry + 2 > end) return false;
				if (u16(entry) === 0x8825) return true;
			}
			return false;
		}
		i += 2 + len;
	}
	return false;
}

/**
 * Nazwa do adresu: małe litery ASCII, cyfry i myślniki. Polskie znaki
 * transliterowane („Zdjęcie Łódź” → „zdjecie-lodz”), reszta znika.
 */
export function slugify(value: string): string {
	return value
		.replace(/ł/g, 'l')
		.replace(/Ł/g, 'L')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80)
		.replace(/-+$/g, '');
}

/** Nazwa pliku bez katalogów i bez rozszerzenia. */
export function baseName(filename: string): string {
	const last = filename.split(/[\\/]/).pop() ?? '';
	const dot = last.lastIndexOf('.');
	return dot > 0 ? last.slice(0, dot) : last;
}

/** Nazwa wpisana ręcznie z rozszerzeniem („hero.jpg”) — rozszerzenie odpada, nie wchodzi do adresu. */
export function stripKnownExtension(name: string): string {
	return name.replace(/\.(jpe?g|png|gif|webp|pdf)$/i, '');
}

const FOLDER_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const KEY_RE = /^([a-z0-9][a-z0-9-]{1,39})\/([a-z0-9][a-z0-9-]{0,79})\.(jpg|png|gif|pdf)$/;

/** Folder po normalizacji albo null, gdy nie da się z niego zrobić bezpiecznej nazwy. */
export function normalizeFolder(value: string): string | null {
	const s = slugify(value).slice(0, 40).replace(/-+$/g, '');
	return FOLDER_RE.test(s) ? s : null;
}

/** Klucz w kubełku: `<folder>/<nazwa>.<rozszerzenie>`; null przy nazwie, z której nic nie zostało. */
export function mediaKey(folder: string, name: string, type: MediaType): string | null {
	const f = normalizeFolder(folder);
	const n = slugify(stripKnownExtension(name));
	if (!f || !NAME_RE.test(n)) return null;
	return `${f}/${n}.${type.ext}`;
}

/** Klucz przychodzący z formularza (podmiana, usunięcie) musi mieć dokładnie ten kształt. */
export function isValidKey(key: string): boolean {
	return KEY_RE.test(key);
}

export function publicUrl(key: string): string {
	return `${MEDIA_PUBLIC_BASE}/${key}`;
}

/** Gotowy znacznik do wklejenia w HTML maila — z atrybutem width, którego wymaga Outlook. */
export function imgSnippet(url: string, width = EMAIL_CONTENT_WIDTH, alt = ''): string {
	const safeAlt = alt.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
	return `<img src="${url}" width="${width}" alt="${safeAlt}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;" />`;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
