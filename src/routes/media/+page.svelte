<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		EMAIL_CONTENT_WIDTH,
		MEDIA_ACCEPT,
		MEDIA_HEAVY_IMAGE_BYTES,
		MEDIA_MAX_BYTES,
		MEDIA_PUBLIC_BASE,
		acceptForType,
		formatBytes,
		imgSnippet,
		typeForKey
	} from '$lib/media';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	let busy = $state<string | null>(null);
	let copied = $state<string | null>(null);
	let filter = $state('');
	let clientError = $state('');

	const usedFolders = $derived([...new Set(data.items.map((i) => i.folder))].sort());
	// Folder, którego już nie ma (usunięto ostatni plik), nie może zostawić pustej listy.
	const activeFilter = $derived(usedFolders.includes(filter) ? filter : '');
	const visible = $derived(activeFilter ? data.items.filter((i) => i.folder === activeFilter) : data.items);

	/** Błąd akcji przypisany do konkretnego pliku pokazujemy przy jego wierszu, nie tylko na górze. */
	const rowErrorKey = $derived(form && 'key' in form && form.error ? (form.key as string | undefined) : undefined);

	async function copy(text: string, id: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = id;
			setTimeout(() => (copied = copied === id ? null : copied), 1500);
		} catch {
			window.prompt('Skopiuj:', text);
		}
	}

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'short', timeStyle: 'short' });
	}

	function tooBig(file: FormDataEntryValue | null): boolean {
		return file instanceof File && file.size > MEDIA_MAX_BYTES;
	}

	/** Wysyłka formularza „Podmień” po wybraniu pliku (potwierdzenie jest w use:enhance). */
	function submitOnChange(e: Event) {
		(e.currentTarget as HTMLInputElement).form?.requestSubmit();
	}
</script>

<svelte:head><title>Media — Aura HUB</title></svelte:head>

<h1 class="page-title">Media</h1>
<p class="page-subtitle">
	Grafiki i PDF-y do maili pod stałym, publicznym adresem
	<span class="mono">{MEDIA_PUBLIC_BASE}/…</span>. Adres działa niezależnie od HUB.
	<strong>Wszystko tutaj jest publiczne</strong> — dokumenty z danymi klientów trzymaj w
	<a href="/library">Bibliotece załączników</a>.
</p>

