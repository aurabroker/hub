<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const statusLabel: Record<string, string> = {
		draft: 'Szkic',
		scheduled: 'Zaplanowana',
		sending: 'W trakcie wysyłki',
		sent: 'Wysłana',
		failed: 'Błąd',
		canceled: 'Anulowana'
	};
	const messageStatuses = ['queued', 'sending', 'sent', 'failed', 'bounced', 'skipped'];
	const messageBadge: Record<string, string> = {
		queued: 'badge-warning',
		sending: 'badge-primary',
		sent: 'badge-success',
		failed: 'badge-error',
		bounced: 'badge-error',
		skipped: 'badge-muted'
	};

	let total = $derived(Object.values(data.counts).reduce((a, b) => a + b, 0));
	let done = $derived((data.counts.sent ?? 0) + (data.counts.failed ?? 0) + (data.counts.bounced ?? 0));
	let sendable = $derived(total - (data.counts.skipped ?? 0));
	let progress = $derived(sendable > 0 ? Math.round((done / sendable) * 100) : 0);
	let busy = $state(false);

	const enhanceBusy = () => {
		busy = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			busy = false;
			await update();
		};
	};
</script>

<svelte:head><title>{data.campaign.name} — Aura HUB</title></svelte:head>

<div style="display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-4)">
	<div>
		<h1 class="page-title">{data.campaign.name}</h1>
		<p class="page-subtitle">
			Sekcja: <strong>{data.campaign.email_categories?.name ?? '—'}</strong>
			· Status: <strong>{statusLabel[data.campaign.status] ?? data.campaign.status}</strong>
			{#if data.campaign.scheduled_at}
				· Zaplanowana: {new Date(data.campaign.scheduled_at).toLocaleString('pl-PL')}
			{/if}
		</p>
	</div>
	<a class="btn btn-ghost" href="/campaigns">← Wróć do listy</a>
</div>

{#if form?.error}
	<div class="alert alert-error">{form.error}</div>
{/if}
{#if form?.success}
	<div class="alert alert-success">{form.success}</div>
{/if}

{#if data.campaign.email_categories && !data.campaign.email_categories.resend_template_id}
	<div class="alert alert-warning">
		Kategoria tej kampanii nie ma ustawionego szablonu Resend —
		<a href="/categories">uzupełnij konfigurację</a> przed startem.
	</div>
{/if}

{#if data.preview}
	<div class="card">
		<h3 style="margin-bottom: var(--space-3)">Podgląd odbiorców (szkic)</h3>
		<p style="font-size: var(--text-sm)">
			W segmencie: <strong>{data.preview.total}</strong> · do wysyłki:
			<strong style="color: var(--color-success)">{data.preview.queued}</strong> · brak zgody RODO:
			<strong style="color: var(--color-warning)">{data.preview.skippedNoConsent}</strong> · zły e-mail:
			<strong>{data.preview.skippedBadEmail}</strong> · wykluczeni trybem:
			<strong>{data.preview.excludedByMode}</strong>
		</p>
		{#if data.preview.queued === 0 && data.preview.skippedNoConsent > 0}
			<div class="alert alert-warning" style="margin: var(--space-3) 0 0">
				Wszyscy odbiorcy odpadają na bramce RODO — uzupełnij zgody w CRM przed startem.
			</div>
		{/if}
	</div>
{/if}

<div class="card">
	<div style="display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: center">
		{#if ['draft', 'scheduled', 'canceled'].includes(data.campaign.status)}
			<form method="POST" action="?/start" use:enhance={enhanceBusy}>
				<button class="btn btn-primary" type="submit" disabled={busy}>
					{data.campaign.scheduled_at && new Date(data.campaign.scheduled_at) > new Date()
						? 'Zaplanuj wysyłkę'
						: 'Uruchom wysyłkę'}
				</button>
			</form>
		{/if}
		{#if data.campaign.status === 'sending'}
			<form method="POST" action="?/process" use:enhance={enhanceBusy}>
				<button class="btn btn-primary" type="submit" disabled={busy}>
					{busy ? 'Przetwarzanie…' : 'Przetwórz partię teraz (20)'}
				</button>
			</form>
		{/if}
		{#if (data.counts.failed ?? 0) > 0}
			<form method="POST" action="?/retry" use:enhance={enhanceBusy}>
				<button class="btn btn-ghost" type="submit" disabled={busy}>
					Ponów nieudane ({data.counts.failed})
				</button>
			</form>
		{/if}
		{#if ['scheduled', 'sending'].includes(data.campaign.status)}
			<form method="POST" action="?/cancel" use:enhance={enhanceBusy}>
				<button class="btn btn-danger" type="submit" disabled={busy}>Anuluj kampanię</button>
			</form>
		{/if}
	</div>
</div>

{#if total > 0}
	<div class="card">
		<div style="display: flex; justify-content: space-between; margin-bottom: var(--space-2); font-size: var(--text-sm)">
			<span>Postęp wysyłki: {done} / {sendable} ({progress}%)</span>
			<span class="muted">
				w kolejce {data.counts.queued ?? 0} · wysłane {data.counts.sent ?? 0} · błędy
				{(data.counts.failed ?? 0) + (data.counts.bounced ?? 0)} · pominięte {data.counts.skipped ?? 0}
			</span>
		</div>
		<div class="progress-track">
			<div class="progress-fill" style="width: {progress}%"></div>
		</div>
	</div>
{/if}

<div class="table-wrap">
	<div class="table-toolbar">
		<h3>Odbiorcy</h3>
		<div style="display: flex; gap: var(--space-2); flex-wrap: wrap">
			<a class="btn btn-ghost" class:btn-primary={!data.statusFilter} href={page.url.pathname}>
				Wszyscy
			</a>
			{#each messageStatuses as status (status)}
				{#if (data.counts[status] ?? 0) > 0}
					<a
						class="btn btn-ghost"
						class:btn-primary={data.statusFilter === status}
						href="{page.url.pathname}?status={status}"
					>
						{status} ({data.counts[status]})
					</a>
				{/if}
			{/each}
		</div>
	</div>
	<div class="table-scroll">
		<table class="tbl">
			<thead>
				<tr>
					<th>Odbiorca</th>
					<th>Status</th>
					<th>Błąd / informacja</th>
					<th class="num">Próby</th>
					<th>Wysłano</th>
					<th>Otwarto</th>
					<th>Kliknięto</th>
				</tr>
			</thead>
			<tbody>
				{#each data.messages as m (m.id)}
					<tr>
						<td>
							{m.to_email}
							{#if m.company_id}
								<span class="faint mono">#{m.company_id}</span>
							{/if}
						</td>
						<td><span class="badge {messageBadge[m.status] ?? 'badge-muted'}">{m.status}</span></td>
						<td class="muted" style="max-width: 280px">{m.error ?? ''}</td>
						<td class="num">{m.attempts}</td>
						<td class="muted">{m.sent_at ? new Date(m.sent_at).toLocaleString('pl-PL') : '—'}</td>
						<td class="muted">{m.opened_at ? new Date(m.opened_at).toLocaleString('pl-PL') : '—'}</td>
						<td class="muted">{m.clicked_at ? new Date(m.clicked_at).toLocaleString('pl-PL') : '—'}</td>
					</tr>
				{:else}
					<tr>
						<td colspan="7" class="muted">
							Brak odbiorców — uruchom kampanię, aby zmaterializować kolejkę.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
