import { describe, expect, it } from 'vitest';
import {
	acceptForType,
	baseName,
	detectMediaType,
	formatBytes,
	hasExifGps,
	imageSize,
	imgSnippet,
	isValidKey,
	isWebp,
	mediaKey,
	normalizeFolder,
	publicUrl,
	slugify,
	stripKnownExtension,
	typeForKey
} from './media';

const pad = (b: number[], n = 32) => new Uint8Array([...b, ...new Array(n).fill(0)]);
const JPG_SOI = [0xff, 0xd8, 0xff];
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Minimalny PNG: sygnatura + IHDR z wymiarami. */
function png(width: number, height: number): Uint8Array {
	const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
	return new Uint8Array([...PNG_SIG, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...u32(width), ...u32(height), 8, 6, 0, 0, 0]);
}

/** Minimalny JPEG: SOI, opcjonalny APP1 z EXIF (IFD0 z podanymi znacznikami), SOF0 z wymiarami. */
function jpeg(width: number, height: number, exifTags: number[] | null = null, littleEndian = true): Uint8Array {
	const out: number[] = [0xff, 0xd8];
	if (exifTags) {
		const le16 = (v: number) => (littleEndian ? [v & 255, v >> 8] : [v >> 8, v & 255]);
		const le32 = (v: number) => (littleEndian ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
		const tiff = [...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]), ...le16(42), ...le32(8), ...le16(exifTags.length)];
		for (const tag of exifTags) tiff.push(...le16(tag), ...le16(4), ...le32(1), ...le32(0));
		tiff.push(...le32(0));
		const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
		const len = body.length + 2;
		out.push(0xff, 0xe1, len >> 8, len & 255, ...body);
	}
	out.push(0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
	out.push(0xff, 0xda, 0, 2, 0xff, 0xd9);
	return new Uint8Array(out);
}

describe('detectMediaType', () => {
	it('rozpoznaje dozwolone typy po zawartości', () => {
		expect(detectMediaType(pad(JPG_SOI))?.ext).toBe('jpg');
		expect(detectMediaType(pad(PNG_SIG))?.ext).toBe('png');
		expect(detectMediaType(pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))?.ext).toBe('gif');
		expect(detectMediaType(new TextEncoder().encode('%PDF-1.7\n'))?.ext).toBe('pdf');
	});

	it('odrzuca HTML, SVG, WebP i pliki udające obrazek', () => {
		expect(detectMediaType(new TextEncoder().encode('<!doctype html><script>'))).toBeNull();
		expect(detectMediaType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
		const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
		expect(detectMediaType(webp)).toBeNull();
		expect(isWebp(webp)).toBe(true);
		expect(isWebp(new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt '))).toBe(false);
		expect(detectMediaType(new Uint8Array([0xff, 0xd8]))).toBeNull();
	});
});

describe('imageSize', () => {
	it('czyta wymiary z PNG, GIF i JPEG', () => {
		expect(imageSize(png(1200, 600))).toEqual({ width: 1200, height: 600 });
		expect(imageSize(pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x58, 0x02, 0x2c, 0x01]))).toEqual({ width: 600, height: 300 });
		expect(imageSize(jpeg(1072, 536))).toEqual({ width: 1072, height: 536 });
		expect(imageSize(jpeg(800, 400, [0x010f]))).toEqual({ width: 800, height: 400 });
	});

	it('dla PDF i uszkodzonego pliku zwraca null', () => {
		expect(imageSize(new TextEncoder().encode('%PDF-1.7'))).toBeNull();
		expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBeNull();
	});
});

describe('hasExifGps', () => {
	it('wykrywa znacznik GPS w EXIF (little i big endian)', () => {
		expect(hasExifGps(jpeg(10, 10, [0x010f, 0x8825]))).toBe(true);
		expect(hasExifGps(jpeg(10, 10, [0x8825], false))).toBe(true);
	});

	it('przepuszcza zdjęcie bez EXIF, bez GPS i pliki innych typów', () => {
		expect(hasExifGps(jpeg(10, 10))).toBe(false);
		expect(hasExifGps(jpeg(10, 10, [0x010f, 0x0110]))).toBe(false);
		expect(hasExifGps(png(10, 10))).toBe(false);
	});
});