{#if !data.configured}
	<div class="alert alert-error">
		Magazyn mediów nie jest podłączony: w ustawieniach projektu Pages „hub” dodaj binding R2
		<span class="mono">MEDIA</span> → kubełek <span class="mono">aura-media</span> (production i preview),
		potem zrób redeploy.
	</div>
{/if}
{#if data.listError}
	<div class="alert alert-error">{data.listError}</div>
{/if}
{#if clientError}
	<div class="alert alert-error">{clientError}</div>
{/if}
{#if form?.error && !rowErrorKey}
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
	use:enhance={({ formData, formElement, cancel }) => {
		clientError = '';
		if (tooBig(formData.get('file'))) {
			clientError = `Plik przekracza ${formatBytes(MEDIA_MAX_BYTES)}.`;
			return cancel();
		}
		busy = 'upload';
		return async ({ update, result }) => {
			busy = null;
			// Folder zostaje — kolejny plik do tej samej kampanii nie wyląduje u innej marki.
			await update({ reset: false });
			if (result.type === 'success') {
				const file = formElement.elements.namedItem('file') as HTMLInputElement | null;
				const name = formElement.elements.namedItem('name') as HTMLInputElement | null;
				if (file) file.value = '';
				if (name) name.value = '';
			}
		};
	}}
>
	<h3 style="margin-bottom: var(--space-4)">Wgraj plik</h3>
	<div class="form-row">
		<div class="form-field">
			<label class="form-label" for="media-folder">Folder (marka)</label>
			<input class="form-input" id="media-folder" name="folder" list="media-folders" required value="beautypolisa" />
			<datalist id="media-folders">
				{#each data.folders as f (f)}<option value={f}></option>{/each}
			</datalist>
		</div>
		<div class="form-field">
			<label class="form-label" for="media-name">Nazwa w adresie (opcjonalnie)</label>
			<input class="form-input" id="media-name" name="name" type="text" placeholder="np. hero-grupa-otwarta-2026" />
		</div>
		<div class="form-field">
			<label class="form-label" for="media-file">Plik (JPG, PNG, GIF, PDF — do {formatBytes(MEDIA_MAX_BYTES)})</label>
			<input class="form-input" id="media-file" name="file" type="file" accept={MEDIA_ACCEPT} required />
		</div>
	</div>
	<p class="muted" style="font-size: var(--text-sm); margin: 0 0 var(--space-3)">
		Adres powstaje z folderu i nazwy: małe litery, bez polskich znaków. Istniejącego pliku nie da się
		nadpisać przez pomyłkę — do wymiany służy „Podmień”. Grafika do maila: JPG (zdjęcia) albo PNG
		(logo, tekst), poniżej {formatBytes(MEDIA_HEAVY_IMAGE_BYTES)}, szeroka na ok. {EMAIL_CONTENT_WIDTH * 2} px
		(2× kolumna maila). W mailu zawsze z atrybutem <span class="mono">width</span> — przycisk
		„Kopiuj kod obrazka” robi to za Ciebie.
	</p>
	<button class="btn btn-primary" type="submit" disabled={busy !== null || !data.configured}>
		{busy === 'upload' ? 'Wgrywanie…' : 'Wgraj'}
	</button>
</form>

<div class="table-wrap">
	<div class="table-toolbar" style="display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap">
		<h3>Pliki ({visible.length})</h3>
		{#if usedFolders.length > 1}
			<select class="form-input" style="width: auto" bind:value={filter} aria-label="Folder">
				<option value="">Wszystkie foldery</option>
				{#each usedFolders as f (f)}<option value={f}>{f}</option>{/each}
			</select>
		{/if}
	</div>
	<div class="table-scroll">
		<table class="tbl">
			<thead>
				<tr>
					<th>Podgląd</th>
					<th>Adres do wklejenia w mailu</th>
					<th class="num">Rozmiar</th>
					<th>Wgrano</th>
					<th>Akcje</th>
				</tr>
			</thead>
			<tbody>
				{#each visible as item (item.key)}
					<tr>
						<td style="width: 96px">
							{#if item.image}
								<a href={item.url} target="_blank" rel="noopener">
									<img
										src="{item.url}?v={encodeURIComponent(item.etag)}"
										alt={item.name}
										loading="lazy"
										style="width: 88px; height: 56px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border, #e3e7f0)"
									/>
								</a>
							{:else}
								<a class="btn btn-ghost" href={item.url} target="_blank" rel="noopener">PDF</a>
							{/if}
						</td>
						<td>
							<div class="mono" style="word-break: break-all">{item.url}</div>
							{#if item.originalName}
								<div class="muted" style="font-size: var(--text-sm)">z pliku: {item.originalName}</div>
							{/if}
							{#if rowErrorKey === item.key && form?.error}
								<div class="alert alert-error" style="margin-top: 6px">{form.error}</div>
							{/if}
						</td>
						<td class="num">
							{formatBytes(item.size)}
							{#if item.width && item.height}
								<div class="muted" style="font-size: var(--text-sm)">{item.width}×{item.height} px</div>
							{/if}
							{#if item.image && item.size > MEDIA_HEAVY_IMAGE_BYTES}
								<div style="font-size: var(--text-sm); color: var(--warning, #b45309)">ciężka do maila</div>
							{/if}
						</td>
						<td style="white-space: nowrap">{fmtDate(item.uploaded)}</td>
						<td style="white-space: nowrap">
							<button class="btn btn-primary" type="button" aria-label="Kopiuj adres {item.key}" onclick={() => copy(item.url, `url:${item.key}`)}>
								{copied === `url:${item.key}` ? 'Skopiowano' : 'Kopiuj adres'}
							</button>
							{#if item.image}
								<button
									class="btn btn-ghost"
									type="button"
									aria-label="Kopiuj kod obrazka {item.key}"
									title="Znacznik &lt;img&gt; z width={EMAIL_CONTENT_WIDTH} — szerokość kolumny maila z edytora HUB. W szablonie na pełne 600 px zmień na 600."
									onclick={() => copy(imgSnippet(item.url), `img:${item.key}`)}
								>
									{copied === `img:${item.key}` ? 'Skopiowano' : 'Kopiuj kod obrazka'}
								</button>
							{/if}
							<form
								method="POST"
								action="?/replace"
								enctype="multipart/form-data"
								style="display: inline"
								use:enhance={({ formData, formElement, cancel }) => {
									const file = formData.get('file');
									const input = formElement.elements.namedItem('file') as HTMLInputElement | null;
									const fileName = file instanceof File ? file.name : '';
									clientError = '';
									if (tooBig(file)) {
										clientError = `Plik przekracza ${formatBytes(MEDIA_MAX_BYTES)}.`;
										if (input) input.value = '';
										return cancel();
									}
									if (!confirm(`Podmienić ${item.key} plikiem „${fileName}”?\n\nMaile, które już poszły, zaczną pokazywać nową wersję; poprzedniej nie da się odzyskać.`)) {
										if (input) input.value = '';
										return cancel();
									}
									busy = item.key;
									return async ({ update }) => {
										busy = null;
										await update();
										// Ten sam plik wybrany ponownie musi znów wywołać zmianę.
										if (input) input.value = '';
									};
								}}
							>
								<input type="hidden" name="key" value={item.key} />
								<label class="btn btn-ghost replace-label">
									{busy === item.key ? 'Wgrywanie…' : 'Podmień'}
									<input
										class="sr-only"
										type="file"
										name="file"
										aria-label="Podmień {item.key}"
										accept={acceptForType(typeForKey(item.key))}
										disabled={busy !== null}
										onchange={submitOnChange}
									/>
								</label>
							</form>
							<form
								method="POST"
								action="?/remove"
								style="display: inline"
								use:enhance={({ cancel, formData }) => {
									const effect = item.image
										? 'Maile, które już poszły z tym adresem, pokażą w tym miejscu pustą ramkę.'
										: 'Linki do tego pliku w wysłanych mailach przestaną działać.';
									if (!confirm(`Usunąć ${item.key}?\n\n${effect}`)) return cancel();
									// Serwer usuwa tylko z tym potwierdzeniem — formularz wysłany bez skryptów nic nie zrobi.
									formData.set('confirmed', item.key);
								}}
							>
								<input type="hidden" name="key" value={item.key} />
								<button class="btn btn-danger" type="submit" aria-label="Usuń {item.key}">Usuń</button>
							</form>
						</td>
					</tr>
				{:else}
					<tr><td colspan="5" class="muted">Nie ma jeszcze żadnych plików.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.replace-label {
		cursor: pointer;
		position: relative;
	}
	.replace-label:focus-within {
		outline: 2px solid var(--accent, #2b3a67);
		outline-offset: 2px;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
