<script lang="ts">
	import type { PageServerData } from './$types';
	import type { UdClient, Signup } from '$lib/ud/types';
	import { EMPLOYMENT_LABELS, fmtDate, dayKey, todayKey } from '$lib/ud/format';
	import PersonModal from '$lib/components/PersonModal.svelte';

	let { data }: { data: PageServerData } = $props();

	let search = $state('');
	let selectedClient = $state<UdClient | null>(null);

	const today = todayKey();

	let filtered = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return data.clients;
		return data.clients.filter((c) =>
			[c.full_name, c.email, c.phone, c.profession].some((v) =>
				String(v ?? '').toLowerCase().includes(q)
			)
		);
	});

	// Adapter Karta Klienta jako Signup dla modalu
	let selectedSignup = $derived<Signup | null>(
		selectedClient
			? {
					type: 'client',
					id: selectedClient.id,
					name: selectedClient.full_name,
					email: selectedClient.email,
					phone: selectedClient.phone,
					sub: selectedClient.profession,
					created_at: selectedClient.created_at
				}
			: null
	);
</script>

<svelte:head><title>Baza Klientów — Aura HUB</title></svelte:head>

<h1 class="page-title">Baza Klientów</h1>
<p class="page-subtitle">
	Wszystkie dane zapisanych Klientów z ankiety utratadochodu.com. Kliknij wiersz, aby otworzyć
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
			placeholder="Szukaj: imię, e-mail, telefon, zawód…"
			bind:value={search}
			style="width: 320px; max-width: 100%"
		/>
		<span class="muted">{filtered.length} z {data.clients.length} Klientów</span>
	</div>
	<div class="table-scroll">
		<table class="tbl">
			<thead>
				<tr>
					<th>Klient</th>
					<th>Kontakt</th>
					<th>Zawód / Forma</th>
					<th>Data zapisu</th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as c (c.id)}
					{@const isToday = dayKey(c.created_at) === today}
					<tr class="row-click" class:row-today={isToday} onclick={() => (selectedClient = c)}>
						<td>
							<strong>{c.full_name ?? '—'}</strong>
							{#if c.pesel}<br /><span class="faint">PESEL: {c.pesel}</span>{/if}
						</td>
						<td>
							{c.email ?? '—'}
							{#if c.phone}<br /><span class="faint">{c.phone}</span>{/if}
						</td>
						<td>
							{c.profession ?? '—'}
							{#if c.employment_type}<br /><span class="faint">{EMPLOYMENT_LABELS[c.employment_type] ?? c.employment_type}</span>{/if}
						</td>
						<td style="white-space: nowrap">
							{fmtDate(c.created_at)}
							{#if isToday}<span class="badge badge-today" style="margin-left: 6px">DZIŚ</span>{/if}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="4" class="muted" style="text-align: center; padding: var(--space-8)">
							Brak Klientów spełniających kryteria.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<PersonModal signup={selectedSignup} full={selectedClient} onclose={() => (selectedClient = null)} />
