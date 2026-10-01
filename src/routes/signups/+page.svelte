<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageServerData } from './$types';
	import type { CrmCompany } from '$lib/ud/types';
	import { dayKey, todayKey, fmtDateTime, dayLabel } from '$lib/ud/format';
	import { normalizeInterest, CODE_LABELS, CODE_COLORS } from '$lib/categories';
	import Sparkline from '$lib/components/Sparkline.svelte';

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

	/**
	 * Zapisy dzień po dniu za ostatnie 30 dni, z zerami dla dni bez zapisu.
	 * Dziura w osi czasu kłamałaby o kształcie — dwa zapisy w odstępie tygodnia
	 * wyglądałyby na dwa dni z rzędu.
	 */
	let dziennie = $derived.by(() => {
		const licznik = new Map<string, number>();
		for (const s of signups) licznik.set(dayKey(s.created_at), (licznik.get(dayKey(s.created_at)) ?? 0) + 1);
		return Array.from({ length: 30 }, (_, i) => {
			const d = new Date(now - (29 - i) * 864e5);
			return licznik.get(dayKey(d)) ?? 0;
		});
	});

	/** Stan bazy dzień po dniu, liczony wstecz od dzisiejszej sumy. */
	let narastajaco = $derived.by(() => {
		const out: number[] = [];
		let stan = signups.length;
		for (let i = dziennie.length - 1; i >= 0; i--) {
			out.unshift(stan);
			stan -= dziennie[i];
		}
		return out;
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
	Codzienne zapisy do bazy kontaktów. <strong style="color: var(--color-success)">Na zielono</strong>
	świecą zapytania o konsultację — te czekają na telefon. Kliknij wiersz, aby otworzyć kartę Klienta.
</p>

{#if data.error}
	<div class="alert alert-error" style="margin-bottom: var(--space-4)">
		Nie udało się pobrać danych: {data.error}
	</div>
{/if}

<div class="kpi-grid">
	<div class="kpi-card">
		<div class="kpi-label">Zapisy dziś</div>
		<div class="kpi-value" style:color={kpi.today > 0 ? 'var(--color-success)' : undefined}>
			{kpi.today}
		</div>
		<div class="kpi-spark">
			<Sparkline data={dziennie} color="var(--data-2)" label="Zapisy dzień po dniu" />
		</div>
		<div class="kpi-sub">
			{kpi.today > 0 ? 'ostatnie 30 dni na wykresie' : 'jeszcze nikt się dziś nie zapisał'}
		</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Ostatnie 7 dni</div>
		<div class="kpi-value">{kpi.d7}</div>
		<div class="kpi-spark">
			<Sparkline data={dziennie.slice(-7)} color="var(--data-1)" label="Zapisy w ostatnim tygodniu" />
		</div>
		<div class="kpi-sub">nowe zapisy</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Ostatnie 30 dni</div>
		<div class="kpi-value">{kpi.d30}</div>
		<div class="kpi-spark">
			<Sparkline data={dziennie} color="var(--data-3)" label="Zapisy w ostatnim miesiącu" />
		</div>
		<div class="kpi-sub">nowe zapisy</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Łącznie w bazie</div>
		<div class="kpi-value">{kpi.total.toLocaleString('pl-PL')}</div>
		<div class="kpi-spark">
			<Sparkline data={narastajaco} color="var(--data-4)" label="Wielkość bazy przez 30 dni" />
		</div>
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
