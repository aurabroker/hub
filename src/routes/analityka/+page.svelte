<script lang="ts">
	import BarChart from '$lib/components/BarChart.svelte';
	import { RANGES, type RangeKey, type TopRow } from '$lib/analytics';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	const rangeKeys = Object.keys(RANGES) as RangeKey[];

	/** Adres tej samej strony z podmienionym jednym parametrem — filtry działają bez JS. */
	function link(param: 'zakres' | 'host', value: string | null): string {
		const params = new URLSearchParams();
		const next = { zakres: data.range as string, host: data.host };
		next[param] = value as never;
		if (next.zakres) params.set('zakres', next.zakres);
		if (next.host) params.set('host', next.host);
		const query = params.toString();
		return query ? `/analityka?${query}` : '/analityka';
	}

	const nf = new Intl.NumberFormat('pl-PL');

	function pct(share: number): string {
		return `${(share * 100).toFixed(1)}%`;
	}

	/**
	 * Zmiana wobec poprzedniego równego okresu. Bez poprzedniej wartości nie ma
	 * czego porównywać — pokazujemy kreskę zamiast wzrostu o nieskończoność.
	 */
	function change(now: number, before: number): string {
		if (!before) return '—';
		const diff = (now - before) / before;
		if (Math.abs(diff) < 0.005) return 'bez zmian';
		const sign = diff > 0 ? '+' : '';
		return `${sign}${(diff * 100).toFixed(0)}% wobec poprzednich ${data.rangeLabel.toLowerCase()}`;
	}

	let tiles = $derived([
		{
			label: 'Odsłony',
			value: nf.format(data.totals.pageviews),
			change: change(data.totals.pageviews, data.previousTotals.pageviews)
		},
		{
			label: 'Unikalni odwiedzający',
			value: nf.format(data.totals.visitors),
			change: change(data.totals.visitors, data.previousTotals.visitors),
			sub: 'bez botów, skrót dobowy'
		},
		{
			label: 'Średni czas odpowiedzi',
			value: `${nf.format(data.totals.avgResponseMs)} ms`,
			change: change(data.totals.avgResponseMs, data.previousTotals.avgResponseMs)
		},
		{
			label: 'Odpowiedzi z błędem',
			value: pct(data.totals.errorShare),
			change: change(data.totals.errorShare, data.previousTotals.errorShare)
		},
		{
			label: 'Udział botów',
			value: pct(data.totals.botShare),
			change: change(data.totals.botShare, data.previousTotals.botShare),
			sub: 'zaniżony, patrz uwaga pod tabelami'
		}
	]);

	const tables: { title: string; head: string; rows: () => TopRow[] }[] = [
		{ title: 'Najczęściej odwiedzane strony', head: 'Ścieżka', rows: () => data.paths },
		{ title: 'Kraje', head: 'Kraj', rows: () => data.countries },
		{ title: 'Źródła ruchu', head: 'Skąd przyszli', rows: () => data.referrers },
		{ title: 'Urządzenia', head: 'Klasa', rows: () => data.devices },
		{ title: 'Przeglądarki', head: 'Rodzina', rows: () => data.browsers }
	];

	let refreshed = $derived(
		new Date(data.refreshedAt).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })
	);
</script>

<svelte:head><title>Analityka — Aura HUB</title></svelte:head>

<h1 class="page-title">Analityka</h1>
<p class="page-subtitle">
	Ruch mierzony po stronie serwera, bez ciasteczek i bez skryptu śledzącego. Czas w strefie
	Europe/Warsaw. Odświeżono {refreshed}, wyniki zapytań są cache'owane przez minutę.
</p>

