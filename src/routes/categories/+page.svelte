<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();
</script>

<svelte:head><title>Kategorie — Aura HUB</title></svelte:head>

<h1 class="page-title">Kategorie wysyłki</h1>
<p class="page-subtitle">
	Sekcje = „co wysyłamy”. Każda kategoria ma szablon Resend, temat, nadawcę i domyślne załączniki
	(przypinane w bibliotece). W szablonie Resend użyj wbudowanej zmiennej
	<span class="mono">{'{{{UNSUBSCRIBE_URL}}}'}</span> jako linku wypisu oraz zmiennych
	<span class="mono">firma</span>, <span class="mono">kontakt</span>, <span class="mono">miasto</span>,
	<span class="mono">nip</span>.
</p>

{#if form?.error}
	<div class="alert alert-error">{form.error}</div>
{/if}
{#if form?.success}
	<div class="alert alert-success">{form.success}</div>
{/if}

{#each data.categories as category (category.id)}
	<form class="card" method="POST" action="?/update" use:enhance>
		<input type="hidden" name="id" value={category.id} />
		<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-3)">
			<h3>
				{category.name}
				<span class="mono faint" style="font-size: var(--text-sm)">({category.code})</span>
			</h3>
			{#if category.active}
				<span class="badge badge-success">Aktywna</span>
			{:else}
				<span class="badge badge-muted">Nieaktywna</span>
			{/if}
		</div>
		<div class="form-row">
			<div class="form-field">
				<label class="form-label" for="name-{category.id}">Etykieta w UI</label>
				<input class="form-input" id="name-{category.id}" name="name" value={category.name} />
			</div>
			<div class="form-field">
				<label class="form-label" for="tpl-{category.id}">Szablon Resend (id lub alias)</label>
				<input
					class="form-input mono"
					id="tpl-{category.id}"
					name="resend_template_id"
					value={category.resend_template_id ?? ''}
					placeholder="np. tmpl_xxxxxxxx"
				/>
			</div>
		</div>
		<div class="form-row">
			<div class="form-field">
				<label class="form-label" for="subject-{category.id}">Temat maila</label>
				<input class="form-input" id="subject-{category.id}" name="subject" value={category.subject ?? ''} />
			</div>
			<div class="form-field">
				<label class="form-label" for="from-{category.id}">Nadawca (puste = RESEND_FROM)</label>
				<input
					class="form-input"
					id="from-{category.id}"
					name="from_email"
					value={category.from_email ?? ''}
					placeholder="Aura Consulting <biuro@...>"
				/>
			</div>
			<div class="form-field" style="max-width: 120px">
				<label class="form-label" for="sort-{category.id}">Kolejność</label>
				<input
					class="form-input"
					id="sort-{category.id}"
					name="sort_order"
					type="number"
					value={category.sort_order}
				/>
			</div>
		</div>
		<div style="display: flex; justify-content: space-between; align-items: center">
			<label style="display: flex; gap: 8px; align-items: center; font-size: var(--text-sm)">
				<input type="checkbox" name="active" checked={category.active} />
				Kategoria aktywna (widoczna w szybkiej wysyłce i kampaniach)
			</label>
			<button class="btn btn-primary" type="submit">Zapisz</button>
		</div>
	</form>
{/each}
