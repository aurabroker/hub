<script lang="ts">
	import type { PageServerData } from './$types';
	import type { Signup } from '$lib/ud/types';
	import { dayKey, todayKey, fmtDateTime, dayLabel } from '$lib/ud/format';
	import PersonModal from '$lib/components/PersonModal.svelte';

	let { data }: { data: PageServerData } = $props();

	let rangeFilter = $state<'all' | 'today' | '7' | '30'>('all');
	let typeFilter = $state<'all' | 'client' | 'contact'>('all');
	let selected = $state<Signup | null>(null);

	const today = todayKey();
	const now = Date.now();

	function isToday(iso: string): boolean {
		return dayKey(iso) === today;
	}

	let signups = $derived(data.signups);

	let filtered = $derived.by(() => {
		let list = signups;
		if (typeFilter !== 'all') list = list.filter((s) => s.type === typeFilter);
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

	// Grupowanie po dniu — do wstawek nagłówków dni w tabeli
	type GroupRow = { kind: 'header'; dayKey: string; label: string; today: boolean } | { kind: 'row'; signup: Signup; today: boolean };
	let grouped = $derived.by(() => {
		const rows: GroupRow[] = [];
		let lastDay: string | null = null;
		for (const s of filtered) {
			const dk = dayKey(s.created_at);
			const isTodayRow = dk === today;
			if (dk !== lastDay) {
				rows.push({ kind: 'header', dayKey: dk, label: dayLabel(dk), today: isTodayRow });
				lastDay = dk;
			}
			rows.push({ kind: 'row', signup: s, today: isTodayRow });
		}
		return rows;
	});
</script>

<svelte:head><title>Zapisy dzienne — Aura HUB</title></svelte:head>

<h1 class="page-title">Zapisy dzienne</h1>
<p class="page-subtitle">
	Codzienne zapisy do bazy (utratadochodu.com). Zapisy z dnia dzisiejszego zaznaczone
	<strong style="color: var(--color-success)">na zielono</strong>. Kliknij wiersz, aby zobaczyć dane osoby.
</p>

{#if data.errors.length}
	<div class="alert alert-error" style="margin-bottom: var(--space-4)">
		Nie udało się pobrać części danych: {data.errors.join(' · ')}
	</div>
{/if}

<div class="kpi-grid">
	<div class="kpi-card" style="border-color: var(--color-success)">
		<div class="kpi-label">Zapisy dziś</div>
		<div class="kpi-value" style="color: var(--color-success)">{kpi.today}</div>
		<div class="kpi-sub">{kpi.today > 0 ? 'zaznaczone na zielono na liście' : 'jeszcze nikt się dziś nie zapisał'}</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Ostatnie 7 dni</div>
		<div class="kpi-value">{kpi.d7}</div>
		<div class="kpi-sub">wszystkie źródła</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Ostatnie 30 dni</div>
		<div class="kpi-value">{kpi.d30}</div>
		<div class="kpi-sub">wszystkie źródła</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Łącznie w bazie</div>
		<div class="kpi-value">{kpi.total}</div>
		<div class="kpi-sub">{data.counts.clients} ankiet · {data.counts.contacts} kontaktów</div>
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
			<select class="form-select" bind:value={typeFilter} style="width: auto">
				<option value="all">Wszystkie typy</option>
				<option value="client">Pełne ankiety</option>
				<option value="contact">Kontakty (formularz)</option>
			</select>
		</div>
	</div>
	<div class="table-scroll">
		<table class="tbl">
			<thead>
				<tr>
					<th>Osoba</th>
					<th>Kontakt</th>
					<th>Typ zapisu</th>
					<th>Data zapisu</th>
				</tr>
			</thead>
			<tbody>
				{#each grouped as row (row.kind === 'header' ? 'h-' + row.dayKey : row.signup.type + '-' + row.signup.id)}
					{#if row.kind === 'header'}
						<tr class="date-sep" class:today-sep={row.today}>
							<td colspan="4">{row.label}</td>
						</tr>
					{:else}
						{@const s = row.signup}
						<tr class="row-click" class:row-today={row.today} onclick={() => (selected = s)}>
							<td>
								<strong>{s.name ?? '—'}</strong>
								{#if s.sub}<br /><span class="faint">{s.sub}</span>{/if}
							</td>
							<td>
								{s.email ?? '—'}
								{#if s.phone}<br /><span class="faint">{s.phone}</span>{/if}
							</td>
							<td>
								{#if s.type === 'client'}
									<span class="badge badge-success">Pełna ankieta</span>
								{:else}
									<span class="badge badge-primary">Kontakt</span>
								{/if}
							</td>
							<td style="white-space: nowrap">
								{fmtDateTime(s.created_at)}
								{#if row.today}<span class="badge badge-today" style="margin-left: 6px">DZIŚ</span>{/if}
							</td>
						</tr>
					{/if}
				{:else}
					<tr>
						<td colspan="4" class="muted" style="text-align: center; padding: var(--space-8)">
							Brak zapisów w wybranym zakresie.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<PersonModal signup={selected} onclose={() => (selected = null)} />
