import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import fixture from '$lib/ads/fixture.json';
import { DASH, NBSP } from '$lib/ads/format';
import type { AdsArchiveEntry, AdsTrendPoint, StoredAdsReport } from '$lib/ads/types';
import { buildAdsView, pickWeek } from '$lib/ads/view';
import Page from './+page.svelte';

/**
 * Render strony z modelu zbudowanego tą samą drogą co w `load`:
 * archiwum → pickWeek → buildAdsView.
 */
function renderPage(opts: {
	archive?: AdsArchiveEntry[];
	trend?: AdsTrendPoint[];
	report?: StoredAdsReport | null;
	now?: Date;
	requested?: string | null;
}) {
	const archive = opts.archive ?? [
		{ period_end: '2026-11-01', received_at: '2026-11-02T05:04:00.000Z', campaign: 'UD_2026' }
	];
	const { period, missing } = pickWeek(archive, opts.requested ?? null);
	const data = buildAdsView({
		archive,
		period,
		missingWeek: missing,
		report: opts.report === undefined ? (fixture as StoredAdsReport) : opts.report,
		trend: opts.trend ?? [{ period_end: '2026-11-01', kpi: fixture.kpi.current }],
		now: opts.now ?? new Date('2026-11-03T08:00:00.000Z')
	});
	return render(Page, { props: { data } }).body;
}

/** Tekst bez znaczników i z rozwiniętymi encjami — do szukania fraz. */
function text(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/[ \t\n]+/g, ' ');
}

describe('strona Google Ads', () => {
	const html = renderPage({});
	const plain = text(html);

	it('nagłówek: kampania, okres, czas wygenerowania, wersja skryptu', () => {
		expect(plain).toContain('UD_2026');
		expect(plain).toContain(`26.10.2026 ${DASH} 01.11.2026`);
		expect(plain).toContain('02.11.2026 06:03');
		expect(plain).toContain('2026-10-26-tyg');
	});

	it('alerty z poziomami, od najpoważniejszego', () => {
		const k = plain.indexOf('KRYTYCZNE');
		const u = plain.indexOf('UWAGA');
		const i = plain.indexOf('INFO');
		expect(k).toBeGreaterThan(-1);
		expect(u).toBeGreaterThan(k);
		expect(i).toBeGreaterThan(u);
		expect(html).toContain('ads-alert-error');
		expect(html).toContain('ads-alert-warning');
		expect(html).toContain('ads-alert-info');
	});

	it('liczby po polsku: kwota z grupowaniem, procent, pp', () => {
		expect(plain).toContain(`1${NBSP}234,56${NBSP}zł`);
		expect(plain).toContain('8,1%');
		expect(plain).toContain(`+8,0${NBSP}pp`);
		// Kliknięcia 412 vs 367: +12,3%, wzrost dobry.
		expect(plain).toContain('+12,3%');
		expect(html).toMatch(/change-good[^>]*>[^<]*▲[^<]*\+12,3%/);
	});

	it('kolor zmiany według znaczenia: spadek utraty przez budżet jest dobry, koszt neutralny', () => {
		// lost_is_budget 8% → 3%: −5,0 pp, na zielono.
		expect(html).toMatch(/change-good[^>]*>[^<]*▼[^<]*−5,0 pp/);
		// Koszt 1098,20 → 1234,56: +12,4%, bez oceny.
		expect(html).toMatch(/change-neutral[^>]*>[^<]*▲[^<]*\+12,4%/);
	});

	it('brak wartości to półpauza, nie zero', () => {
		// Docelowy CPA = null, koszt konwersji tydzień wcześniej = null, wynik jakości = null.
		expect(plain).toContain(`Docelowy CPA ${DASH}`);
		expect(plain).toContain(`tydzień wcześniej: ${DASH}`);
		expect(html).toMatch(/change-none[^>]*>\s*–/);
	});

	it('dopasowania po polsku', () => {
		expect(plain).toContain('ścisłe');
		expect(plain).toContain('do wyrażenia');
		expect(plain).toContain('przybliżone');
	});

	it('zmiany z rekomendacji są wyróżnione i mają plakietkę', () => {
		const reco = html.match(/<tr class="[^"]*row-reco[^"]*"/g) ?? [];
		expect(reco).toHaveLength(2);
		expect(plain).toContain('AUTO-REKOMENDACJA');
		expect(plain).toMatch(/[^-]REKOMENDACJA/);
		// Zielony .row-hot jest zarezerwowany dla „zadzwoń".
		expect(html).not.toContain('row-hot');
	});

	it('hasło wpisane przez użytkownika Google jest wyescapowane', () => {
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).toContain('&lt;script>alert(1)&lt;/script> l4');
	});

	it('link do pobrania Markdownu i wybór tygodnia bez JS', () => {
		expect(html).toContain('href="/google-ads/pobierz/2026-11-01"');
		expect(plain).toContain('Pobierz .md');
		expect(html).toMatch(/<form[^>]*method="GET"[^>]*action="\/google-ads"/);
		expect(html).toContain('name="tydzien"');
	});

	it('jeden zapisany tydzień: komunikat o budującej się historii', () => {
		expect(plain).toContain('Historia dopiero się buduje');
	});

	it('świeży raport: bez ostrzeżenia o milczącym skrypcie', () => {
		expect(plain).not.toContain('Skrypt nie przysłał raportu');
	});
});

