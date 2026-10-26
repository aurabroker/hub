import { describe, expect, it, vi } from 'vitest';
import fixture from '$lib/ads/fixture.json';
import type { AdsArchiveEntry } from '$lib/ads/types';
import {
	MAX_REPORT_BYTES,
	handleAdsReportPost,
	tokenMatches,
	type AdsReportRow,
	type AdsReportStore
} from './adsReports';

const TOKEN = 'a3f1c2d4e5b6a7980112233445566778899aabbccddeeff00112233445566778';
const URL = 'https://hub.example/api/webhooks/ads-report';

/** Magazyn w pamięci z tą samą semantyką co upsert onConflict period_end. */
function memoryStore() {
	const rows = new Map<string, AdsReportRow>();
	const store: AdsReportStore = {
		async upsert(row) {
			rows.set(row.period_end, structuredClone(row));
		},
		async list() {
			return [...rows.values()]
				.sort((a, b) => b.period_end.localeCompare(a.period_end))
				.map((r): AdsArchiveEntry => ({
					period_end: r.period_end,
					received_at: r.received_at,
					campaign: r.campaign
				}));
		},
		async get(period) {
			return rows.get(period) ?? null;
		},
		async trend(limit) {
			return [...rows.values()]
				.sort((a, b) => a.period_end.localeCompare(b.period_end))
				.slice(-limit)
				.map((r) => ({ period_end: r.period_end, kpi: r.payload.kpi?.current ?? null }));
		}
	};
	return { rows, store };
}

function post(body: BodyInit | null, headers: Record<string, string> = {}): Request {
	return new Request(URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...headers },
		body
	});
}

function withoutAuth(body: string): Request {
	return new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
}

async function send(request: Request, token: string | null = TOKEN) {
	const { rows, store } = memoryStore();
	const now = () => new Date('2026-11-02T05:04:00.000Z');
	const res = await handleAdsReportPost(request, { token, store, now });
	return { res, body: await res.json(), rows };
}

describe('autoryzacja', () => {
	it('503, gdy ADS_REPORT_TOKEN nie jest ustawiony (pusty albo same spacje)', async () => {
		expect((await send(post(JSON.stringify(fixture)), null)).res.status).toBe(503);
		expect((await send(post(JSON.stringify(fixture)), '')).res.status).toBe(503);
		expect((await send(post(JSON.stringify(fixture)), '  \n')).res.status).toBe(503);
	});

	it('401 bez nagłówka Authorization', async () => {
		const { res, body, rows } = await send(withoutAuth(JSON.stringify(fixture)));
		expect(res.status).toBe(401);
		expect(body.ok).toBe(false);
		expect(rows.size).toBe(0);
	});

	it('401 przy złym tokenie, także o innej długości', async () => {
		for (const wrong of ['zly-token', `${TOKEN}x`, TOKEN.slice(0, -1)]) {
			const { res } = await send(post(JSON.stringify(fixture), { authorization: `Bearer ${wrong}` }));
			expect(res.status).toBe(401);
		}
	});

	it('401 przy innym schemacie niż Bearer', async () => {
		const { res } = await send(post(JSON.stringify(fixture), { authorization: `Basic ${TOKEN}` }));
		expect(res.status).toBe(401);
	});

	it('przycina białe znaki wokół tokenu (wklejony z nową linią)', async () => {
		const { res } = await send(post(JSON.stringify(fixture), { authorization: `Bearer  ${TOKEN} ` }), `${TOKEN}\n`);
		expect(res.status).toBe(200);
	});

	// Kolejność kontroli: konfiguracja → token → rozmiar → treść. Bez tokenu
	// serwer nie może czytać megabajta ani zdradzać w `details`, jakich pól
	// oczekuje — dlatego treść w tych testach jest celowo zła.
	it('401 przed czytaniem treści: zły JSON bez tokenu nie jest nawet otwierany', async () => {
		const request = withoutAuth('{not json');
		const { res, body } = await send(request);
		expect(res.status).toBe(401);
		expect(body.details).toBeUndefined();
		expect(request.bodyUsed).toBe(false);
	});

	it('401 przed limitem rozmiaru: zły token i Content-Length ponad 1 MB', async () => {
		const request = post('{}', {
			authorization: 'Bearer zly-token',
			'content-length': String(MAX_REPORT_BYTES + 1)
		});
		const { res } = await send(request);
		expect(res.status).toBe(401);
		expect(request.bodyUsed).toBe(false);
	});

	it('503 przed wszystkim innym: brak konfiguracji i zła treść', async () => {
		const request = withoutAuth('{not json');
		const { res } = await send(request, null);
		expect(res.status).toBe(503);
		expect(request.bodyUsed).toBe(false);
	});

	it('tokenMatches porównuje skróty o stałej długości', async () => {
		expect(await tokenMatches(TOKEN, TOKEN)).toBe(true);
		expect(await tokenMatches('', TOKEN)).toBe(false);
		expect(await tokenMatches(null, TOKEN)).toBe(false);
		expect(await tokenMatches('a', 'b')).toBe(false);
	});
});

