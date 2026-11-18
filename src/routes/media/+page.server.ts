import { fail } from '@sveltejs/kit';
import {
	MEDIA_CACHE_SECONDS,
	MEDIA_DEFAULT_FOLDERS,
	MEDIA_MAX_BYTES,
	baseName,
	detectMediaType,
	formatBytes,
	hasExifGps,
	imageSize,
	isValidKey,
	isWebp,
	mediaKey,
	publicUrl,
	typeForKey
} from '$lib/media';
import { listMedia, mediaBucket, putMedia, type R2BucketLike } from '$lib/server/media';
import type { Actions, PageServerLoad } from './$types';

const NO_BUCKET =
	'Magazyn mediów nie jest podłączony: w ustawieniach projektu Pages „hub” dodaj binding R2 MEDIA → kubełek aura-media (production i preview), potem zrób redeploy.';

const CACHE_NOTE = `Kopia w pamięci Cloudflare może być jeszcze serwowana do ${MEDIA_CACHE_SECONDS / 60} minut.`;

export const load: PageServerLoad = async ({ platform }) => {
	const bucket = mediaBucket(platform);
	const folders = [...MEDIA_DEFAULT_FOLDERS] as string[];
	if (!bucket) return { configured: false, items: [], folders, listError: '' };

	try {
		const items = await listMedia(bucket);
		const all = [...new Set([...folders, ...items.map((i) => i.folder).filter(Boolean)])];
		return { configured: true, items, folders: all, listError: '' };
	} catch (e) {
		console.error('media: list', e);
		return { configured: true, items: [], folders, listError: 'Nie udało się odczytać listy plików z R2 — odśwież stronę za chwilę.' };
	}
};

/** Odrzuca zbyt duże żądanie, zanim całe ciało trafi do pamięci Workera. */
function tooLarge(request: Request): boolean {
	const len = Number(request.headers.get('content-length') ?? 0);
	return len > MEDIA_MAX_BYTES + 64 * 1024;
}

/** Plik z formularza: niepusty, w limicie, rozpoznany po zawartości, bez lokalizacji GPS. */
async function readUpload(form: FormData) {
	const file = form.get('file');
	if (!(file instanceof File) || file.size === 0) return { error: 'Wybierz plik.' } as const;
	if (file.size > MEDIA_MAX_BYTES) {
		return { error: `Plik ma ${formatBytes(file.size)} — limit to ${formatBytes(MEDIA_MAX_BYTES)}.` } as const;
	}
	const bytes = new Uint8Array(await file.arrayBuffer());
	if (isWebp(bytes)) {
		return {
			error: 'WebP nie wyświetla się w Outlooku na Windows. Zapisz grafikę jako JPG (zdjęcia) albo PNG (logo, grafika z tekstem).'
		} as const;
	}
	const type = detectMediaType(bytes);
	if (!type) return { error: 'Dozwolone są tylko JPG, PNG, GIF i PDF (rozpoznawane po zawartości pliku).' } as const;
	if (hasExifGps(bytes)) {
		return {
			error: 'Zdjęcie zawiera lokalizację GPS, która byłaby publicznie widoczna. Wyeksportuj je bez metadanych (np. z Canvy albo „Usuń lokalizację” w telefonie) i wgraj ponownie.'
		} as const;
	}
	return { file, bytes, type, size: imageSize(bytes) } as const;
}

function r2Error(e: unknown, key?: string) {
	console.error('media: R2', e);
	return fail(502, { error: `Błąd magazynu R2: ${e instanceof Error ? e.message : String(e)}`, key });
}

async function exists(bucket: R2BucketLike, key: string): Promise<boolean> {
	return (await bucket.head(key)) !== null;
}