describe('stany brzegowe', () => {
	it('ostrzeżenie, gdy najnowszy raport jest starszy niż 8 dni', () => {
		const plain = text(renderPage({ now: new Date('2026-11-12T08:00:00.000Z') }));
		expect(plain).toContain('Skrypt nie przysłał raportu — sprawdź Google Ads → Skrypty');
		expect(plain).toContain('01.11.2026');
	});

	it('ostrzeżenie liczy się od najnowszego raportu, nie od oglądanego', () => {
		const archive = [
			{ period_end: '2026-11-08', received_at: '2026-11-09T05:04:00.000Z', campaign: 'UD_2026' },
			{ period_end: '2026-11-01', received_at: '2026-11-02T05:04:00.000Z', campaign: 'UD_2026' }
		];
		const plain = text(
			renderPage({ archive, requested: '2026-11-01', now: new Date('2026-11-12T08:00:00.000Z') })
		);
		expect(plain).not.toContain('Skrypt nie przysłał raportu');
		expect(plain).toContain(`26.10.2026 ${DASH} 01.11.2026`);
	});

	it('wykresy trendu od trzech tygodni, bez komunikatu o historii', () => {
		const trend = ['2026-10-18', '2026-10-25', '2026-11-01'].map((period_end, i) => ({
			period_end,
			kpi: { ...fixture.kpi.current, clicks: 300 + i * 50 }
		}));
		const html = renderPage({ trend });
		expect(text(html)).not.toContain('Historia dopiero się buduje');
		expect(html).toContain('Wykres słupkowy');
	});

	it('brak raportów: pusty stan z adresem endpointu', () => {
		const plain = text(renderPage({ archive: [], report: null, trend: [] }));
		expect(plain).toContain('Brak raportów');
		expect(plain).toContain('POST /api/webhooks/ads-report');
		expect(plain).not.toContain('Pobierz .md');
	});

	it('raport z pustymi i brakującymi sekcjami nie wywraca strony', () => {
		const sparse: StoredAdsReport = {
			campaign: 'UD_2026',
			period: { start: '2026-10-26', end: '2026-11-01' },
			kpi: { current: { clicks: 10 }, previous: {} },
			alerts: [],
			keywords: [],
			changes: undefined
		};
		const plain = text(renderPage({ report: sparse }));
		expect(plain).toContain('Brak danych w tym raporcie');
		expect(plain).toContain('Brak zmian w tym tygodniu');
		expect(plain).not.toContain('Pobierz .md');
	});

	it('nieznany tydzień z adresu: najnowszy plus informacja', () => {
		const plain = text(renderPage({ requested: '2026-02-30' }));
		expect(plain).toContain('Nie ma raportu za tydzień 2026-02-30');
		expect(plain).toContain(`26.10.2026 ${DASH} 01.11.2026`);
	});
});
