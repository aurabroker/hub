<script lang="ts">
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
						<td class="muted">{new Date(campaign.created_at).toLocaleDateString('pl-PL')}</td>
					</tr>
				{:else}
					<tr><td colspan="8" class="muted">Brak kampanii — utwórz pierwszą.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