export const actions: Actions = {
	upload: async ({ request, platform }) => {
		const bucket = mediaBucket(platform);
		if (!bucket) return fail(503, { error: NO_BUCKET });
		if (tooLarge(request)) return fail(413, { error: `Plik przekracza ${formatBytes(MEDIA_MAX_BYTES)}.` });

		const form = await request.formData();
		const upload = await readUpload(form);
		if ('error' in upload) return fail(400, { error: upload.error });

		const folder = String(form.get('folder') ?? '');
		const name = String(form.get('name') ?? '').trim() || baseName(upload.file.name);
		const key = mediaKey(folder, name, upload.type);
		if (!key) {
			return fail(400, { error: 'Folder i nazwa muszą zawierać litery lub cyfry (folder: 2–40 znaków).' });
		}

		try {
			// Nigdy nie nadpisujemy po cichu: ten adres mógł już pójść w wysłanym mailu.
			if (await exists(bucket, key)) {
				return fail(409, {
					error: `Plik ${key} już istnieje. Żeby go wymienić, użyj „Podmień” przy tym pliku albo nadaj inną nazwę.`
				});
			}
			await putMedia(bucket, key, upload.bytes, upload.type, upload.file.name, upload.size);
		} catch (e) {
			return r2Error(e);
		}
		return { success: `Wgrano: ${publicUrl(key)}`, key };
	},

	replace: async ({ request, platform }) => {
		const bucket = mediaBucket(platform);
		if (!bucket) return fail(503, { error: NO_BUCKET });
		if (tooLarge(request)) return fail(413, { error: `Plik przekracza ${formatBytes(MEDIA_MAX_BYTES)}.` });

		const form = await request.formData();
		const key = String(form.get('key') ?? '');
		if (!isValidKey(key)) return fail(400, { error: 'Nieprawidłowy plik do podmiany.' });

		const upload = await readUpload(form);
		if ('error' in upload) return fail(400, { error: upload.error, key });

		// Adres kończy się rozszerzeniem — PNG pod „.jpg” część klientów pocztowych odrzuci.
		const expected = typeForKey(key);
		if (!expected || expected.mime !== upload.type.mime) {
			return fail(400, {
				error: `Pod tym adresem musi zostać plik ${expected?.label ?? 'tego samego typu'}, a wybrany to ${upload.type.label}. Wgraj go jako nowy plik.`,
				key
			});
		}

		try {
			if (!(await exists(bucket, key))) return fail(404, { error: `Nie ma pliku ${key}.`, key });
			await putMedia(bucket, key, upload.bytes, upload.type, upload.file.name, upload.size);
		} catch (e) {
			return r2Error(e, key);
		}
		return {
			success: `Podmieniono: ${publicUrl(key)}. Nowe otwarcia maili pokażą nową wersję; skrzynki, które już pobrały plik (Gmail, Apple Mail), mogą dalej pokazywać starą — błędu w wysłanym mailu nie naprawisz podmianą, wyślij korektę. ${CACHE_NOTE}`,
			key
		};
	},

	remove: async ({ request, platform }) => {
		const bucket = mediaBucket(platform);
		if (!bucket) return fail(503, { error: NO_BUCKET });

		const form = await request.formData();
		const key = String(form.get('key') ?? '');
		if (!isValidKey(key)) return fail(400, { error: 'Nieprawidłowy plik do usunięcia.' });
		// Potwierdzenie dokłada dopiero okno dialogowe w przeglądarce. Formularz wysłany
		// przed załadowaniem skryptów (bez okna) nic nie usuwa.
		if (form.get('confirmed') !== key) {
			return fail(400, { error: 'Usuwanie wymaga potwierdzenia w oknie dialogowym — odśwież stronę i spróbuj jeszcze raz.', key });
		}

		try {
			await bucket.delete(key);
		} catch (e) {
			return r2Error(e, key);
		}
		const effect = typeForKey(key)?.image
			? 'W wysłanych mailach w tym miejscu będzie pusta ramka.'
			: 'Linki do tego pliku w wysłanych mailach przestaną działać (strona błędu 404).';
		return { success: `Usunięto ${key}. ${effect} ${CACHE_NOTE}` };
	}
};