{#if data.error}
	<div class="alert alert-error">{data.error}</div>
{/if}

<div class="card" style="margin-bottom: var(--space-6)">
	<div class="filters">
		<div class="filter-group">
			<span class="form-label">Zakres</span>
			<div class="chips">
				{#each rangeKeys as key (key)}
					<a class="chip" class:chip-active={data.range === key} href={link('zakres', key)}>
						{RANGES[key].label}
					</a>
				{/each}
			</div>
		</div>
		<div class="filter-group">
			<span class="form-label">Serwis</span>
			<div class="chips">
				<a class="chip" class:chip-active={!data.host} href={link('host', null)}>Wszystkie</a>
				{#each data.hosts as host (host)}
					<a class="chip" class:chip-active={data.host === host} href={link('host', host)}>
						{host}
					</a>
				{/each}
			</div>
		</div>
	</div>
</div>

<div class="kpi-grid">
	{#each tiles as tile (tile.label)}
		<div class="kpi-card">
			<div class="kpi-label">{tile.label}</div>
			<div class="kpi-value">{tile.value}</div>
			<div class="kpi-sub">{tile.change}</div>
			{#if tile.sub}<div class="kpi-sub faint">{tile.sub}</div>{/if}
		</div>
	{/each}
</div>

<div class="card">
	<h3 style="margin-bottom: var(--space-4)">
		Odsłony w czasie ({data.range === '24h' ? 'co godzinę' : 'dziennie'})
	</h3>
	<BarChart data={data.timeline} />
</div>

<div class="table-wrap">
	<div class="table-toolbar"><h3>Ruch z kampanii</h3></div>
	{#if data.campaigns.length === 0}
		<p class="muted" style="padding: var(--space-4)">
			Brak wejść z parametrami <span class="mono">utm_*</span> w tym okresie. Kampanie Google Ads
			domyślnie tagują kliknięcia identyfikatorem <span class="mono">gclid</span>, którego celowo
			nie zapisujemy — żeby ruch płatny był tu widoczny, dopisz parametry
			<span class="mono">utm_*</span> do finalnych adresów w Google Ads.
		</p>
	{:else}
		<div class="table-scroll">
			<table class="tbl">
				<thead>
					<tr>
						<th>Kampania</th>
						<th>Źródło</th>
						<th>Medium</th>
						<th class="num">Wejścia</th>
					</tr>
				</thead>
				<tbody>
					{#each data.campaigns as row (row.campaign + row.source + row.medium)}
						<tr>
							<td class="mono">{row.campaign}</td>
							<td>{row.source}</td>
							<td>{row.medium}</td>
							<td class="num">{nf.format(row.value)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<div class="tables-grid">
	{#each tables as table (table.title)}
		<div class="table-wrap">
			<div class="table-toolbar"><h3>{table.title}</h3></div>
			{#if table.rows().length === 0}
				<p class="muted" style="padding: var(--space-4)">Brak danych w tym okresie.</p>
			{:else}
				<div class="table-scroll">
					<table class="tbl">
						<thead>
							<tr>
								<th>{table.head}</th>
								<th class="num">Odsłony</th>
								<th class="num">Udział</th>
							</tr>
						</thead>
						<tbody>
							{#each table.rows() as row (row.label)}
								<tr>
									<td class="mono">{row.label}</td>
									<td class="num">{nf.format(row.value)}</td>
									<td class="num">{pct(row.share)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	{/each}
</div>

<div class="card">
	<h3 style="margin-bottom: var(--space-4)">Core Web Vitals</h3>
	<p class="muted">
		Szybkość ładowania da się zmierzyć wyłącznie w przeglądarce, więc wymaga osobnego skryptu po
		stronie klienta. Miejsce jest przygotowane, dane pojawią się po wdrożeniu endpointu
		<span class="mono">/__vitals</span>.
	</p>
</div>

<div class="alert alert-warning" style="margin-top: var(--space-6)">
	<strong>Jak czytać udział botów.</strong> Rozpoznajemy je po wzorcach adresu i User-Agenta, bo
	Bot Management wymaga płatnego planu. Skanery podszywające się pod przeglądarkę wpadają częściowo
	do ruchu ludzkiego, więc udział botów jest zaniżony, a odsłony zawyżone. Tabela najczęściej
	odwiedzanych stron pomija boty i odpowiedzi z błędem, tabela urządzeń świadomie nie pomija.
</div>

<style>
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-6);
	}
	.filter-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.chip {
		padding: 0.35rem 0.7rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: var(--text-sm);
		text-decoration: none;
		color: var(--color-text);
		white-space: nowrap;
	}
	.chip-active {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: #fff;
	}
	.tables-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: var(--space-4);
	}
</style>
