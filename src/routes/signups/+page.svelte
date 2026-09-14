<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageServerData } from './$types';
	import type { CrmCompany } from '$lib/ud/types';
	import { dayKey, todayKey, fmtDateTime, dayLabel } from '$lib/ud/format';
	import { normalizeInterest, CODE_LABELS, CODE_COLORS } from '$lib/categories';

	let { data }: { data: PageServerData } = $props();

	let rangeFilter = $state<'all' | 'today' | '7' | '30'>('all');

	const today = todayKey();
	const now = Date.now();

	function isToday(iso: string): boolean {
		return dayKey(iso) === today;
	}

	/**
	 * Zapytanie o konsultację — zapis, który prosi wprost o rozmowę, więc
	 * wyróżniamy go zielenią. Ta sama zasada co w Bazie Klientów: zieleń
	 * w tabeli znaczy „oddzwoń", nigdy „wpadło dzisiaj".
	 */
	function doKontaktu(ubezpieczenie: string | null): boolean {
		return normalizeInterest(ubezpieczenie) === 'konsultacja';
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
	wiersz, aby otworzyć pełną kartę Klienta.
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
					<th>Zapytanie</th>
					<th>Miasto / Branża</th>
					<th>Data zapisu</th>
				</tr>
			</thead>
			<tbody>
				{#each grouped as row (row.kind === 'header' ? 'h-' + row.dayKey : 'r-' + row.company.id)}
					{#if row.kind === 'header'}
						<tr class="date-sep" class:today-sep={row.today}>
							<td colspan="5">{row.label}</td>
						</tr>
					{:else}
						{@const c = row.company}
						{@const kod = normalizeInterest(c.ubezpieczenie)}
						{@const hot = doKontaktu(c.ubezpieczenie)}
						<tr
							class="row-click"
							class:row-hot={hot}
							class:row-today={row.today && !hot}
							onclick={() => goto(`/clients/${c.id}`)}
						>
							<td>
								<span class="cell-main">{c.company ?? c.contact ?? '—'}</span>
								{#if c.company && c.contact}<span class="cell-sub">{c.contact}</span>{/if}
								{#if c.nip}<span class="cell-sub mono">NIP {c.nip}</span>{/if}
							</td>
							<td>
								{c.email ?? '—'}
								{#if c.phone}<span class="cell-sub">{c.phone}</span>{/if}
							</td>
							<td>
								<span class="chip" style="--chip: {CODE_COLORS[kod]}">{CODE_LABELS[kod]}</span>
								{#if hot}
									<span class="cell-sub" style="color: var(--color-success); font-weight: 600">
										oddzwoń
									</span>
								{/if}
							</td>
							<td>
								{c.city ?? '—'}
								{#if c.industry}<span class="cell-sub">{c.industry}</span>{/if}
							</td>
							<td style="white-space: nowrap">
								{fmtDateTime(c.created_at)}
								{#if row.today}<span class="badge badge-today" style="margin-left: 6px">dziś</span>{/if}
							</td>
						</tr>
					{/if}
				{:else}
					<tr>
						<td colspan="5" class="muted" style="text-align: center; padding: var(--space-8)">
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
