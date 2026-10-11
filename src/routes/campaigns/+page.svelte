<script lang="ts">
	import { fmtDate, fmtDateTime } from '$lib/ud/format';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	const statusBadge: Record<string, string> = {
		draft: 'badge-muted',
		scheduled: 'badge-warning',
		sending: 'badge-primary',
		sent: 'badge-success',
		failed: 'badge-error',
		canceled: 'badge-muted'
	};
	const statusLabel: Record<string, string> = {
		draft: 'Szkic',
		scheduled: 'Zaplanowana',
		sending: 'W trakcie',
		sent: 'Wysłana',
		failed: 'Błąd',
		canceled: 'Anulowana'
	};
</script>

<svelte:head><title>Kampanie — Aura HUB</title></svelte:head>

<div style="display: flex; justify-content: space-between; align-items: flex-start">
	<div>
		<h1 class="page-title">Kampanie</h1>
		<p class="page-subtitle">Wysyłki masowe do segmentów bazy CRM.</p>
	</div>
	<a class="btn btn-primary" href="/campaigns/new">+ Nowa kampania</a>
</div>

{#if data.health.stalled}
	<div class="alert alert-warning">
		<strong>Kolejka stoi.</strong>
		{#if data.health.queued > 0}
			Czeka {data.health.queued} wiadomości, ostatnia wysyłka:
			{data.health.lastActivityAt ? fmtDateTime(data.health.lastActivityAt) : 'brak'}.
		{/if}
		{#if data.health.overdueScheduled > 0}
			Zaplanowanym kampaniom ({data.health.overdueScheduled}) minął termin, a nie wystartowały.
		{/if}
		Automatyczna wysyłka (Worker <span class="mono">aura-hub-queue-cron</span>) nie działa — kampanie,
		automat i wysyłki „do wszystkich” idą tylko po ręcznym „Przetwórz partię”.
	</div>
{/if}

<div class="table-wrap">
	<div class="table-scroll">
		<table class="tbl">
			<thead>
				<tr>
					<th>Nazwa</th>
					<th>Sekcja</th>
					<th>Status</th>
					<th class="num">W kolejce</th>
					<th class="num">Wysłane</th>
					<th class="num">Błędy</th>
					<th class="num">Pominięte</th>
					<th>Utworzona</th>
				</tr>
			</thead>
			<tbody>
				{#each data.campaigns as campaign (campaign.id)}
					<tr>
						<td><a href="/campaigns/{campaign.id}"><strong>{campaign.name}</strong></a></td>
						<td>{campaign.email_categories?.name ?? '—'}</td>
						<td>
							<span class="badge {statusBadge[campaign.status] ?? 'badge-muted'}">
								{statusLabel[campaign.status] ?? campaign.status}
							</span>
						</td>
						<td class="num">{campaign.counts.queued ?? 0}</td>
						<td class="num">{campaign.counts.sent ?? 0}</td>
						<td class="num">{(campaign.counts.failed ?? 0) + (campaign.counts.bounced ?? 0)}</td>
						<td class="num">{campaign.counts.skipped ?? 0}</td>
						<td class="muted">{fmtDate(campaign.created_at)}</td>
					</tr>
				{:else}
					<tr><td colspan="8" class="muted">Brak kampanii — utwórz pierwszą.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
