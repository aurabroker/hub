import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import fixture from '$lib/ads/fixture.json';
import { DASH, NBSP } from '$lib/ads/format';
import type { AdsArchiveEntry, AdsTrendPoint, StoredAdsReport } from '$lib/ads/types';
import { SEARCH_TERMS_VISIBLE, buildAdsView, pickWeek } from '$lib/ads/view';
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

/** Fragment HTML jednej karty KPI, po jej etykiecie. */
function kpiCard(html: string, label: string): string {
	const card = html
		.split('class="kpi-card"')
		.slice(1)
		.find((c) => c.includes(`<div class="kpi-label">${label}</div>`));
	if (!card) throw new Error(`Brak karty KPI: ${label}`);
	return card;
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

	// Kolor niesie ocenę, strzałka kierunek. Każda z ośmiu metryk osobno —
	// odwrócenie kierunku przy jednej z nich nie może przejść niezauważone.
	const tones: [string, 'good' | 'bad' | 'neutral', string, string][] = [
		['Kliknięcia', 'good', '▲', '+12,3%'], // 367 → 412
		['Koszt', 'neutral', '▲', '+54,6%'], // 798,40 → 1234,56
		['Konwersje', 'good', '▲', '+12,5%'], // 8 → 9
		['Koszt konwersji', 'bad', '▲', '+37,4%'], // 99,80 → 137,17
		['CTR', 'bad', '▼', `−0,3${NBSP}pp`], // 8,32% → 8,05%
		['Udział w wyświetleniach', 'good', '▲', `+8,0${NBSP}pp`], // 50% → 58%
		['Utrata udziału przez budżet', 'good', '▼', `−5,0${NBSP}pp`], // 8% → 3%
		['Utrata udziału przez pozycję', 'good', '▼', `−3,0${NBSP}pp`] // 42% → 39%
	];
	for (const [label, tone, arrow, change] of tones) {
		it(`kolor zmiany według znaczenia: ${label} ${arrow} to ${tone}`, () => {
			const card = kpiCard(html, label);
			const delta = /<div class="kpi-delta change-(\w+)[^"]*"[^>]*>([^<]*)<\/div>/.exec(card);
			expect(delta?.[1]).toBe(tone);
			expect(text(delta?.[2] ?? '')).toContain(arrow);
			expect(text(delta?.[2] ?? '')).toContain(change);
		});
	}

	it('brak wartości to półpauza, nie zero', () => {
		// Docelowy CPA = null, wynik jakości = null.
		expect(plain).toContain(`Docelowy CPA ${DASH}`);
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

	it('generated_local ma pierwszeństwo przed generated_at', () => {
		const report = { ...(fixture as StoredAdsReport), generated_local: '02.11.2026 07:15' };
		const plain = text(renderPage({ report }));
		expect(plain).toContain('wygenerowano 02.11.2026 07:15');
		expect(plain).not.toContain('02.11.2026 06:03');
	});

	it('bez generated_local: generated_at w czasie warszawskim', () => {
		const report = { ...(fixture as StoredAdsReport), generated_local: undefined };
		// 05:03:11Z to 06:03 w Warszawie (CET, po zmianie czasu).
		expect(text(renderPage({ report }))).toContain('wygenerowano 02.11.2026 06:03');
	});
});

describe('KPI bez poprzedniej wartości', () => {
	const report = structuredClone(fixture) as StoredAdsReport;
	report.kpi!.previous = { ...report.kpi!.previous, conversions: 0, cpa: null };
	const html = renderPage({ report });

	it('zero tydzień wcześniej: zmiana to półpauza, bez koloru oceny', () => {
		const card = kpiCard(html, 'Konwersje');
		expect(card).toMatch(/kpi-delta change-none[^>]*>\s*–/);
		expect(text(card)).toContain('tydzień wcześniej: 0');
	});

	it('null tydzień wcześniej: półpauza w zmianie i w poprzedniej wartości', () => {
		const card = kpiCard(html, 'Koszt konwersji');
		expect(card).toMatch(/kpi-delta change-none[^>]*>\s*–/);
		expect(text(card)).toContain(`tydzień wcześniej: ${DASH}`);
	});
});

