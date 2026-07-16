<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();
	let sending = $state(false);
</script>

<svelte:head><title>Wyślij email — Aura HUB</title></svelte:head>

<h1 class="page-title">WYŚLIJ EMAIL</h1>
<p class="page-subtitle">
	Szybka wysyłka 1-do-1: adres, kategorie, SEND. Każda zaznaczona kategoria to osobny, dedykowany
	mail z załącznikami z biblioteki.
</p>

{#if form?.error}
	<div class="alert alert-error">{form.error}</div>
{/if}

{#if form?.results}
	<div class="card">
		<h3 style="margin-bottom: var(--space-3)">Wynik wysyłki do {form.email}</h3>
		<table class="tbl">
			<thead><tr><th>Kategoria</th><th>Status</th><th>Szczegóły</th></tr></thead>
			<tbody>
				{#each form.results as r (r.categoryId)}
					<tr>
						<td>{r.name}</td>
						<td>
							{#if r.ok}
								<span class="badge badge-success">Wysłano</span>
							{:else}
								<span class="badge badge-error">Błąd</span>
							{/if}
						</td>
						<td class="mono">{r.ok ? (r.resendId ?? '') : (r.error ?? '')}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<form
	class="card"
	method="POST"
	use:enhance={() => {
		sending = true;
		return async ({ update }) => {
			sending = false;
			await update();
		};
	}}
>
	<div class="form-field" style="max-width: 420px">
		<label class="form-label" for="email">Adres e-mail odbiorcy</label>
		<input
			class="form-input"
			id="email"
			name="email"
			type="email"
			required
			placeholder="jan.kowalski@firma.pl"
			value={form?.email ?? data.prefillEmail ?? ''}
		/>
		<div class="form-hint">
			Jeśli adres istnieje w CRM, wysyłka zostanie dopisana do historii kontaktu.
		</div>
	</div>

	<div class="form-field">
		<span class="form-label">Kategorie (możesz zaznaczyć więcej niż jedną)</span>
		<div class="checkbox-grid">
			{#each data.categories as c (c.id)}
				<label class="checkbox-tile">
					<input
						type="checkbox"
						name="categories"
						value={c.id}
						checked={form?.categoryIds?.includes(c.id) ?? false}
					/>
					<span>
						<strong>{c.name}</strong>
						<span class="mono faint" style="display: block">{c.code}</span>
						{#if !c.hasTemplate}
							<span class="badge badge-warning" style="margin-top: 4px">brak szablonu Resend</span>
						{:else if c.attachments.length > 0}
							<span class="faint" style="display: block; font-size: var(--text-xs); margin-top: 4px">
								📎 {c.attachments.join(', ')}
							</span>
						{:else}
							<span class="faint" style="display: block; font-size: var(--text-xs); margin-top: 4px">
								bez załączników
							</span>
						{/if}
					</span>
				</label>
			{/each}
		</div>
	</div>

	<button class="btn btn-primary btn-lg" type="submit" disabled={sending}>
		{sending ? 'Wysyłanie…' : 'SEND'}
	</button>
</form>
