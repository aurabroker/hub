<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	let sendingId = $state<string | null>(null);
</script>

<svelte:head><title>Wysyłka wg kategorii — Aura HUB</title></svelte:head>

<h1 class="page-title">Wysyłka wg kategorii</h1>
<p class="page-subtitle">
	Podgląd kategorii zapytań i wysyłka „do wszystkich" w danej kategorii. Wysyłka jest kolejkowana i
	realizowana automatycznie z limitem <strong>{data.status.limit} maili dziennie</strong> (darmowy
	plan Resend). <strong>Pierwszeństwo mają kampanie</strong> — wysyłka wg kategorii korzysta z tego,
	co zostaje w dziennym limicie.
</p>

{#if data.error}
	<div class="alert alert-error" style="margin-bottom: var(--space-4)">{data.error}</div>
{/if}

{#if form?.error}
	<div class="alert alert-error" style="margin-bottom: var(--space-4)">{form.error}</div>
{/if}

{#if form?.blast}
	<div class="alert alert-success" style="margin-bottom: var(--space-4)">
		Kategoria <strong>{form.blast.name}</strong>: zakolejkowano
		<strong>{form.blast.enqueued}</strong> z {form.blast.matched} kontaktów.
		{#if form.blast.skippedNoConsent > 0}· pominięto {form.blast.skippedNoConsent} bez zgody RODO{/if}
		{#if form.blast.skippedBadEmail > 0}· {form.blast.skippedBadEmail} z błędnym e-mailem{/if}
		{#if form.blast.skippedDuplicate > 0}· {form.blast.skippedDuplicate} już obsłużonych{/if}
	</div>
{/if}

<div class="kpi-grid" style="margin-bottom: var(--space-5)">
	<div class="kpi-card">
		<div class="kpi-label">Dzienny limit</div>
		<div class="kpi-value">{data.status.limit}</div>
		<div class="kpi-sub">maili / dzień (Resend)</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Wysłano dziś</div>
		<div class="kpi-value">{data.status.sentToday}</div>
		<div class="kpi-sub">kampanie + kategorie</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">W kolejce kampanii</div>
		<div class="kpi-value">{data.status.queuedCampaign}</div>
		<div class="kpi-sub">mają pierwszeństwo</div>
	</div>
	<div class="kpi-card" style="border-color: var(--color-success)">
		<div class="kpi-label">Dostępne dla kategorii dziś</div>
		<div class="kpi-value" style="color: var(--color-success)">{data.status.availableForCategories}</div>
		<div class="kpi-sub">po rezerwacji dla kampanii</div>
	</div>
</div>

<div class="table-wrap">
	<div class="table-scroll">
		<table class="tbl">
			<thead>
				<tr>
					<th>Kategoria</th>
					<th>Kontakty</th>
					<th>Kwalifikują się (RODO + e-mail)</th>
					<th>W kolejce</th>
					<th>Szablon Resend</th>
					<th>Akcja</th>
				</tr>
			</thead>
			<tbody>
				{#each data.categories as c (c.id)}
					<tr>
						<td>
							<strong>{c.name}</strong>
							<br /><span class="mono faint">{c.code}</span>
						</td>
						<td>{c.total}</td>
						<td>
							{#if c.eligible > 0}
								<span class="badge badge-success">{c.eligible}</span>
							{:else}
								<span class="muted">0</span>
							{/if}
						</td>
						<td>{c.pending > 0 ? c.pending : '—'}</td>
						<td>
							{#if c.hasTemplate}
								<span class="badge badge-success">jest</span>
							{:else}
								<span class="badge badge-warning">brak</span>
							{/if}
						</td>
						<td>
							<form
								method="POST"
								action="?/blast"
								use:enhance={({ cancel }) => {
									if (!confirm(`Zakolejkować wysyłkę do wszystkich (${c.eligible}) z kategorii „${c.name}"?`)) {
										cancel();
										return;
									}
									sendingId = c.id;
									return async ({ update }) => {
										sendingId = null;
										await update();
									};
								}}
							>
								<input type="hidden" name="categoryId" value={c.id} />
								<button
									class="btn btn-primary"
									type="submit"
									disabled={sendingId === c.id || c.eligible === 0 || !c.hasTemplate}
									title={!c.hasTemplate
										? 'Najpierw ustaw szablon Resend w zakładce Kategorie'
										: c.eligible === 0
											? 'Brak kontaktów ze zgodą RODO i poprawnym e-mailem'
											: 'Zakolejkuj wysyłkę do wszystkich w tej kategorii'}
								>
									{sendingId === c.id ? 'Kolejkowanie…' : 'Wyślij do wszystkich'}
								</button>
							</form>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="6" class="muted" style="text-align: center; padding: var(--space-8)">
							Brak aktywnych kategorii. Dodaj je w zakładce Kategorie.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