describe('nazwy i klucze', () => {
	it('slugify zamienia polskie znaki i czyści resztę', () => {
		expect(slugify('Zdjęcie Łódź — Grupa Otwarta 2026!')).toBe('zdjecie-lodz-grupa-otwarta-2026');
		expect(slugify('  ---  ')).toBe('');
		expect(slugify('a'.repeat(120))).toHaveLength(80);
	});

	it('baseName i stripKnownExtension', () => {
		expect(baseName('C:\\Users\\x\\Hero Grupa.final.JPG')).toBe('Hero Grupa.final');
		expect(baseName('/tmp/logo.png')).toBe('logo');
		expect(baseName('.hidden')).toBe('.hidden');
		expect(stripKnownExtension('hero-grupa.JPG')).toBe('hero-grupa');
		expect(stripKnownExtension('raport.2026')).toBe('raport.2026');
	});

	it('mediaKey składa adres z folderu, nazwy i typu z zawartości', () => {
		const jpg = detectMediaType(pad(JPG_SOI))!;
		expect(mediaKey('BeautyPolisa', 'Hero Grupa Otwarta 2026', jpg)).toBe('beautypolisa/hero-grupa-otwarta-2026.jpg');
		expect(mediaKey('beautypolisa', 'hero-grupa.jpg', jpg)).toBe('beautypolisa/hero-grupa.jpg');
		expect(mediaKey('beautypolisa', '!!!', jpg)).toBeNull();
		expect(mediaKey('x', 'logo', jpg)).toBeNull(); // folder za krótki
		expect(mediaKey('../etc', 'passwd', jpg)).toBe('etc/passwd.jpg'); // ścieżka nie ucieka z folderu
	});

	it('każdy klucz z mediaKey przechodzi isValidKey (podmiana i usuwanie zadziałają)', () => {
		const types = [pad(JPG_SOI), pad(PNG_SIG), pad([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]), new TextEncoder().encode('%PDF-1.4')].map(
			(b) => detectMediaType(b)!
		);
		const cases: [string, string][] = [
			['beautypolisa', 'Hero'],
			['Utrata Dochodu', 'Ankieta oceny ryzyka 2026'],
			['a'.repeat(60), 'b'.repeat(120)],
			['wspolne', 'x']
		];
		for (const t of types) for (const [f, n] of cases) expect(isValidKey(mediaKey(f, n, t)!)).toBe(true);
	});

	it('normalizeFolder pilnuje długości i znaków', () => {
		expect(normalizeFolder('Utrata Dochodu')).toBe('utrata-dochodu');
		expect(normalizeFolder('a'.repeat(60))).toHaveLength(40);
		expect(normalizeFolder('ą')).toBeNull();
	});

	it('isValidKey przepuszcza tylko klucze w kształcie folder/nazwa.rozszerzenie', () => {
		expect(isValidKey('beautypolisa/hero-grupa-otwarta-2026.jpg')).toBe(true);
		expect(isValidKey('beautypolisa/plik.pdf')).toBe(true);
		expect(isValidKey('../beautypolisa/x.jpg')).toBe(false);
		expect(isValidKey('beautypolisa/sub/x.jpg')).toBe(false);
		expect(isValidKey('beautypolisa/x.svg')).toBe(false);
		expect(isValidKey('beautypolisa/x.webp')).toBe(false);
		expect(isValidKey('beautypolisa/X.jpg')).toBe(false);
		expect(isValidKey('beautypolisa/.jpg')).toBe(false);
	});

	it('typeForKey nie daje się oszukać kluczami prototypu', () => {
		expect(typeForKey('a/b.jpeg')?.mime).toBe('image/jpeg');
		expect(typeForKey('a/b.pdf')?.image).toBe(false);
		expect(typeForKey('a/b.svg')).toBeNull();
		expect(typeForKey('a/b.constructor')).toBeNull();
		expect(typeForKey('a/b.__proto__')).toBeNull();
	});
});

describe('pomocnicze', () => {
	it('publicUrl, acceptForType, formatBytes', () => {
		expect(publicUrl('beautypolisa/x.png')).toBe('https://media.auraexpert.pl/beautypolisa/x.png');
		expect(acceptForType(typeForKey('a/b.jpg'))).toBe('image/jpeg,.jpg,.jpeg');
		expect(acceptForType(typeForKey('a/b.pdf'))).toBe('application/pdf,.pdf');
		expect(formatBytes(1023)).toBe('1023 B');
		expect(formatBytes(1024)).toBe('1 KB');
		expect(formatBytes(1048576)).toBe('1.0 MB');
	});

	it('imgSnippet ma atrybut width dla Outlooka i escapuje alt', () => {
		const s = imgSnippet('https://media.auraexpert.pl/a/b.jpg', 536, 'Promocja "ERGO" <2026>');
		expect(s).toContain('width="536"');
		expect(s).toContain('max-width:536px');
		expect(s).toContain('alt="Promocja &quot;ERGO&quot; &lt;2026&gt;"');
	});
});