describe('limit rozmiaru', () => {
	it('413 od razu po nagłówku Content-Length', async () => {
		const request = post(JSON.stringify(fixture), { 'content-length': String(MAX_REPORT_BYTES + 1) });
		const { res } = await send(request);
		expect(res.status).toBe(413);
		// Treść nawet nie zaczęła być czytana.
		expect(request.bodyUsed).toBe(false);
	});

	it('413 dla treści bez Content-Length (strumień liczony w locie)', async () => {
		const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
		let sent = 0;
		let cancelled = false;
		// Strumień 4 MB (64 × 64 kB) — dużo dłuższy niż limit. Kod, który
		// najpierw czyta wszystko, a limit sprawdza dopiero na końcu, też odda
		// 413, ale wyczerpie cały strumień i asercja na `sent` go złapie.
		// (Strumień bez końca zawiesiłby taki kod razem z timerem testu.)
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (sent >= 64) return controller.close();
				sent++;
				controller.enqueue(chunk);
			},
			cancel() {
				cancelled = true;
			}
		});
		const request = new Request(URL, {
			method: 'POST',
			headers: { authorization: `Bearer ${TOKEN}` },
			body: stream,
			// @ts-expect-error — `duplex` wymagany przez undici dla strumienia, brak w typach DOM
			duplex: 'half'
		});
		expect(request.headers.get('content-length')).toBeNull();
		const { res } = await send(request);
		expect(res.status).toBe(413);
		// 17 × 64 kB przekracza 1 MB; najwyżej jeden kawałek pobrany na zapas.
		expect(sent).toBeLessThanOrEqual(18);
		expect(cancelled).toBe(true);
	});
});

