<script lang="ts">
	import { enhance } from '$app/forms';
	import { PRESET_KINDS, PRESET_LABELS, type PresetKind } from '$lib/utm';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	function presets(kind: PresetKind) {
		return data.presets.filter((p) => p.kind === kind);
	}
</script>

<svelte:head><title>Słowniki UTM — Aura HUB</title></svelte:head>

<h1 class="page-title">Serwisy i słowniki UTM</h1>
<p class="page-subtitle">
	Tu ustalamy, z czego generator ma do wyboru budować linki. Słownik istnieje po to, żeby
	„Facebook”, „facebook” i „FB” nie rozjechały się w raporcie na trzy osobne źródła. Wszystkie
	wartości są normalizowane tak samo: polskie znaki na ASCII, małe litery, spacje na myślnik.
	<a href="/utm">Wróć do generatora</a>.
</p>

{#if form?.error}
	<div class="alert alert-error">{form.error}</div>
{/if}
{#if form?.success}
	<div class="alert alert-success">{form.success}</div>
{/if}

<form class="card" method="POST" action="?/createDestination" use:enhance style="border-style: dashed">
	<h3 style="margin-bottom: var(--space-3)">➕ Nowy serwis</h3>
	<div class="form-row">
		<div class="form-field">
			<label class="form-label" for="d-name">Nazwa</label>
			<input class="form-input" id="d-name" name="name" required placeholder="np. Gwarancje" />
		</div>
		<div class="form-field">
			<label class="form-label" for="d-url">Adres startowy</label>
			<input class="form-input mono" id="d-url" name="base_url" required placeholder="https://gwarancje.pro" />
		</div>
		<div class="form-field">
			<label class="form-label" for="d-code">Kod (puste = z nazwy)</label>
			<input class="form-input mono" id="d-code" name="code" />
		</div>
		<div class="form-field" style="max-width: 120px">
			<label class="form-label" for="d-sort">Kolejność</label>
			<input class="form-input" id="d-sort" name="sort_order" type="number" value="100" />
		</div>
	</div>
	<button class="btn btn-primary" type="submit">Dodaj serwis</button>
</form>

{#each data.destinations as destination (destination.id)}
	<form
		class="card"
		method="POST"
		action="?/updateDestination"
		use:enhance={() => async ({ update }) => await update({ reset: false })}
	>
		<input type="hidden" name="id" value={destination.id} />
		<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-3)">
			<h3>{destination.name} <span class="mono faint" style="font-size: var(--text-sm)">({destination.code})</span></h3>
			{#if destination.active}
				<span class="badge badge-success">Aktywny</span>
			{:else}
				<span class="badge badge-muted">Wyłączony</span>
			{/if}
		</div>
		<div class="form-row">
			<div class="form-field">
				<label class="form-label" for="name-{destination.id}">Nazwa</label>
				<input class="form-input" id="name-{destination.id}" name="name" value={destination.name} />
			</div>
			<div class="form-field">
				<label class="form-label" for="url-{destination.id}">Adres startowy</label>
				<input class="form-input mono" id="url-{destination.id}" name="base_url" value={destination.base_url} />
			</div>
			<div class="form-field" style="max-width: 120px">
				<label class="form-label" for="sort-{destination.id}">Kolejność</label>
				<input class="form-input" id="sort-{destination.id}" name="sort_order" type="number" value={destination.sort_order} />
			</div>
		</div>
		<div class="form-row">
			<div class="form-field">
				<label class="form-label" for="notes-{destination.id}">Notatka</label>
				<input class="form-input" id="notes-{destination.id}" name="notes" value={destination.notes ?? ''} />
			</div>
			<div class="form-field">
				<label class="form-label" for="active-{destination.id}">Dostępny w generatorze</label>
				<label style="display: flex; gap: 8px; align-items: center">
					<input id="active-{destination.id}" type="checkbox" name="active" checked={destination.active} />
					Pokazuj na liście serwisów
				</label>
			</div>
		</div>
		<button class="btn btn-primary" type="submit">Zapisz serwis</button>
	</form>
{/each}

<h2 class="page-title" style="margin-top: var(--space-6); font-size: var(--text-xl, 1.25rem)">Słowniki wartości</h2>

<form class="card" method="POST" action="?/createPreset" use:enhance style="border-style: dashed">
	<h3 style="margin-bottom: var(--space-3)">➕ Nowa wartość</h3>
	<div class="form-row">
		<div class="form-field">
			<label class="form-label" for="p-kind">Rodzaj</label>
			<select class="form-select" id="p-kind" name="kind">
				{#each PRESET_KINDS as kind (kind)}
					<option value={kind}>{PRESET_LABELS[kind]}</option>
				{/each}
			</select>
		</div>
		<div class="form-field">
			<label class="form-label" for="p-value">Wartość</label>
			<input class="form-input mono" id="p-value" name="value" required placeholder="np. newsletter" />
		</div>
		<div class="form-field">
			<label class="form-label" for="p-label">Etykieta w UI</label>
			<input class="form-input" id="p-label" name="label" placeholder="np. Newsletter miesięczny" />
		</div>
		<div class="form-field" style="max-width: 120px">
			<label class="form-label" for="p-sort">Kolejność</label>
			<input class="form-input" id="p-sort" name="sort_order" type="number" value="100" />
		</div>
	</div>
	<button class="btn btn-primary" type="submit">Dodaj wartość</button>
</form>

{#each PRESET_KINDS as kind (kind)}
	<div class="table-wrap">
		<div class="table-toolbar"><h3>{PRESET_LABELS[kind]} ({presets(kind).length})</h3></div>
		<div class="table-scroll">
			<table class="tbl">
				<thead>
					<tr><th>Wartość</th><th>Etykieta</th><th>Status</th><th>Akcja</th></tr>
				</thead>
				<tbody>
					{#each presets(kind) as preset (preset.id)}
						<tr>
							<td class="mono">{preset.value}</td>
							<td>{preset.label ?? '—'}</td>
							<td>
								{#if preset.active}
									<span class="badge badge-success">Aktywna</span>
								{:else}
									<span class="badge badge-muted">Wyłączona</span>
								{/if}
							</td>
							<td>
								<form method="POST" action="?/togglePreset" use:enhance>
									<input type="hidden" name="id" value={preset.id} />
									<input type="hidden" name="active" value={preset.active ? '0' : '1'} />
									<button class="btn btn-ghost" type="submit">
										{preset.active ? 'Wyłącz' : 'Włącz'}
									</button>
								</form>
							</td>
						</tr>
					{:else}
						<tr><td colspan="4" class="faint">Brak wartości w tym słowniku.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/each}
