<script lang="ts">
	import AreaChart from '$lib/components/AreaChart.svelte';
	import { RANGES, WEEKDAYS, type RangeKey, type TopRow } from '$lib/analytics';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	const rangeKeys = Object.keys(RANGES) as RangeKey[];
	const nf = new Intl.NumberFormat('pl-PL');

	/** Adres tej samej strony z podmienionym jednym parametrem — filtry działają bez JS. */
	function link(param: 'zakres' | 'host', value: string | null): string {
		const next: Record<string, string | null> = { zakres: data.range, host: data.host };
		next[param] = value;
		const params = new URLSearchParams();
		for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
		const query = params.toString();
		return query ? `/analityka?${query}` : '/analityka';
	}

	function pct(share: number): string {
		return `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
	}

	/**
	 * Zmiana wobec poprzedniego równego okresu. Bez poprzedniej wartości nie ma
	 * czego porównywać — kreska zamiast wzrostu o nieskończoność.
	 *
	 * Kierunek zwracamy osobno od tekstu, bo dla części kafelków wzrost jest
	 * dobry (odwiedzający), a dla części zły (czas odpowiedzi). Kolor nadaje
	 * dopiero wywołujący, który wie, o którą metrykę chodzi.
	 */
	function delta(now: number, before: number): { text: string; dir: 1 | 0 | -1 } {
		if (!before) return { text: '—', dir: 0 };
		const diff = (now - before) / before;
		if (Math.abs(diff) < 0.005) return { text: 'bez zmian', dir: 0 };
		return {
			text: `${diff > 0 ? '+' : ''}${(diff * 100).toFixed(0)}%`,
			dir: diff > 0 ? 1 : -1
		};
	}

	let perVisitor = $derived(
		data.totals.visitors
			? (data.totals.pageviews / data.totals.visitors).toFixed(1).replace('.', ',')
			: '—'
	);

	/**
	 * Kafelki. `higherIsBetter` decyduje, czy strzałka w górę jest zielona czy
	 * czerwona; `tone` to kolor z palety danych, po którym kafelek się rozpoznaje
	 * kątem oka — kolor jest tu etykietą, nie ozdobą, więc każdy ma inny.
	 */
	let tiles = $derived([
		{
			label: 'Odwiedzający',
			value: nf.format(data.totals.visitors),
			hint: 'bez botów',
			d: delta(data.totals.visitors, data.previousTotals.visitors),
			higherIsBetter: true,
			tone: 'var(--data-1)'
		},
		{
			label: 'Odsłony',
			value: nf.format(data.totals.pageviews),
			hint: `${perVisitor} na osobę`,
			d: delta(data.totals.pageviews, data.previousTotals.pageviews),
			higherIsBetter: true,
			tone: 'var(--data-2)'
		},
		{
			label: 'Czas odpowiedzi',
			value: `${nf.format(data.totals.p75ResponseMs)} ms`,
			hint: `75. percentyl, średnia ${nf.format(data.totals.avgResponseMs)} ms`,
			d: delta(data.totals.p75ResponseMs, data.previousTotals.p75ResponseMs),
			higherIsBetter: false,
			tone: 'var(--data-3)'
		},
		{
			label: 'Automaty',
			value: pct(data.totals.botShare),
			hint: `błędy ${pct(data.totals.errorShare)}`,
			d: delta(data.totals.botShare, data.previousTotals.botShare),
			higherIsBetter: false,
			tone: 'var(--data-4)'
		}
	]);

	/**
	 * Kolor kanału ruchu. Kanałów jest sześć i są stałym słownikiem, więc każdy
	 * dostaje własną barwę na stałe — ta sama kategoria ma mieć ten sam kolor
	 * przy każdym wejściu na stronę, inaczej kolor niczego nie znaczy.
	 */
	const CHANNEL_TONE: Record<string, string> = {
		'Asystenci AI': 'var(--data-3)',
		Wyszukiwarki: 'var(--data-1)',
		'Media społecznościowe': 'var(--data-5)',
		Kampanie: 'var(--data-4)',
		Polecenia: 'var(--data-2)',
		'Wejścia bezpośrednie': 'var(--color-text-faint)'
	};

	let refreshed = $derived(
		new Date(data.refreshedAt).toLocaleString('pl-PL', {
			timeZone: 'Europe/Warsaw',
			hour: '2-digit',
			minute: '2-digit'
		})
	);

	/** Największy serwis wyznacza skalę pasków w porównaniu stron. */
	let hostMax = $derived(Math.max(1, ...data.hostBreakdown.map((h) => h.pageviews)));

	// --- Mapa godzin ---------------------------------------------------------
	// Poniedziałek na górze czyta się naturalniej niż niedziela, którą zwraca SQL.
	const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

	let heat = $derived.by(() => {
		const grid = new Map<string, number>();
		for (const c of data.heatmap) grid.set(`${c.day}:${c.hour}`, c.value);
		const peak = Math.max(1, ...data.heatmap.map((c) => c.value));
		return { grid, peak };
	});

	function cellValue(day: number, hour: number): number {
		return heat.grid.get(`${day}:${hour}`) ?? 0;
	}

	/** Krycie komórki. Pierwiastek, bo liniowa skala gubi wszystko poza szczytem. */
	function cellOpacity(value: number): number {
		return value === 0 ? 0 : 0.12 + 0.88 * Math.sqrt(value / heat.peak);
	}

	const HOURS = Array.from({ length: 24 }, (_, h) => h);

	/** Zwijane tabele techniczne: kraje, urządzenia, przeglądarki, źródła. */
	let details: { title: string; head: string; rows: TopRow[] }[] = $derived([
		{ title: 'Kraje', head: 'Kraj', rows: data.countries },
		{ title: 'Urządzenia', head: 'Klasa', rows: data.devices },
		{ title: 'Przeglądarki', head: 'Rodzina', rows: data.browsers },
		{ title: 'Adresy odsyłające', head: 'Host', rows: data.referrers }
	]);
</script>

<svelte:head><title>Analityka — Aura HUB</title></svelte:head>

<div class="head">
	<h1 class="page-title" style="margin: 0">Analityka</h1>
	<span class="faint" style="font-size: var(--text-xs)">
		{data.rangeLabel} · czas warszawski · odświeżono {refreshed}
	</span>
</div>

{#if data.error}
	<div class="alert alert-error">{data.error}</div>
{/if}

<div class="bar">
	<div class="chips">
		{#each rangeKeys as key (key)}
			<a class="chip" class:on={data.range === key} href={link('zakres', key)}>{RANGES[key].label}</a>
		{/each}
	</div>
	<div class="chips">
		<a class="chip" class:on={!data.host} href={link('host', null)}>Wszystkie serwisy</a>
		{#each data.hosts as host (host)}
			<a class="chip" class:on={data.host === host} href={link('host', host)}>{host}</a>
		{/each}
	</div>
</div>

<div class="tiles">
	{#each tiles as t (t.label)}
		<div class="tile" style="--tone: {t.tone}">
			<div class="t-label">{t.label}</div>
			<div class="t-value">
				{t.value}
				{#if t.d.dir !== 0}
					<span class="t-delta" class:good={(t.d.dir === 1) === t.higherIsBetter}>{t.d.text}</span>
				{/if}
			</div>
			<div class="t-hint">{t.hint}</div>
		</div>
	{/each}
</div>

<div class="card chart-card">
	<div class="card-head">
		<h3>Odsłony w czasie</h3>
		<span class="faint">{data.range === '24h' ? 'co godzinę' : 'dziennie'}</span>
	</div>
	<AreaChart data={data.timeline} color="var(--data-1)" />
</div>

<div class="grid2">
	<div class="card" style="--bar: var(--data-2)">
		<div class="card-head"><h3>Najczęściej odwiedzane strony</h3></div>
		{#if data.paths.length === 0}
			<p class="muted small">Brak danych w tym okresie.</p>
		{:else}
			<ul class="rank">
				{#each data.paths as row (row.label)}
					<li>
						<span class="fill" style="width: {row.share * 100}%"></span>
						<span class="r-label mono" title={row.label}>{row.label}</span>
						<span class="r-value">{nf.format(row.value)}</span>
						<span class="r-share faint">{pct(row.share)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<div class="card">
		<div class="card-head"><h3>Kanały ruchu</h3></div>
		{#if data.channels.length === 0}
			<p class="muted small">Brak danych w tym okresie.</p>
		{:else}
			<ul class="rank">
				{#each data.channels as row (row.label)}
					<li style="--bar: {CHANNEL_TONE[row.label] ?? 'var(--color-accent)'}">
						<span class="fill" style="width: {row.share * 100}%"></span>
						<span class="r-label">{row.label}</span>
						<span class="r-value">{nf.format(row.value)}</span>
						<span class="r-share faint">{pct(row.share)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

{#if !data.host && data.hostBreakdown.length > 1}
	<div class="card" style="--bar: var(--data-1)">
		<div class="card-head">
			<h3>Serwisy</h3>
			<span class="faint">odsłony i odwiedzający</span>
		</div>
		<ul class="rank">
			{#each data.hostBreakdown as row (row.host)}
				<li>
					<span class="fill" style="width: {(row.pageviews / hostMax) * 100}%"></span>
					<a class="r-label link" href={link('host', row.host)}>{row.host}</a>
					<span class="r-value">{nf.format(row.pageviews)}</span>
					<span class="r-share faint">{nf.format(row.visitors)} os.</span>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<div class="card">
	<div class="card-head">
		<h3>Kiedy Cię czytają</h3>
		<span class="faint">ciemniejsze pole to więcej odsłon</span>
	</div>
	{#if data.heatmap.length === 0}
		<p class="muted small">Brak danych w tym okresie.</p>
	{:else}
		<div class="heat">
			<div class="heat-hours">
				<span></span>
				{#each HOURS as h (h)}
					<span class="hh">{h % 6 === 0 ? h : ''}</span>
				{/each}
			</div>
			{#each DAY_ORDER as day (day)}
				<div class="heat-row">
					<span class="hd faint">{WEEKDAYS[day]}</span>
					{#each HOURS as hour (hour)}
						{@const v = cellValue(day, hour)}
						<span
							class="hc"
							style="opacity: {cellOpacity(v)}"
							title="{WEEKDAYS[day]} {String(hour).padStart(2, '0')}:00 — {v} odsłon"
						></span>
					{/each}
				</div>
			{/each}
		</div>
	{/if}
</div>

<div class="grid2">
	<div class="card">
		<div class="card-head"><h3>Ruch z kampanii</h3></div>
		{#if data.campaigns.length === 0}
			<p class="muted small">
				Brak wejść z parametrami <span class="mono">utm_*</span>. Google Ads taguje kliknięcia
				identyfikatorem <span class="mono">gclid</span>, którego celowo nie zapisujemy — dopisz
				<span class="mono">utm_*</span> do finalnych adresów w kampaniach, żeby ruch płatny był tu widoczny.
			</p>
		{:else}
			<table class="tbl compact">
				<thead>
					<tr><th>Kampania</th><th>Źródło</th><th class="num">Wejścia</th></tr>
				</thead>
				<tbody>
					{#each data.campaigns as row (row.campaign + row.source + row.medium)}
						<tr>
							<td class="mono">{row.campaign || '—'}</td>
							<td>{row.source}{row.medium !== '—' ? ` / ${row.medium}` : ''}</td>
							<td class="num">{nf.format(row.value)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

	<div class="card">
		<div class="card-head">
			<h3>Adresy z błędem</h3>
			<span class="faint">bez skanerów</span>
		</div>
		{#if data.broken.length === 0}
			<p class="muted small">Żaden prawdziwy adres nie zwrócił błędu. Tak ma być.</p>
		{:else}
			<table class="tbl compact">
				<thead>
					<tr><th>Adres</th><th class="num">Kod</th><th class="num">Trafień</th></tr>
				</thead>
				<tbody>
					{#each data.broken as row (row.path + row.status)}
						<tr>
							<td class="mono">{row.path}</td>
							<td class="num">{row.status}</td>
							<td class="num">{nf.format(row.value)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>

<details class="card details">
	<summary>Szczegóły techniczne: kraje, urządzenia, przeglądarki, adresy odsyłające</summary>
	<div class="grid2" style="margin-top: var(--space-4)">
		{#each details as d (d.title)}
			<div>
				<h4>{d.title}</h4>
				{#if d.rows.length === 0}
					<p class="muted small">Brak danych.</p>
				{:else}
					<ul class="rank">
						{#each d.rows as row (row.label)}
							<li>
								<span class="fill" style="width: {row.share * 100}%"></span>
								<span class="r-label">{row.label}</span>
								<span class="r-value">{nf.format(row.value)}</span>
								<span class="r-share faint">{pct(row.share)}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/each}
	</div>
</details>

<details class="card details">
	<summary>Core Web Vitals i jak czytać te liczby</summary>
	<div class="small" style="margin-top: var(--space-3)">
		<p>
			<strong>Core Web Vitals.</strong> Szybkość ładowania da się zmierzyć wyłącznie w przeglądarce,
			więc wymaga osobnego skryptu po stronie klienta. Miejsce jest przygotowane, dane pojawią się po
			wdrożeniu endpointu <span class="mono">/__vitals</span>.
		</p>
		<p>
			<strong>Automaty.</strong> Rozpoznajemy je po wzorcach adresu i User-Agenta, bo Bot Management
			wymaga płatnego planu. Skanery podszywające się pod przeglądarkę wpadają częściowo do ruchu
			ludzkiego, więc ich udział jest zaniżony, a odsłony zawyżone.
		</p>
		<p>
			<strong>Odwiedzający.</strong> Liczeni skrótem z solą zmienianą co dobę, bez ciasteczek. Ta sama
			osoba w dwa różne dni to dwie osoby, więc suma z tygodnia jest wyższa niż rzeczywista liczba
			ludzi.
		</p>
	</div>
</details>

<style>
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}

	/* Filtry jako jeden pasek, nie karta z nagłówkami — zajmowały pół ekranu. */
	.bar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		justify-content: space-between;
		margin-bottom: var(--space-4);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.chip {
		padding: 0.25rem 0.6rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: var(--text-xs);
		text-decoration: none;
		color: var(--color-text-muted);
		white-space: nowrap;
	}
	.chip:hover {
		color: var(--color-text);
	}
	.chip.on {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: #fff;
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}
	/* Kafelek trzyma swój kolor w zmiennej --tone: pasek u góry i liczba biorą
	   go stamtąd, więc zmiana koloru kafelka to jedno miejsce w skrypcie. */
	.tile {
		position: relative;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-3) var(--space-4);
		overflow: hidden;
	}
	.tile::before {
		content: '';
		position: absolute;
		inset: 0 0 auto 0;
		height: 3px;
		background: var(--tone, var(--color-accent));
	}
	.t-label {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.t-value {
		font-size: 1.6rem;
		font-weight: 600;
		line-height: 1.2;
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		color: var(--tone, var(--color-text));
		font-variant-numeric: tabular-nums;
	}
	.t-delta {
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--color-error);
	}
	.t-delta.good {
		color: var(--color-success);
	}
	.t-hint {
		font-size: var(--text-xs);
		color: var(--color-text-faint);
	}

	.card {
		margin-bottom: var(--space-4);
	}
	.card-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
	}
	.card-head h3 {
		margin: 0;
		font-size: var(--text-base);
	}
	.card-head .faint {
		font-size: var(--text-xs);
	}
	.chart-card {
		padding-bottom: var(--space-2);
	}
	.grid2 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: var(--space-4);
	}
	.small {
		font-size: var(--text-sm);
	}
	.muted.small {
		margin: 0;
	}

	/* Lista rankingowa: pasek udziału w tle wiersza zamiast osobnej kolumny
	   z procentem. Proporcje widać wtedy jednym spojrzeniem, bez czytania liczb. */
	.rank {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rank li {
		position: relative;
		display: grid;
		grid-template-columns: 1fr auto auto;
		align-items: center;
		gap: var(--space-3);
		padding: 0.35rem 0.5rem;
		font-size: var(--text-sm);
		border-radius: var(--radius-sm);
	}
	.rank li + li {
		margin-top: 2px;
	}
	/* Pasek udziału bierze kolor z --bar ustawionego na karcie albo na wierszu.
	   Domyślny akcent zostaje dla list, które własnego koloru nie potrzebują. */
	.fill {
		position: absolute;
		inset: 0 auto 0 0;
		background: var(--bar, var(--color-accent));
		opacity: 0.18;
		border-radius: var(--radius-sm);
		pointer-events: none;
	}
	.rank li:hover .fill {
		opacity: 0.3;
	}
	.r-label {
		position: relative;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.r-label.link {
		color: var(--color-text);
		text-decoration: none;
	}
	.r-label.link:hover {
		text-decoration: underline;
	}
	.r-value {
		position: relative;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.r-share {
		position: relative;
		font-size: var(--text-xs);
		min-width: 3.2rem;
		text-align: right;
	}

	/* Mapa godzin. Siatka 24 kolumn na siedem wierszy; komórki są kwadratowe
	   i kurczą się razem z kartą, więc nie trzeba przewijać w poziomie. */
	.heat {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.heat-hours,
	.heat-row {
		display: grid;
		grid-template-columns: 1.6rem repeat(24, 1fr);
		gap: 2px;
		align-items: center;
	}
	.hh {
		font-size: 9px;
		color: var(--color-text-faint);
		text-align: center;
	}
	.hd {
		font-size: var(--text-xs);
	}
	.hc {
		aspect-ratio: 1;
		background: var(--data-1);
		border-radius: 2px;
		min-height: 10px;
		outline: 1px solid var(--color-border);
		outline-offset: -1px;
	}

	.details summary {
		cursor: pointer;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.details h4 {
		margin: 0 0 var(--space-2);
		font-size: var(--text-sm);
	}
	.tbl.compact th,
	.tbl.compact td {
		padding: 0.35rem 0.5rem;
		font-size: var(--text-sm);
	}
</style>