describe('walidacja', () => {
	it('400 dla nieprawidłowego JSON', async () => {
		const { res, body } = await send(post('{"campaign": "UD_2026",'));
		expect(res.status).toBe(400);
		expect(body).toEqual({ ok: false, error: 'Nieprawidłowy JSON' });
	});

	it('400 dla treści, która nie jest obiektem', async () => {
		const { res } = await send(post('[1,2,3]'));
		expect(res.status).toBe(400);
	});

	const missing: [string, (r: Record<string, any>) => void, RegExp][] = [
		['period', (r) => delete r.period, /period/],
		['period.end', (r) => delete r.period.end, /period\.end/],
		['period.end w złym formacie', (r) => (r.period.end = '01.11.2026'), /RRRR-MM-DD/],
		['kpi', (r) => delete r.kpi, /kpi/],
		['kpi.current', (r) => delete r.kpi.current, /kpi\.current/],
		['kpi.current = null', (r) => (r.kpi.current = null), /kpi\.current/],
		['kpi.previous', (r) => delete r.kpi.previous, /kpi\.previous/],
		['alerts', (r) => delete r.alerts, /alerts/],
		['alerts jako obiekt', (r) => (r.alerts = {}), /alerts/]
	];

	for (const [name, mutate, pattern] of missing) {
		it(`400 bez pola: ${name}`, async () => {
			const report = structuredClone(fixture) as Record<string, any>;
			mutate(report);
			const { res, body, rows } = await send(post(JSON.stringify(report)));
			expect(res.status).toBe(400);
			expect(body.ok).toBe(false);
			expect(body.details.some((d: string) => pattern.test(d))).toBe(true);
			expect(rows.size).toBe(0);
		});
	}

	it('400 dla daty niemożliwej (2026-02-30)', async () => {
		const report = structuredClone(fixture);
		report.period.end = '2026-02-30';
		const { res, body } = await send(post(JSON.stringify(report)));
		expect(res.status).toBe(400);
		expect(body.details.join(' ')).toMatch(/prawdziwą datą/);
	});

	it('zbiera wszystkie błędy naraz', async () => {
		const { res, body } = await send(post(JSON.stringify({ campaign: 'UD_2026' })));
		expect(res.status).toBe(400);
		expect(body.details).toHaveLength(3);
	});
});

describe('zapis', () => {
	it('200 z dokładnie {ok, period_end} dla poprawnego raportu', async () => {
		const { res, body, rows } = await send(post(JSON.stringify(fixture)));
		expect(res.status).toBe(200);
		expect(body).toEqual({ ok: true, period_end: '2026-11-01' });

		const row = rows.get('2026-11-01')!;
		expect(row.campaign).toBe('UD_2026');
		expect(row.generated_at).toBe('2026-11-02T05:03:11.000Z');
		expect(row.received_at).toBe('2026-11-02T05:04:00.000Z');
		expect(row.payload).toEqual(fixture);
	});

	it('generated_at niebędący datą ISO zapisuje się jako null', async () => {
		const report = { ...structuredClone(fixture), generated_at: 'wczoraj' };
		const { res, rows } = await send(post(JSON.stringify(report)));
		expect(res.status).toBe(200);
		expect(rows.get('2026-11-01')!.generated_at).toBeNull();
	});

	it('generated_at z niemożliwą datą zapisuje się jako null, a nie jako 2 marca', async () => {
		const report = { ...structuredClone(fixture), generated_at: '2026-02-30T05:00:00Z' };
		const { res, rows } = await send(post(JSON.stringify(report)));
		expect(res.status).toBe(200);
		expect(rows.get('2026-11-01')!.generated_at).toBeNull();
	});

	it('ponowne wysłanie tego samego tygodnia nadpisuje, a nie dubluje', async () => {
		const { rows, store } = memoryStore();
		const deps = { token: TOKEN, store };
		await handleAdsReportPost(post(JSON.stringify(fixture)), deps);

		const updated = structuredClone(fixture);
		updated.kpi.current.clicks = 999;
		updated.script_version = '2026-11-02-poprawka';
		const res = await handleAdsReportPost(post(JSON.stringify(updated)), deps);

		expect(res.status).toBe(200);
		expect(rows.size).toBe(1);
		expect((await store.list()).length).toBe(1);
		expect(rows.get('2026-11-01')!.payload.kpi?.current?.clicks).toBe(999);
		expect(rows.get('2026-11-01')!.payload.script_version).toBe('2026-11-02-poprawka');
	});

	it('500, gdy magazyn odmówi zapisu — z wpisem w logu', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { store } = memoryStore();
		store.upsert = async () => {
			throw new Error('connection refused');
		};
		const res = await handleAdsReportPost(post(JSON.stringify(fixture)), { token: TOKEN, store });
		expect(res.status).toBe(500);
		expect((await res.json()).ok).toBe(false);
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});
});
