<script lang="ts">
	import type { PageServerData } from './$types';
	import type { CrmCompany } from '$lib/ud/types';
	import { fmtDate, dayKey, todayKey } from '$lib/ud/format';
	import PersonModal from '$lib/components/PersonModal.svelte';

	let { data }: { data: PageServerData } = $props();

	let search = $state('');
	let selected = $state<CrmCompany | null>(null);

	const today = todayKey();

	let filtered = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return data.clients;
		return data.clients.filter((c) =>
			[c.company, c.contact, c.email, c.phone, c.nip, c.city, c.industry].some((v) =>
				String(v ?? '').toLowerCase().includes(q)
			)
		);
	});
</script>

<svelte:head><title>Baza Klientów — Aura HUB</title></svelte:head>

<h1 class="page-title">Baza Klientów</h1>
<p class="page-subtitle">
	Wszystkie kontakty z tabeli <span class="mono">crm_companies</span>. Kliknij wiersz, aby otworzyć
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
			placeholder="Szukaj: firma, osoba, e-mail, telefon, NIP, miasto, branża…"
			bind:value={search}
			style="width: 360px; max-width: 100%"
		/>
		<span class="muted">{filtered.length} z {data.clients.length} Klientów</span>
	</div>
	<div class="table-scroll">
		<table class="tbl">
			<thead>
				<tr>
					<th>Firma / Osoba</th>
					<th>Kontakt</th>
					<th>Miasto / Branża</th>
					<th>NIP</th>
					<th>Status</th>
					<th>Data zapisu</th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as c (c.id)}
					{@const isToday = c.created_at ? dayKey(c.created_at) === today : false}
					<tr class="row-click" class:row-today={isToday} onclick={() => (selected = c)}>
						<td>
							<strong>{c.company ?? c.contact ?? '—'}</strong>
							{#if c.company && c.contact}<br /><span class="faint">{c.contact}{c.title ? ' · ' + c.title : ''}</span>{/if}
						</td>
						<td>
							{c.email ?? '—'}
							{#if c.phone}<br /><span class="faint">{c.phone}</span>{/if}
						</td>
						<td>
							{c.city ?? '—'}
							{#if c.industry}<br /><span class="faint">{c.industry}</span>{/if}
						</td>
						<td>{c.nip ?? '—'}</td>
						<td>
							{#if c.status}<span class="badge badge-primary">{c.status}</span>{:else}—{/if}
						</td>
						<td style="white-space: nowrap">
							{c.created_at ? fmtDate(c.created_at) : '—'}
							{#if isToday}<span class="badge badge-today" style="margin-left: 6px">DZIŚ</span>{/if}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="6" class="muted" style="text-align: center; padding: var(--space-8)">
							{data.clients.length === 0
								? 'Baza crm_companies jest jeszcze pusta.'
								: 'Brak Klientów spełniających kryteria.'}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<PersonModal company={selected} onclose={() => (selected = null)} />
