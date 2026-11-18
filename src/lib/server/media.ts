/**
 * Dostęp do kubełka R2 z mediami (binding `MEDIA` w projekcie Pages „hub”).
 * Logika nazw i typów jest w `$lib/media` — tu tylko zapis, odczyt listy i usuwanie.
 */
import { MEDIA_CACHE_SECONDS, type MediaType, publicUrl, typeForKey } from '$lib/media';

/** Minimalny kształt R2 potrzebny HUB-owi — bez dokładania typów Workers do całego projektu. */
export interface R2ObjectLike {
	key: string;
	size: number;
	uploaded: Date;
	etag?: string;
	httpMetadata?: { contentType?: string };
	customMetadata?: Record<string, string>;
}

export interface R2BucketLike {
	list(options?: { cursor?: string; limit?: number; include?: ('httpMetadata' | 'customMetadata')[] }): Promise<{
		objects: R2ObjectLike[];
		truncated: boolean;
		cursor?: string;
	}>;
	head(key: string): Promise<R2ObjectLike | null>;
	put(
		key: string,
		value: ArrayBuffer | Uint8Array,
		options?: {
			httpMetadata?: { contentType?: string; cacheControl?: string; contentDisposition?: string };
			customMetadata?: Record<string, string>;
		}
	): Promise<R2ObjectLike | null>;
	delete(key: string): Promise<void>;
}

export type MediaItem = {
	key: string;
	folder: string;
	name: string;
	url: string;
	size: number;
	uploaded: string;
	etag: string;
	type: string;
	image: boolean;
	originalName: string;
	width: number | null;
	height: number | null;
};

export function mediaBucket(platform: App.Platform | undefined): R2BucketLike | null {
	return platform?.env?.MEDIA ?? null;
}

/** Wszystkie pliki, najnowsze na górze. Kubełek jest mały, więc bez stronicowania w panelu. */
export async function listMedia(bucket: R2BucketLike): Promise<MediaItem[]> {
	const items: MediaItem[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ cursor, limit: 1000, include: ['httpMetadata', 'customMetadata'] });
		for (const o of page.objects) {
			const slash = o.key.indexOf('/');
			const t = typeForKey(o.key);
			items.push({
				key: o.key,
				folder: slash > 0 ? o.key.slice(0, slash) : '',
				name: slash > 0 ? o.key.slice(slash + 1) : o.key,
				url: publicUrl(o.key),
				size: o.size,
				uploaded: new Date(o.uploaded).toISOString(),
				etag: o.etag ?? '',
				type: o.httpMetadata?.contentType ?? t?.mime ?? '',
				image: t?.image ?? false,
				originalName: o.customMetadata?.originalName ?? '',
				width: Number(o.customMetadata?.width) || null,
				height: Number(o.customMetadata?.height) || null
			});
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return items.sort((a, b) => b.uploaded.localeCompare(a.uploaded));
}

/**
 * Zapis pliku. Pamięć podręczna krótka (MEDIA_CACHE_SECONDS), bo podmiana
 * i usunięcie nie czyszczą cache'u Cloudflare — po tym czasie znika stara wersja.
 */
export async function putMedia(
	bucket: R2BucketLike,
	key: string,
	bytes: Uint8Array,
	type: MediaType,
	originalName: string,
	size: { width: number; height: number } | null = null
): Promise<void> {
	const filename = key.split('/').pop() ?? 'plik';
	await bucket.put(key, bytes, {
		httpMetadata: {
			contentType: type.mime,
			cacheControl: `public, max-age=${MEDIA_CACHE_SECONDS}`,
			...(type.image ? {} : { contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(filename)}` })
		},
		// Tylko nazwa pliku z dysku — bez adresu osoby wgrywającej, bo metadane bywają widoczne publicznie.
		customMetadata: {
			originalName: originalName.slice(0, 200),
			...(size ? { width: String(size.width), height: String(size.height) } : {})
		}
	});
}
