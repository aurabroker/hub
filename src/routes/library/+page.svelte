<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();
	let uploading = $state(false);
	let editingAsset = $state<string | null>(null);

	function assetCategories(assetId: string): string[] {
		return data.links.filter((l) => l.asset_id === assetId).map((l) => l.category_id as string);
	}

	function categoryNames(assetId: string): string {
		const ids = new Set(assetCategories(assetId));
		return data.categories
			.filter((c) => ids.has(c.id as string))
			.map((c) => c.name as string)
			.join(', ');
	}

	function formatSize(bytes: number | null): string {
		if (bytes == null) return '—';
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}
</script>

<svelte:head><title>Biblioteka załączników — Aura HUB</title></svelte:head>

<h1 class="page-title">Biblioteka załączników</h1>
<p class="page-subtitle">
	Wgraj plik raz i używaj wielokrotnie. Pliki leżą w prywatnym buckecie
	<span class="mono">email-assets</span> — do maili trafiają jako załączniki, nigdy jako publiczne
	linki.
</p>

{#if form?.error}
	<div class="alert alert-error">{form.error}</div>
{/if}
{#if form?.success}
	<div class="alert alert-success">{form.success}</div>
{/if}

<form
	class="card"
	method="POST"
	action="?/upload"
	enctype="multipart/form-data"
	use:enhance={() => {
		uploading = true;
		return async ({ update }) => {
			uploading = false;
			await update();
		};
	}}
>
	<h3 style="margin-bottom: var(--space-4)">Dodaj plik do biblioteki</h3>
	<div class="form-row">
		<div class="form-field">
			<label class="form-label" for="file">Plik (PDF, max ~28 MB)</label>
			<input class="form-input" id="file" name="file" type="file" required />
		</div>
		<div class="form-field">
			<label class="form-label" for="name">Nazwa robocza (opcjonalnie)</label>
			<input class="form-input" id="name" name="name" type="text" placeholder="np. OWU OC 2026" />
		</div>
	</div>
	<button class="btn btn-primary" type="submit" disabled={uploading}>
		{uploading ? 'Wgrywanie…' : 'Wgraj do biblioteki'}
	</button>
</form>

<div class="table-wrap">
	<div class="table-toolbar"><h3>Pliki ({data.assets.length})</h3></div>
	<div class="table-scroll">
		<table class="tbl">
			<thead>
				<tr>
					<th>Nazwa</th>
					<th>Plik w mailu</th>
					<th class="num">Rozmiar</th>
					<th>Przypięte kategorie</th>
					<th>Akcje</th>
				</tr>
			</thead>
			<tbody>
				{#each data.assets as asset (asset.id)}
					<tr>
						<td><strong>{asset.name}</strong></td>
						<td class="mono">{asset.filename}</td>
						<td class="num">{formatSize(asset.size_bytes)}</td>
						<td>
							{#if editingAsset === asset.id}
								<form
									method="POST"
									action="?/pin"
									use:enhance={() => {
										// panel zamykamy dopiero po zakończeniu zapisu,
										// inaczej formularz zniknąłby z DOM przed wysłaniem
										return async ({ update }) => {
											editingAsset = null;
											await update();
										};
									}}
								>
									<input type="hidden" name="asset_id" value={asset.id} />
									{#each data.categories as c (c.id)}
										<label style="display: flex; gap: 6px; font-size: var(--text-sm); align-items: center">
											<input
												type="checkbox"
												name="categories"
												value={c.id}
												checked={assetCategories(asset.id).includes(c.id as string)}
											/>
											{c.name}
										</label>
									{/each}
									<div style="display: flex; gap: 6px; margin-top: 6px">
										<button class="btn btn-primary" type="submit">Zapisz</button>
										<button class="btn btn-ghost" type="button" onclick={() => (editingAsset = null)}>
											Anuluj
										</button>
									</div>
								</form>
							{:else}
								{categoryNames(asset.id) || '—'}
								<button
									class="btn btn-ghost"
									style="padding: 2px 8px; margin-left: 6px"
									onclick={() => (editingAsset = asset.id)}
								>
									Zmień
								</button>
							{/if}
						</td>
						<td style="white-space: nowrap">
							<a class="btn btn-ghost" href="/library/download/{asset.id}" target="_blank">Pobierz</a>
							<form method="POST" action="?/remove" style="display: inline" use:enhance>
								<input type="hidden" name="asset_id" value={asset.id} />
								<button class="btn btn-danger" type="submit">Usuń</button>
							</form>
						</td>
					</tr>
				{:else}
					<tr><td colspan="5" class="muted">Biblioteka jest pusta — wgraj pierwszy plik.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
