<script lang="ts">
	import type { PageServerData } from './$types';
	import type { CrmClient } from '$lib/ud/types';
	import { fmtDate, dayKey, todayKey } from '$lib/ud/format';
	import PersonModal from '$lib/components/PersonModal.svelte';

	let { data }: { data: PageServerData } = $props();

	let search = $state('');
	let selected = $state<CrmClient | null>(null);

	const today = todayKey();

	let filtered = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return data.clients;
		return data.clients.filter((c) =>
			[c.nazwa, c.nazwa_skrocona, c.email, c.telefon, c.nip, c.regon, c.pesel, c.ulica].some(
				(v) => String(v ?? '').toLowerCase().includes(q)
			)
		);
	});
</script>

<svelte:head><title>Baza Klientów — Aura HUB</title></svelte:head>

<h1 class="page-title">Baza Klientów</h1>
<p class="page-subtitle">
	Wszyscy Klienci z bazy CRM (<span class="mono">crm_clients</span>). Kliknij wiersz, aby otworzyć
	kompletną kartę Klienta.
</p>

{#if data.error}
	<div class="alert alert-error" style="margin-bottom: var(--space-4)">
		Nie udało się pobrać danych: {data.error}
	</div>
{/if}

<div class="table-wrap">
	<div class="table-toolbar">
		<input
			class="form-input"
			type="search"
			placeholder="Szukaj: nazwa, e-mail, telefon, NIP, REGON, PESEL, adres…"
			bind:value={search}
			style="width: 360px; max-width: 100%"
		/>
		<span class="muted">{filtered.length} z {data.clients.length} Klientów</span>
	</div>
	<div class="table-scroll">
		<table class="tbl">
			<thead>
				<tr>
					<th>Klient</th>
					<th>Kontakt</th>
					<th>NIP / PESEL</th>
					<th>Adres</th>
					<th>Typ</th>
					<th>Data zapisu</th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as c (c.id)}
					{@const isToday = c.created_at ? dayKey(c.created_at) === today : false}
					<tr class="row-click" class:row-today={isToday} onclick={() => (selected = c)}>
						<td>
							<strong>{c.nazwa ?? c.nazwa_skrocona ?? '—'}</strong>
							{#if c.nazwa_skrocona && c.nazwa && c.nazwa_skrocona !== c.nazwa}
								<br /><span class="faint">{c.nazwa_skrocona}</span>
							{/if}
						</td>
						<td>
							{c.email ?? '—'}
							{#if c.telefon}<br /><span class="faint">{c.telefon}</span>{/if}
						</td>
						<td>
							{c.nip ?? c.pesel ?? '—'}
							{#if c.regon}<br /><span class="faint">REGON: {c.regon}</span>{/if}
						</td>
						<td>{c.ulica ?? '—'}</td>
						<td>
							{#if c.typ}<span class="badge badge-primary">{c.typ}</span>{:else}—{/if}
							{#if c.gwarancje}<br /><span class="badge badge-success" style="margin-top: 4px">gwarancje</span>{/if}
						</td>
						<td style="white-space: nowrap">
							{c.created_at ? fmtDate(c.created_at) : '—'}
							{#if isToday}<span class="badge badge-today" style="margin-left: 6px">DZIŚ</span>{/if}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="6" class="muted" style="text-align: center; padding: var(--space-8)">
							Brak Klientów spełniających kryteria.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<PersonModal client={selected} onclose={() => (selected = null)} />
