<script lang="ts">
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	const statusBadge: Record<string, string> = {
		queued: 'badge-warning',
		sending: 'badge-primary',
		sent: 'badge-success',
		failed: 'badge-error',
		bounced: 'badge-error',
		skipped: 'badge-muted'
	};

	function fmt(iso: string | null): string {
		return iso ? new Date(iso).toLocaleString('pl-PL') : '—';
	}

	let total = $derived(Object.values(data.counts).reduce((a, b) => a + b, 0));
</script>

<svelte:head><title>Historia wysyłek — Aura HUB</title></svelte:head>

<h1 class="page-title">Historia wysyłek</h1>
<p class="page-subtitle">
	Log wszystkich maili ({total} łącznie): szybka wysyłka i kampanie. Otwarcia/kliknięcia
	uzupełniają się po zdarzeniach z webhooka Resend.
</p>

<form class="card" method="GET" style="display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: flex-end">
	<div class="form-field" style="margin: 0; min-width: 200px">
		<label class="form-label" for="q">Adres zawiera</label>
		<input class="form-input" id="q" name="q" value={data.filters.q} placeholder="np. @firma.pl" />
	</div>
	<div class="form-field" style="margin: 0">
		<label class="form-label" for="status">Status</label>
		<select class="form-select" id="status" name="status">
			<option value="">wszystkie</option>
			{#each Object.keys(statusBadge) as s (s)}
				<option value={s} selected={data.filters.status === s}>{s} ({data.counts[s] ?? 0})</option>
			{/each}
		</select>
	</div>
	<div class="form-field" style="margin: 0">
		<label class="form-label" for="source">Źródło</label>
		<select class="form-select" id="source" name="source">
			<option value="">wszystkie</option>
			<option value="quick_send" selected={data.filters.source === 'quick_send'}>szybka wysyłka</option>
			<option value="campaign" selected={data.filters.source === 'campaign'}>kampania</option>
		</select>
	</div>
	<div class="form-field" style="margin: 0">
		<label class="form-label" for="category">Sekcja</label>
		<select class="form-select" id="category" name="category">
			<option value="">wszystkie</option>
			{#each data.categories as c (c.id)}
				<option value={c.id} selected={data.filters.category === c.id}>{c.name}</option>
			{/each}
		</select>
	</div>
	<button class="btn btn-primary" type="submit">Filtruj</button>
	<a class="btn btn-ghost" href="/messages">Wyczyść</a>
</form>

<div class="table-wrap">
	<div class="table-toolbar">
		<h3>Wiadomości (najnowsze 200 dla filtra)</h3>
	</div>
	<div class="table-scroll">
		<table class="tbl">
			<thead>
				<tr>
					<th>Data</th>
					<th>Odbiorca</th>
					<th>Sekcja</th>
					<th>Źródło</th>
					<th>Status</th>
					<th>Wysłano</th>
					<th>Otwarto</th>
					<th>Kliknięto</th>
					<th>Błąd / Resend ID</th>
				</tr>
			</thead>
			<tbody>
				{#each data.messages as m (m.id)}
					<tr>
						<td class="muted" style="white-space: nowrap">{fmt(m.created_at)}</td>
						<td>
							{m.to_email}
							{#if m.company_id}<span class="faint mono">#{m.company_id}</span>{/if}
						</td>
						<td>{m.email_categories?.name ?? '—'}</td>
						<td>
							{#if m.source === 'quick_send'}
								<span class="badge badge-primary">1-do-1</span>
							{:else if m.email_campaigns}
								<a href="/campaigns/{m.email_campaigns.id}">{m.email_campaigns.name}</a>
							{:else}
								kampania
							{/if}
						</td>
						<td><span class="badge {statusBadge[m.status] ?? 'badge-muted'}">{m.status}</span></td>
						<td class="muted" style="white-space: nowrap">{fmt(m.sent_at)}</td>
						<td class="muted" style="white-space: nowrap">{fmt(m.opened_at)}</td>
						<td class="muted" style="white-space: nowrap">{fmt(m.clicked_at)}</td>
						<td style="max-width: 260px">
							{#if m.error}
								<span style="color: var(--color-error)">{m.error}</span>
							{:else if m.resend_id}
								<span class="mono faint">{m.resend_id}</span>
							{/if}
						</td>
					</tr>
				{:else}
					<tr><td colspan="9" class="muted">Brak wiadomości dla wybranego filtra.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
