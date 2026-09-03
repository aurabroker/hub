<script lang="ts">
	import { fmtDateTime } from '$lib/ud/format';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	/** Kliknięcia na leada. Bez kliknięć nie liczymy nic — dzielenie przez zero. */
	function conversion(clicks: number, leads: number): string {
		if (!clicks) return '—';
		return `${((leads / clicks) * 100).toFixed(1)}%`;
	}
</script>

<svelte:head><title>Raport UTM — Aura HUB</title></svelte:head>

<h1 class="page-title">Skuteczność kampanii</h1>
<p class="page-subtitle">
	Kliknięcia liczone z dwóch źródeł: własne przekierowanie <span class="mono">/l/</span> zapisuje
	je od razu, a liczniki linków Bitly trzeba pobrać przyciskiem „Statystyki Bitly” w
	<a href="/utm">generatorze</a>. Leady pochodzą z tabeli atrybucji, którą zasilają formularze na
	landingach.
</p>

<div class="kpi-grid">
	<div class="kpi-card">
		<div class="kpi-label">Kampanie</div>
		<div class="kpi-value">{data.totals.campaigns}</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Kliknięcia</div>
		<div class="kpi-value">{data.totals.clicks}</div>
		<div class="kpi-sub">własne przekierowanie plus Bitly</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Leady z atrybucją</div>
		<div class="kpi-value">{data.totals.attributions}</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Konwersja</div>
		<div class="kpi-value">{conversion(data.totals.clicks, data.totals.leads)}</div>
		<div class="kpi-sub">leady na kliknięcie</div>
	</div>
</div>

{#if data.totals.attributions === 0}
	<div class="alert alert-warning">
		Tabela atrybucji jest pusta. Kliknięcia liczą się poprawnie, ale dopóki formularze na
		landingach nie wyślą parametrów UTM na endpoint
		<span class="mono">/api/webhooks/utm-attribution</span>, kolumna „Leady” zostanie na zerze.
		Instrukcja wdrożenia jest w README, w sekcji o module UTM.
	</div>
{/if}

<div class="table-wrap">
	<div class="table-toolbar"><h3>Kampanie ({data.performance.length})</h3></div>
	<div class="table-scroll">
		<table class="tbl">
			<thead>
				<tr>
					<th>Kampania</th>
					<th>Źródło / medium</th>
					<th class="num">Linki</th>
					<th class="num">Kliknięcia własne</th>
					<th class="num">Kliknięcia Bitly</th>
					<th class="num">Razem</th>
					<th class="num">Leady</th>
					<th class="num">Konwersja</th>
					<th>Ostatnie kliknięcie</th>
				</tr>
			</thead>
			<tbody>
				{#each data.performance as row (`${row.utm_campaign}|${row.utm_source}|${row.utm_medium}`)}
					<tr>
						<td><strong>{row.utm_campaign ?? '—'}</strong></td>
						<td class="mono" style="font-size: var(--text-sm)">{row.utm_source ?? '—'} / {row.utm_medium ?? '—'}</td>
						<td class="num">{row.links}</td>
						<td class="num">{row.clicks_own}</td>
						<td class="num">{row.clicks_bitly}</td>
						<td class="num"><strong>{row.clicks_total}</strong></td>
						<td class="num">{row.leads}</td>
						<td class="num">{conversion(Number(row.clicks_total), Number(row.leads))}</td>
						<td>{row.last_click_at ? fmtDateTime(row.last_click_at) : '—'}</td>
					</tr>
				{:else}
					<tr><td colspan="9" class="faint">Brak danych. Utwórz linki w generatorze.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<div class="table-wrap">
	<div class="table-toolbar"><h3>Ostatnie leady z atrybucją</h3></div>
	<div class="table-scroll">
		<table class="tbl">
			<thead>
				<tr><th>Kiedy</th><th>Kontakt</th><th>Kampania</th><th>Źródło / medium</th><th>Landing</th></tr>
			</thead>
			<tbody>
				{#each data.recent as row (row.id)}
					<tr>
						<td>{fmtDateTime(row.created_at)}</td>
						<td>
							{row.email ?? '—'}
							{#if row.company_id}
								<br /><a class="mono faint" style="font-size: var(--text-sm)" href="/clients/{row.company_id}">
									karta klienta #{row.company_id}
								</a>
							{/if}
						</td>
						<td>{row.utm_campaign ?? '—'}</td>
						<td class="mono" style="font-size: var(--text-sm)">{row.utm_source ?? '—'} / {row.utm_medium ?? '—'}</td>
						<td class="mono" style="font-size: var(--text-sm); max-width: 280px; word-break: break-all">
							{row.landing_url ?? '—'}
						</td>
					</tr>
				{:else}
					<tr><td colspan="5" class="faint">Brak zapisanych źródeł leadów.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
