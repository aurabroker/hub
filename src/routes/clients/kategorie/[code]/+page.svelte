<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import type { ActionData, PageServerData } from './$types';
	import { fmtDate } from '$lib/ud/format';
	import { hasRodoConsent } from '$lib/categories';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	let search = $state('');
	let sending = $state(false);

	let filtered = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return data.companies;
		return data.companies.filter((c) =>
			[c.company, c.contact, c.email, c.phone, c.nip].some((v) =>
				String(v ?? '').toLowerCase().includes(q)
			)
		);
	});

	const canSend = $derived(Boolean(data.category?.hasTemplate) && data.eligible > 0);
</script>

<svelte:head><title>{data.label} — firmy — Aura HUB</title></svelte:head>

<a href="/clients/kategorie" class="faint" style="text-decoration: none">← Wysyłka wg kategorii</a>

<div style="display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; margin-top: var(--space-2)">
	<div>
		<h1 class="page-title">Kategoria: {data.label}</h1>
		<p class="page-subtitle" style="margin-bottom: 0">
			Firmy, które zwróciły się o: <strong>{data.label}</strong>.
			Łącznie <strong>{data.companies.length}</strong>, kwalifikuje się do wysyłki
			(RODO + e-mail) <strong>{data.eligible}</strong>.
		</p>
	</div>
	<div>
		{#if data.category}
			<form
				method="POST"
				action="?/blast"
				use:enhance={({ cancel }) => {
					if (!confirm(`Zakolejkować wysyłkę do wszystkich (${data.eligible}) z kategorii „${data.label}"?`)) {
						cancel();
						return;
					}
					sending = true;
					return async ({ update }) => {
						sending = false;
						await update();
					};
				}}
			>
				<input type="hidden" name="categoryId" value={data.category.id} />
				<button
					class="btn btn-primary"
					type="submit"
					disabled={sending || !canSend}
					title={!data.category.hasTemplate
						? 'Najpierw ustaw szablon Resend w zakładce Kategorie'
						: data.eligible === 0
							? 'Brak kontaktów ze zgodą RODO i poprawnym e-mailem'
							: 'Zakolejkuj wysyłkę do wszystkich w tej kategorii'}
				>
					{sending ? 'Kolejkowanie…' : `Wyślij do wszystkich (${data.eligible})`}
				</button>
			</form>
		{/if}
	</div>
</div>

{#if data.error}
	<div class="alert alert-error" style="margin: var(--space-4) 0">{data.error}</div>
{/if}

{#if form?.error}
	<div class="alert alert-error" style="margin: var(--space-4) 0">{form.error}</div>
{/if}

{#if form?.blast}
	<div class="alert alert-success" style="margin: var(--space-4) 0">
		Zakolejkowano <strong>{form.blast.enqueued}</strong> z {form.blast.matched} kontaktów.
		{#if form.blast.skippedNoConsent > 0}· pominięto {form.blast.skippedNoConsent} bez zgody RODO{/if}
		{#if form.blast.skippedBadEmail > 0}· {form.blast.skippedBadEmail} z błędnym e-mailem{/if}
		{#if form.blast.skippedDuplicate > 0}· {form.blast.skippedDuplicate} już obsłużonych{/if}
		· Wysyłka partiami do {data.status.limit}/dobę (pierwszeństwo mają kampanie).
	</div>
{/if}

{#if !data.category}
	<div class="alert alert-warning" style="margin: var(--space-4) 0">
		Dla tego kodu nie ma zdefiniowanej aktywnej kategorii wysyłkowej — lista poniżej ma charakter
		informacyjny. Kategorie konfigurujesz w zakładce Kategorie.
	</div>
{/if}

<div class="table-wrap" style="margin-top: var(--space-4)">
	<div class="table-toolbar">
		<input
			class="form-input"
			type="search"
			placeholder="Szukaj: firma, osoba, e-mail, telefon, NIP…"
			bind:value={search}
			style="width: 360px; max-width: 100%"
		/>
		<span class="muted">{filtered.length} z {data.companies.length} firm</span>
	</div>
	<div class="table-scroll">
		<table class="tbl">
			<thead>
				<tr>
					<th>Firma / Osoba</th>
					<th>Kontakt</th>
					<th>Telefon</th>
					<th>NIP</th>
					<th>RODO</th>
					<th>Data zapisu</th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as c (c.id)}
					<tr class="row-click" onclick={() => goto(`/clients/${c.id}`)}>
						<td>
							<strong>{c.company ?? c.contact ?? '—'}</strong>
							{#if c.company && c.contact}<br /><span class="faint">{c.contact}</span>{/if}
						</td>
						<td>
							{#if c.email}
								<a
									href="/send?email={encodeURIComponent(c.email)}"
									onclick={(e) => e.stopPropagation()}
									title="Wyślij e-mail na ten adres"
								>{c.email}</a>
							{:else}
								—
							{/if}
						</td>
						<td>{c.phone ?? '—'}</td>
						<td>{c.nip ?? '—'}</td>
						<td>
							{#if hasRodoConsent(c.rodo)}
								<span class="badge badge-success">zgoda</span>
							{:else}
								<span class="badge badge-warning">sprzeciw</span>
							{/if}
						</td>
						<td style="white-space: nowrap">{c.created_at ? fmtDate(c.created_at) : '—'}</td>
					</tr>
				{:else}
					<tr>
						<td colspan="6" class="muted" style="text-align: center; padding: var(--space-8)">
							Brak firm w tej kategorii.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
