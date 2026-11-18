import { describe, expect, it } from 'vitest';
import { detectMediaType } from '$lib/media';
import { listMedia, putMedia, type R2BucketLike, type R2ObjectLike } from './media';

function fakeBucket(pages: R2ObjectLike[][]) {
	const puts: { key: string; options: unknown }[] = [];
	const cursors: (string | undefined)[] = [];
	const bucket: R2BucketLike = {
		async list(opts) {
			cursors.push(opts?.cursor);
			const i = opts?.cursor ? Number(opts.cursor) : 0;
			return { objects: pages[i], truncated: i < pages.length - 1, cursor: String(i + 1) };
		},
		async head() {
			return null;
		},
		async put(key, _value, options) {
			puts.push({ key, options });
			return null;
		},
		async delete() {}
	};
	return { bucket, puts, cursors };
}

const obj = (key: string, uploaded: string, meta: Record<string, string> = {}): R2ObjectLike => ({
	key,
	size: 100,
	uploaded: new Date(uploaded),
	etag: 'e',
	customMetadata: meta
});

describe('listMedia', () => {
	it('przechodzi wszystkie strony i sortuje od najnowszych', async () => {
		const { bucket, cursors } = fakeBucket([
			[obj('beautypolisa/a.jpg', '2026-11-01T10:00:00Z')],
			[obj('utratadochodu/b.pdf', '2026-11-18T10:00:00Z', { width: '', originalName: 'B.pdf' })]
		]);
		const items = await listMedia(bucket);
		expect(cursors).toEqual([undefined, '1']);
		expect(items.map((i) => i.key)).toEqual(['utratadochodu/b.pdf', 'beautypolisa/a.jpg']);
		expect(items[0]).toMatchObject({ folder: 'utratadochodu', name: 'b.pdf', image: false, type: 'application/pdf', width: null });
		expect(items[1]).toMatchObject({ image: true, url: 'https://media.auraexpert.pl/beautypolisa/a.jpg' });
	});
});

describe('putMedia', () => {
	it('ustawia typ, krótki cache, wymiary; disposition tylko dla PDF', async () => {
		const { bucket, puts } = fakeBucket([[]]);
		const jpg = detectMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0]))!;
		const pdf = detectMediaType(new TextEncoder().encode('%PDF-1.7'))!;
		await putMedia(bucket, 'beautypolisa/hero.jpg', new Uint8Array(4), jpg, 'x'.repeat(300), { width: 1200, height: 600 });
		await putMedia(bucket, 'beautypolisa/regulamin.pdf', new Uint8Array(4), pdf, 'Regulamin.pdf');

		const [img, doc] = puts.map((p) => p.options as { httpMetadata: Record<string, string>; customMetadata: Record<string, string> });
		expect(img.httpMetadata.contentType).toBe('image/jpeg');
		expect(img.httpMetadata.cacheControl).toBe('public, max-age=600');
		expect(img.httpMetadata.contentDisposition).toBeUndefined();
		expect(img.customMetadata).toEqual({ originalName: 'x'.repeat(200), width: '1200', height: '600' });
		expect(doc.httpMetadata.contentDisposition).toBe("inline; filename*=UTF-8''regulamin.pdf");
		expect(doc.customMetadata).toEqual({ originalName: 'Regulamin.pdf' });
	});
});
