<script lang="ts">
	import type { PageServerData } from './$types';
	import type { CrmCompany } from '$lib/ud/types';
	import { dayKey, todayKey, fmtDateTime, dayLabel } from '$lib/ud/format';
	import PersonModal from '$lib/components/PersonModal.svelte';

	let { data }: { data: PageServerData } = $props();

	let rangeFilter = $state<'all' | 'today' | '7' | '30'>('all');
	let selected = $state<CrmCompany | null>(null);

	const today = todayKey();
	const now = Date.now();

	function isToday(iso: string): boolean {
		return dayKey(iso) === today;
	}

	let signups = $derived(data.signups.filter((s) => !!s.created_at));

	let filtered = $derived.by(() => {
		let list = signups;
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
		| { kind: 'row'; company: CrmCompany; today: boolean };

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
			rows.push({ kind: 'row', company: c, today: isTodayRow });
		}
		return rows;
	});
</script>

<svelte:head><title>Zapisy dzienne — Aura HUB</title></svelte:head>

<h1 class="page-title">Zapisy dzienne</h1>
<p class="page-subtitle">
	Codzienne zapisy do bazy kontaktów (<span class="mono">crm_companies</span>). Zapisy z dnia
	dzisiejszego zaznaczone <strong style="color: var(--color-success)">na zielono</strong>. Kliknij
	wiersz, aby zobaczyć wszystkie dane.
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
		<div class="kpi-sub">wszystkie kontakty</div>
	</div>
</div>

<div class="table-wrap">
	<div class="table-toolbar">
		<h3>Zapisy wg dni</h3>
		<select class="form-select" bind:value={rangeFilter} style="width: auto">
			<option value="all">Cały okres</option>
			<option value="today">Tylko dziś</option>
			<option value="7">Ostatnie 7 dni</option>
			<option value="30">Ostatnie 30 dni</option>
		</select>
	</div>
	<div class="table-scroll">
		<table class="tbl">
			<thead>
				<tr>
					<th>Firma / Osoba</th>
					<th>Kontakt</th>
					<th>Miasto / Branża</th>
					<th>Data zapisu</th>
				</tr>
			</thead>
			<tbody>
				{#each grouped as row (row.kind === 'header' ? 'h-' + row.dayKey : 'r-' + row.company.id)}
					{#if row.kind === 'header'}
						<tr class="date-sep" class:today-sep={row.today}>
							<td colspan="4">{row.label}</td>
						</tr>
					{:else}
						{@const c = row.company}
						<tr class="row-click" class:row-today={row.today} onclick={() => (selected = c)}>
							<td>
								<strong>{c.company ?? c.contact ?? '—'}</strong>
								{#if c.company && c.contact}<br /><span class="faint">{c.contact}</span>{/if}
								{#if c.nip}<br /><span class="faint">NIP: {c.nip}</span>{/if}
							</td>
							<td>
								{c.email ?? '—'}
								{#if c.phone}<br /><span class="faint">{c.phone}</span>{/if}
							</td>
							<td>
								{c.city ?? '—'}
								{#if c.industry}<br /><span class="faint">{c.industry}</span>{/if}
							</td>
							<td style="white-space: nowrap">
								{fmtDateTime(c.created_at)}
								{#if row.today}<span class="badge badge-today" style="margin-left: 6px">DZIŚ</span>{/if}
							</td>
						</tr>
					{/if}
				{:else}
					<tr>
						<td colspan="4" class="muted" style="text-align: center; padding: var(--space-8)">
							{signups.length === 0
								? 'Baza crm_companies jest jeszcze pusta — pierwszy zapis pojawi się tu automatycznie.'
								: 'Brak zapisów w wybranym zakresie.'}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<PersonModal company={selected} onclose={() => (selected = null)} />
