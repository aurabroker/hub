<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { fmtDateTime } from '$lib/ud/format';
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
	let category = $derived(data.campaign.email_categories);
	let hasContent = $derived(
		Boolean(category?.resend_template_id) || Boolean(category?.html_body?.trim())
	);
	let shownTotal = $derived(
		data.statusFilter ? (data.counts[data.statusFilter] ?? 0) : total
	);
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
			· Nadawca: <strong>{data.sender.address ?? 'brak!'}</strong>
			<span class="faint">({data.sender.source})</span>
			{#if data.campaign.scheduled_at}
				· {data.campaign.status === 'draft' ? 'Termin (po kliknięciu „Zaplanuj”)' : 'Zaplanowana'}:
				{fmtDateTime(data.campaign.scheduled_at)}
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

{#if data.health.stalled && ['sending', 'scheduled'].includes(data.campaign.status)}
	<div class="alert alert-warning">
		<strong>Kolejka stoi.</strong>
		{#if data.health.queued > 0}
			Czeka {data.health.queued} wiadomości, ostatnia wysyłka:
			{data.health.lastActivityAt ? fmtDateTime(data.health.lastActivityAt) : 'brak'}.
		{/if}
		{#if data.health.overdueScheduled > 0}
			Zaplanowanym kampaniom minął termin, a nie wystartowały.
		{/if}
		Automatyczna wysyłka (Worker <span class="mono">aura-hub-queue-cron</span>) nie działa —
		do czasu naprawy wysyłka idzie tylko ręcznie
		{#if data.campaign.status === 'scheduled'}(„Uruchom wysyłkę”){:else}(„Przetwórz partię teraz”){/if}.
	</div>
{/if}

{#if data.deadUnsubscribeLink}
	<div class="alert alert-error">
		<strong>Wysyłka wstrzymana: szablon Resend ma martwy link wypisu.</strong> Używa zmiennej
		<span class="mono">{'{{{RESEND_UNSUBSCRIBE_URL}}}'}</span>, którą Resend wypełnia tylko w Broadcasts —
		w mailu z HUB link wychodzi pusty. Zamień ją w szablonie na
		<span class="mono">{'{{{link_wypisu}}}'}</span> (z wartością domyślną) i opublikuj szablon.
		Do tego czasu wiadomości tej kampanii czekają w kolejce — nic nie przepada.
	</div>
{/if}
{#if data.templateError}
	<div class="alert alert-error">
		<strong>Nie udało się odczytać szablonu Resend</strong> ({data.templateError}). Wysyłka czeka, aż
		odczyt się uda — HUB nie wyśle z zastępczego adresu RESEND_FROM.
	</div>
{/if}

{#if category && !hasContent}
	<div class="alert alert-warning">
		Sekcja tej kampanii nie ma ani szablonu Resend, ani treści z Edytora —
		<a href="/categories">uzupełnij konfigurację</a> przed startem.
	</div>
{:else if category?.html_body?.trim() && !data.campaign.subject && !category.subject}
	<div class="alert alert-warning">
		Sekcja ma treść z Edytora, ale nie ma tematu — każda wiadomość skończy się błędem.
		Ustaw temat kampanii albo sekcji przed startem.
	</div>
{/if}

{#if data.preview}
	<div class="card">
		<h3 style="margin-bottom: var(--space-3)">Podgląd odbiorców (szkic)</h3>
		<p style="font-size: var(--text-sm)">
			W segmencie: <strong>{data.preview.total}</strong> · do wysyłki:
			<strong style="color: var(--color-success)">{data.preview.queued}</strong> · brak zgody RODO:
			<strong style="color: var(--color-warning)">{data.preview.skippedNoConsent}</strong> · zły e-mail:
			<strong>{data.preview.skippedBadEmail}</strong> · ten sam adres na kilku kartach (wyślemy raz):
			<strong>{data.preview.skippedDuplicate}</strong> · zablokowane (odbicie / skarga):
			<strong>{data.preview.skippedBlocked}</strong> · wykluczeni trybem:
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
			<span>
				Postęp wysyłki: {done} / {sendable} ({progress}%)
				{#if (data.counts.queued ?? 0) > 0 && !data.health.stalled}
					· cała kolejka ({data.health.queued}) zejdzie w ok. {data.health.etaMinutes} min
				{/if}
			</span>
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
						<td class="muted">{m.sent_at ? fmtDateTime(m.sent_at) : '—'}</td>
						<td class="muted">{m.opened_at ? fmtDateTime(m.opened_at) : '—'}</td>
						<td class="muted">{m.clicked_at ? fmtDateTime(m.clicked_at) : '—'}</td>
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
	{#if shownTotal > data.messages.length}
		<p class="muted" style="font-size: var(--text-sm); padding: var(--space-3)">
			Pokazano pierwszych {data.messages.length} z {shownTotal}. Liczniki i postęp obejmują wszystkich.
		</p>
	{/if}
</div>
