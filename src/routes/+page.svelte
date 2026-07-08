<script lang="ts">
	import BarChart from '$lib/components/BarChart.svelte';
	import { CODE_LABELS, type CanonicalCode } from '$lib/categories';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	function shortDate(iso: string): string {
		const d = new Date(iso);
		return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
	}

	function codeLabel(code: string): string {
		return CODE_LABELS[code as CanonicalCode] ?? code;
	}

	let signupPoints = $derived(
		data.signups.map((s) => ({ label: shortDate(s.dzien), title: s.dzien, value: s.n }))
	);
	let interestPoints = $derived(
		data.interest.map((i) => ({ label: codeLabel(i.kategoria), value: i.n }))
	);

	// Suma wysyłek per dzień (sekcje rozbite w tabeli poniżej)
	let sentPerDay = $derived.by(() => {
		const byDay = new Map<string, number>();
		for (const row of data.sentDaily) {
			byDay.set(row.dzien, (byDay.get(row.dzien) ?? 0) + row.wyslane);
		}
		return [...byDay.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([dzien, n]) => ({ label: shortDate(dzien), title: dzien, value: n }));
	});
</script>

<svelte:head><title>Pulpit — Aura HUB</title></svelte:head>

<h1 class="page-title">Pulpit</h1>
<p class="page-subtitle">Analityka bazy kontaktów i wysyłek e-mail.</p>

<div class="kpi-grid">
	<div class="kpi-card">
		<div class="kpi-label">Kontakty w bazie</div>
		<div class="kpi-value">{data.kpi.contactsTotal.toLocaleString('pl-PL')}</div>
		<div class="kpi-sub">+{data.kpi.newWeek} w tym tygodniu, +{data.kpi.newMonth} w 30 dni</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Duplikaty do rozwiązania</div>
		<div class="kpi-value" style:color={data.kpi.duplicateGroups > 0 ? 'var(--color-warning)' : undefined}>
			{data.kpi.duplicateGroups}
		</div>
		<div class="kpi-sub"><a href="/duplicates">grupy wg e-mail / NIP →</a></div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Maile wysłane</div>
		<div class="kpi-value">{data.kpi.sent30.toLocaleString('pl-PL')}</div>
		<div class="kpi-sub">ostatnie 30 dni ({data.kpi.sentToday} dziś)</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Open / click rate (30 dni)</div>
		<div class="kpi-value">
			{data.kpi.openRate ?? '—'}{data.kpi.openRate != null ? '%' : ''}
			<span class="muted" style="font-size: 1rem">/ {data.kpi.clickRate ?? '—'}{data.kpi.clickRate != null ? '%' : ''}</span>
		</div>
		<div class="kpi-sub">otwarcia orientacyjne — kliknięcia to pewniejszy sygnał</div>
	</div>
</div>

<div class="grid-2">
	<div class="card">
		<h3 style="margin-bottom: var(--space-4)">Zapisy do bazy dziennie (30 dni)</h3>
		<BarChart data={signupPoints} />
	</div>
	<div class="card">
		<h3 style="margin-bottom: var(--space-4)">Której sekcji szukają (cała baza)</h3>
		<BarChart data={interestPoints} color="var(--c-oc)" maxXLabels={8} />
	</div>
</div>

<div class="card">
	<h3 style="margin-bottom: var(--space-4)">Wysłane maile dziennie</h3>
	<BarChart data={sentPerDay} color="var(--c-grupowe)" />
</div>

<div class="table-wrap">
	<div class="table-toolbar"><h3>Wysyłka wg dnia i sekcji</h3></div>
	<div class="table-scroll">
		<table class="tbl">
			<thead>
				<tr>
					<th>Dzień</th>
					<th>Sekcja</th>
					<th class="num">Wysłane</th>
					<th class="num">Otwarcia</th>
					<th class="num">Kliknięcia</th>
				</tr>
			</thead>
			<tbody>
				{#each data.sentDaily as row (row.dzien + row.sekcja)}
					<tr>
						<td>{row.dzien}</td>
						<td>{codeLabel(row.sekcja)}</td>
						<td class="num">{row.wyslane}</td>
						<td class="num">{row.otwarcia}</td>
						<td class="num">{row.klikniecia}</td>
					</tr>
				{:else}
					<tr><td colspan="5" class="muted">Jeszcze nic nie wysłano.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<div class="table-wrap">
	<div class="table-toolbar"><h3>Rozkład zainteresowań (kody kanoniczne)</h3></div>
	<div class="table-scroll">
		<table class="tbl">
			<thead>
				<tr><th>Kategoria</th><th class="num">Kontakty</th></tr>
			</thead>
			<tbody>
				{#each data.interest as row (row.kategoria)}
					<tr>
						<td>{codeLabel(row.kategoria)} <span class="faint mono">({row.kategoria})</span></td>
						<td class="num">{row.n}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
