<script lang="ts">
	import type { PageServerData } from './$types';
	import type { CrmClient } from '$lib/ud/types';
	import { dayKey, todayKey, fmtDateTime, dayLabel } from '$lib/ud/format';
	import PersonModal from '$lib/components/PersonModal.svelte';

	let { data }: { data: PageServerData } = $props();

	let rangeFilter = $state<'all' | 'today' | '7' | '30'>('all');
	let typFilter = $state<'all' | 'firma' | 'osoba'>('all');
	let selected = $state<CrmClient | null>(null);

	const today = todayKey();
	const now = Date.now();

	function isToday(iso: string): boolean {
		return dayKey(iso) === today;
	}

	let signups = $derived(data.signups.filter((s) => !!s.created_at));

	let filtered = $derived.by(() => {
		let list = signups;
		if (typFilter !== 'all') list = list.filter((s) => (s.typ ?? '').toLowerCase() === typFilter);
		if (rangeFilter === 'today') list = list.filter((s) => isToday(s.created_at));
		else if (rangeFilter !== 'all') {
			const days = Number(rangeFilter);
			list = list.filter((s) => now - new Date(s.created_at).getTime() <= days * 864e5);
		}
		return list;
	});

	let kpi = $derived.by(() => {
		const inDays = (d: number) =>
			signups.filter((s) => now - new Date(s.created_at).getTime() <= d * 864e5).length;
		return {
			today: signups.filter((s) => isToday(s.created_at)).length,
			d7: inDays(7),
			d30: inDays(30),
			total: signups.length
		};
	});

	type GroupRow =
		| { kind: 'header'; dayKey: string; label: string; today: boolean }
		| { kind: 'row'; client: CrmClient; today: boolean };

	let grouped = $derived.by(() => {
		const rows: GroupRow[] = [];
		let lastDay: string | null = null;
		for (const c of filtered) {
			const dk = dayKey(c.created_at);
			const isTodayRow = dk === today;
			if (dk !== lastDay) {
				rows.push({ kind: 'header', dayKey: dk, label: dayLabel(dk), today: isTodayRow });
				lastDay = dk;
			}
			rows.push({ kind: 'row', client: c, today: isTodayRow });
		}
		return rows;
	});
</script>

<svelte:head><title>Zapisy dzienne — Aura HUB</title></svelte:head>

<h1 class="page-title">Zapisy dzienne</h1>
<p class="page-subtitle">
	Codzienne zapisy Klientów do bazy CRM. Zapisy z dnia dzisiejszego zaznaczone
	<strong style="color: var(--color-success)">na zielono</strong>. Kliknij wiersz, aby zobaczyć wszystkie
	dane Klienta.
</p>

{#if data.error}
	<div class="alert alert-error" style="margin-bottom: var(--space-4)">
		Nie udało się pobrać danych: {data.error}
	</div>
{/if}

<div class="kpi-grid">
	<div class="kpi-card" style="border-color: var(--color-success)">
		<div class="kpi-label">Zapisy dziś</div>
		<div class="kpi-value" style="color: var(--color-success)">{kpi.today}</div>
		<div class="kpi-sub">
			{kpi.today > 0 ? 'zaznaczone na zielono na liście' : 'jeszcze nikt się dziś nie zapisał'}
		</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Ostatnie 7 dni</div>
		<div class="kpi-value">{kpi.d7}</div>
		<div class="kpi-sub">nowe zapisy</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Ostatnie 30 dni</div>
		<div class="kpi-value">{kpi.d30}</div>
		<div class="kpi-sub">nowe zapisy</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Łącznie w bazie</div>
		<div class="kpi-value">{kpi.total}</div>
		<div class="kpi-sub">wszyscy Klienci</div>
	</div>
</div>

<div class="table-wrap">
	<div class="table-toolbar">
		<h3>Zapisy wg dni</h3>
		<div style="display: flex; gap: var(--space-2); flex-wrap: wrap">
			<select class="form-select" bind:value={rangeFilter} style="width: auto">
				<option value="all">Cały okres</option>
				<option value="today">Tylko dziś</option>
				<option value="7">Ostatnie 7 dni</option>
				<option value="30">Ostatnie 30 dni</option>
			</select>
			<select class="form-select" bind:value={typFilter} style="width: auto">
				<option value="all">Wszystkie typy</option>
				<option value="firma">Firmy</option>
				<option value="osoba">Osoby fizyczne</option>
			</select>
		</div>
	</div>
	<div class="table-scroll">
		<table class="tbl">
			<thead>
				<tr>
					<th>Klient</th>
					<th>Kontakt</th>
					<th>NIP / PESEL</th>
					<th>RODO</th>
					<th>Data zapisu</th>
				</tr>
			</thead>
			<tbody>
				{#each grouped as row (row.kind === 'header' ? 'h-' + row.dayKey : 'r-' + row.client.id)}
					{#if row.kind === 'header'}
						<tr class="date-sep" class:today-sep={row.today}>
							<td colspan="5">{row.label}</td>
						</tr>
					{:else}
						{@const c = row.client}
						<tr class="row-click" class:row-today={row.today} onclick={() => (selected = c)}>
							<td>
								<strong>{c.nazwa ?? c.nazwa_skrocona ?? '—'}</strong>
								{#if c.typ}<br /><span class="faint">{c.typ}</span>{/if}
							</td>
							<td>
								{c.email ?? '—'}
								{#if c.telefon}<br /><span class="faint">{c.telefon}</span>{/if}
							</td>
							<td>
								{c.nip ?? c.pesel ?? '—'}
								{#if c.regon}<br /><span class="faint">REGON: {c.regon}</span>{/if}
							</td>
							<td>
								{#if c.rodo_zgoda}
									<span class="badge badge-success">Tak</span>
								{:else}
									<span class="badge badge-muted">Brak</span>
								{/if}
							</td>
							<td style="white-space: nowrap">
								{fmtDateTime(c.created_at)}
								{#if row.today}<span class="badge badge-today" style="margin-left: 6px">DZIŚ</span>{/if}
							</td>
						</tr>
					{/if}
				{:else}
					<tr>
						<td colspan="5" class="muted" style="text-align: center; padding: var(--space-8)">
							Brak zapisów w wybranym zakresie.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<PersonModal client={selected} onclose={() => (selected = null)} />