describe('stany brzegowe', () => {
	it('ostrzeżenie, gdy najnowszy raport jest starszy niż 8 dni', () => {
		const plain = text(renderPage({ now: new Date('2026-11-12T08:00:00.000Z') }));
		expect(plain).toContain('Skrypt nie przysłał raportu — sprawdź Google Ads → Skrypty');
		// Cała fraza: sama data 01.11.2026 stoi też w nagłówku i w wyborze tygodnia.
		expect(plain).toContain('Ostatni raport: tydzień do 01.11.2026, odebrany 02.11.2026 06:04.');
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

	it('wykresy trendu: wartości po polsku w tooltipie i na osi', () => {
		const trend = ['2026-10-18', '2026-10-25', '2026-11-01'].map((period_end, i) => ({
			period_end,
			kpi: { ...fixture.kpi.current, conversions: [1, 1.5, 8.5][i] }
		}));
		const html = renderPage({ trend });
		// Koszt 1234,56: pełna kwota w tooltipie, grupowanie na osi.
		expect(html).toContain(`26.10.2026 ${DASH} 01.11.2026: 1${NBSP}234,56${NBSP}zł</title>`);
		expect(html).toContain(`>1${NBSP}234</text>`);
		// Konwersje ułamkowe z przecinkiem, nigdy z kropką JS.
		expect(html).toContain(`26.10.2026 ${DASH} 01.11.2026: 8,5</title>`);
		expect(html).not.toMatch(/: \d+\.\d+<\/title>/);
	});

	it('oś przy ułamkowym maksimum nie wychodzi nad wykres', () => {
		const trend = ['2026-10-18', '2026-10-25', '2026-11-01'].map((period_end, i) => ({
			period_end,
			kpi: { ...fixture.kpi.current, conversions: [0.5, 1, 1.5][i] }
		}));
		const html = renderPage({ trend });
		// Każda linia siatki ma y w obrębie viewBox (≥ 0).
		const ys = [...html.matchAll(/<line[^>]*y1="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
		expect(ys.length).toBeGreaterThan(0);
		expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
	});

	it('licznik zapisanych tygodni mówi o archiwum, nie o oknie wykresu', () => {
		const archive = Array.from({ length: 30 }, (_, i) => {
			const d = new Date(Date.UTC(2026, 10, 1 - 7 * i)).toISOString().slice(0, 10);
			return { period_end: d, received_at: '2026-11-02T05:04:00.000Z', campaign: 'UD_2026' };
		});
		const trend = archive
			.slice(0, 26)
			.reverse()
			.map((a) => ({ period_end: a.period_end, kpi: fixture.kpi.current }));
		const plain = text(renderPage({ archive, trend }));
		expect(plain).toContain('zapisane tygodnie: 30');
		expect(plain).toContain('na wykresach ostatnie 26');
	});

	it('sparkline kończy się na oglądanym tygodniu, nie na najnowszym', () => {
		const weeks = ['2026-10-18', '2026-10-25', '2026-11-01', '2026-11-08'];
		const archive = [...weeks].reverse().map((period_end) => ({
			period_end,
			received_at: '2026-11-09T05:04:00.000Z',
			campaign: 'UD_2026'
		}));
		const trend = weeks.map((period_end, i) => ({
			period_end,
			kpi: { ...fixture.kpi.current, clicks: [300, 350, 412, 999][i] }
		}));
		const { period } = pickWeek(archive, '2026-11-01');
		const view = buildAdsView({
			archive,
			period,
			report: fixture as StoredAdsReport,
			trend,
			now: new Date('2026-11-10T08:00:00.000Z')
		});
		expect(view.kpis.find((k) => k.key === 'clicks')?.spark).toEqual([300, 350, 412]);
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
		// Trzy sekcje bez danych: ustawienia, słowa kluczowe, wyszukiwane hasła.
		expect(plain.match(/Brak danych w tym raporcie/g)).toHaveLength(3);
		// Pusta tablica to komunikat, a nie tabela z samym nagłówkiem.
		expect(plain).not.toContain('Słowo kluczowe Dopasowanie');
		expect(plain).not.toContain('Wyszukiwane hasło Wyświetl.');
		expect(plain).toContain('Brak zmian w tym tygodniu');
		expect(plain).not.toContain('Pobierz .md');
	});

	it('nieznany tydzień z adresu: najnowszy plus informacja', () => {
		const plain = text(renderPage({ requested: '2026-02-30' }));
		expect(plain).toContain('Nie ma raportu za tydzień 2026-02-30');
		expect(plain).toContain(`26.10.2026 ${DASH} 01.11.2026`);
	});
});

/** Fragment HTML od nagłówka sekcji do następnej sekcji `.table-wrap`. */
function section(html: string, title: string): string {
	const start = html.indexOf(`<h3>${title}</h3>`);
	if (start < 0) throw new Error(`Brak sekcji: ${title}`);
	const end = html.indexOf('class="table-wrap"', start);
	return html.slice(start, end < 0 ? undefined : end);
}

/** Część sekcji przed `<details>` i wewnątrz niego. */
function splitDetails(html: string): { visible: string; folded: string } {
	const at = html.indexOf('<details');
	if (at < 0) return { visible: html, folded: '' };
	return { visible: html.slice(0, at), folded: html.slice(at, html.indexOf('</details>', at)) };
}

/** Słowa kluczowe / hasła w kolejności wierszy tabeli. */
function mainCells(html: string): string[] {
	return [...html.matchAll(/<span class="cell-main">([^<]*)<\/span>/g)].map((m) => text(m[1]).trim());
}

function keyword(
	keyword: string,
	ad_group: string,
	m: { impressions?: number | null; clicks?: number | null; cost?: number | null }
) {
	return {
		ad_group,
		ad_group_status: 'ENABLED',
		keyword,
		match_type: 'EXACT' as const,
		status: 'ENABLED',
		quality_score: null,
		impressions: m.impressions as number,
		clicks: m.clicks as number,
		cost: m.cost as number,
		conversions: 0,
		cpa: null
	};
}

describe('słowa kluczowe: aktywne na wierzchu, zerowe zwinięte', () => {
	const html = renderPage({});
	const kw = section(html, 'Słowa kluczowe');
	const { visible, folded } = splitDetails(kw);

	it('licznik w nagłówku: ile z wszystkich miało wyświetlenia', () => {
		expect(text(kw)).toContain('3 z 6 z wyświetleniami');
	});

	it('aktywne od najdroższego, niezależnie od kolejności ze skryptu', () => {
		// Skrypt: prywatne l4 (1064 zł), ubezpieczenie… (12,40 zł), zwolnienie… (158,16 zł).
		expect(mainCells(visible)).toEqual([
			'prywatne l4',
			'zwolnienie lekarskie jdg',
			'ubezpieczenie od utraty dochodu'
		]);
	});

	it('słowa bez wyświetleń tylko w zwiniętym <details>, po grupie i słowie', () => {
		expect(folded).toMatch(/^<details class="more[ "]/);
		// Zwinięte domyślnie: bez atrybutu open.
		expect(folded).not.toMatch(/^<details[^>]*\sopen/);
		expect(text(folded)).toContain('Bez wyświetleń w tym tygodniu (3)');
		expect(mainCells(folded)).toEqual([
			'chorobowe jdg',
			'ubezpieczenie chorobowe',
			'l4 dla przedsiębiorcy'
		]);
		for (const k of mainCells(folded)) expect(mainCells(visible)).not.toContain(k);
	});

	it('remis kosztu rozstrzygają kliknięcia, potem wyświetlenia, potem nazwa', () => {
		const report = structuredClone(fixture) as StoredAdsReport;
		report.keywords = [
			keyword('d', 'G', { impressions: 50, clicks: 1, cost: 5 }),
			keyword('c', 'G', { impressions: 10, clicks: 2, cost: 5 }),
			keyword('b', 'G', { impressions: 10, clicks: 1, cost: 5 }),
			keyword('a', 'G', { impressions: 10, clicks: 1, cost: 5 }),
			keyword('e', 'G', { impressions: 1, clicks: null, cost: null }),
			keyword('f', 'G', { impressions: null, clicks: null, cost: null })
		];
		const { visible, folded } = splitDetails(section(renderPage({ report }), 'Słowa kluczowe'));
		expect(mainCells(visible)).toEqual(['c', 'd', 'a', 'b', 'e']);
		// Brak wyświetleń (null) liczy się jak zero.
		expect(mainCells(folded)).toEqual(['f']);
	});

	it('żadne słowo bez wyświetleń: komunikat i nadal zwinięta lista', () => {
		const report = structuredClone(fixture) as StoredAdsReport;
		report.keywords = [
			keyword('x', 'B', { impressions: 0, clicks: 0, cost: 0 }),
			keyword('y', 'A', { impressions: 0, clicks: 0, cost: 0 })
		];
		const kw = section(renderPage({ report }), 'Słowa kluczowe');
		const { visible, folded } = splitDetails(kw);
		expect(text(kw)).toContain('0 z 2 z wyświetleniami');
		expect(text(visible)).toContain('Żadne słowo kluczowe nie miało wyświetleń w tym tygodniu.');
		// Bez pustej tabeli nad komunikatem.
		expect(visible).not.toContain('<table');
		expect(text(folded)).toContain('Bez wyświetleń w tym tygodniu (2)');
		expect(mainCells(folded)).toEqual(['y', 'x']);
	});

	it('wszystkie z wyświetleniami: bez zwiniętej listy', () => {
		const report = structuredClone(fixture) as StoredAdsReport;
		report.keywords = [keyword('x', 'A', { impressions: 3, clicks: 0, cost: 0 })];
		const kw = section(renderPage({ report }), 'Słowa kluczowe');
		expect(kw).not.toContain('<details');
		expect(text(kw)).toContain('1 z 1 z wyświetleniami');
	});
});

describe('wyszukiwane hasła', () => {
	function term(search_term: string, cost: number, clicks = 0, impressions = 1) {
		return { search_term, ad_group: 'G', impressions, clicks, cost, conversions: 0 };
	}

	it('od najdroższego, remisy po kliknięciach, wyświetleniach i haśle', () => {
		const report = structuredClone(fixture) as StoredAdsReport;
		report.search_terms = [
			term('tanie', 1),
			term('b', 9, 2, 5),
			term('a', 9, 2, 5),
			term('więcej wyświetleń', 9, 2, 50),
			term('więcej kliknięć', 9, 3, 1),
			term('najdroższe', 20)
		];
		const st = section(renderPage({ report }), 'Wyszukiwane hasła');
		expect(st).not.toContain('<details');
		expect(mainCells(st)).toEqual([
			'najdroższe',
			'więcej kliknięć',
			'więcej wyświetleń',
			'a',
			'b',
			'tanie'
		]);
	});

	it(`ponad ${SEARCH_TERMS_VISIBLE} haseł: reszta w zwiniętym „Pozostałe hasła”`, () => {
		const report = structuredClone(fixture) as StoredAdsReport;
		// 53 hasła w kolejności rosnącego kosztu — najdroższe muszą wyjść na wierzch.
		report.search_terms = Array.from({ length: SEARCH_TERMS_VISIBLE + 3 }, (_, i) =>
			term(`haslo-${String(i).padStart(2, '0')}`, i)
		);
		const { visible, folded } = splitDetails(section(renderPage({ report }), 'Wyszukiwane hasła'));
		const top = mainCells(visible);
		expect(top).toHaveLength(SEARCH_TERMS_VISIBLE);
		expect(top[0]).toBe('haslo-52');
		expect(top.at(-1)).toBe('haslo-03');
		expect(folded).not.toMatch(/^<details[^>]*\sopen/);
		expect(text(folded)).toContain('Pozostałe hasła (3)');
		expect(mainCells(folded)).toEqual(['haslo-02', 'haslo-01', 'haslo-00']);
	});
});
