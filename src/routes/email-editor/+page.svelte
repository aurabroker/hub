<script lang="ts">
	import { enhance } from '$app/forms';
	import ReactIsland from '$lib/react/ReactIsland.svelte';
	import EmailEditor from '$lib/react/EmailEditor';
	import { renderEmailHtml, wrapEmailHtml } from '$lib/email/render';
	import { fmtDateTime } from '$lib/ud/format';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const SAMPLE = {
		firma: 'Przykładowa Firma sp. z o.o.',
		kontakt: 'Jan Kowalski',
		miasto: 'Warszawa',
		nip: '1234567890'
	};

	// Stan roboczy edytora (nie zapisany nigdzie, dopóki nie klikniesz Zapisz/Zastosuj).
	let categoryOverride = $state<string | null>(null);
	const categoryId = $derived(categoryOverride ?? data.categories[0]?.id ?? '');
	let draftId = $state('');
	let draftName = $state('');
	let subject = $state('');
	let bodyHtml = $state('');
	let attachmentMode = $state('');
	let selectedAssets = $state<string[]>([]);
	let editorKey = $state(0);
	let busy = $state(false);
	let copied = $state(false);
	let showDrafts = $state(true);

	const selectedCategory = $derived(data.categories.find((c) => c.id === categoryId) ?? null);
	const draftsForView = $derived(
		data.drafts.filter((d) => !d.category_id || d.category_id === categoryId || !categoryId)
	);

	// Efektywne załączniki: wybrane w edytorze, a gdy brak → domyślne z sekcji.
	const effectiveAssets = $derived(
		selectedAssets.length > 0 ? selectedAssets : (selectedCategory?.assetIds ?? [])
	);
	const inheritedFromSection = $derived(selectedAssets.length === 0);

	function assetLabel(id: string): string {
		const a = data.assets.find((x) => x.id === id);
		return a ? a.name || a.filename : id;
	}

	function toggleAsset(id: string) {
		selectedAssets = selectedAssets.includes(id)
			? selectedAssets.filter((x) => x !== id)
			: [...selectedAssets, id];
	}

	function loadDraft(d: PageServerData['drafts'][number]) {
		draftId = d.id;
		draftName = d.name;
		subject = d.subject;
		bodyHtml = d.html_body;
		attachmentMode = d.attachment_mode;
		selectedAssets = [...d.assetIds];
		if (d.category_id) categoryOverride = d.category_id;
		editorKey++; // przemontuj edytor z nową treścią
	}

	function loadFromSection() {
		const c = selectedCategory;
		draftId = '';
		draftName = '';
		subject = c?.subject ?? '';
		bodyHtml = c?.html_body ?? '';
		attachmentMode = '';
		selectedAssets = [];
		editorKey++;
	}

	function newDraft() {
		draftId = '';
		draftName = '';
		subject = '';
		bodyHtml = '';
		attachmentMode = '';
		selectedAssets = [];
		editorKey++;
	}

	const previewHtml = $derived(
		renderEmailHtml(bodyHtml, SAMPLE, {
			unsubscribeUrl: 'https://przyklad/wypis',
			plikiHtml:
				attachmentMode === 'links' && effectiveAssets.length > 0
					? `<ul style="padding-left:18px">${effectiveAssets
							.map((id) => `<li><a href="#">${assetLabel(id)}</a></li>`)
							.join('')}</ul>`
					: ''
		})
	);

	async function copyHtml() {
		try {
			await navigator.clipboard.writeText(wrapEmailHtml(bodyHtml));
			copied = true;
			setTimeout(() => (copied = false), 1800);
		} catch {
			copied = false;
		}
	}

	const enhanceBusy = () => {
		busy = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			busy = false;
			await update();
		};
	};
</script>

<svelte:head><title>Edytor e-mail — Aura HUB</title></svelte:head>

<h1 class="page-title">EDYTOR E-MAIL</h1>
<p class="page-subtitle">
	Komponuj treść, odkładaj <strong>drafty</strong> do wielokrotnego użytku i wysyłaj bezpośrednio z HUB.
	Realna wysyłka używa treści zastosowanej do sekcji — drafty są robocze.
</p>

{#if form?.draftSaved}
	<div class="alert alert-success">Zapisano draft „{form.draftSaved}”.</div>
{:else if form?.draftDeleted}
	<div class="alert alert-success">Draft usunięty.</div>
{:else if form?.applied}
	<div class="alert alert-success">
		Zastosowano do sekcji — od teraz wysyłki tej sekcji używają tej treści.
	</div>
{:else if form?.uploaded}
	<div class="alert alert-success">Wgrano „{form.uploaded}” do biblioteki — zaznacz go poniżej.</div>
{:else if form?.tested}
	<div class="alert alert-success">Wysłano test na {form.tested}.</div>
{:else if form?.error}
	<div class="alert alert-error">{form.error}</div>
{/if}

<!-- Pasek: sekcja + temat + nazwa draftu -->
<div class="card" style="display: flex; gap: var(--space-4); flex-wrap: wrap; align-items: flex-end">
	<div class="form-field" style="margin: 0; min-width: 220px">
		<label class="form-label" for="cat">Sekcja (co wysyłamy)</label>
		<select
			class="form-select"
			id="cat"
			value={categoryId}
			onchange={(e) => (categoryOverride = e.currentTarget.value)}
		>
			{#each data.categories as c (c.id)}
				<option value={c.id}>{c.name}{c.html_body ? ' • treść HUB' : c.hasTemplate ? ' • szablon Resend' : ''}</option>
			{/each}
		</select>
	</div>
	<div class="form-field" style="margin: 0; flex: 1; min-width: 220px">
		<label class="form-label" for="subj">Temat maila</label>
		<input class="form-input" id="subj" bind:value={subject} placeholder="np. Ubezpieczenie OC dla Twojej firmy" />
	</div>
	<div class="form-field" style="margin: 0; min-width: 200px">
		<label class="form-label" for="dname">Nazwa draftu</label>
		<input class="form-input" id="dname" bind:value={draftName} placeholder="np. OC wersja krótka" />
	</div>
	<button class="btn btn-ghost" type="button" onclick={loadFromSection}>Wczytaj z sekcji</button>
	<button class="btn btn-ghost" type="button" onclick={newDraft}>Nowy</button>
</div>

<!-- Biblioteka draftów -->
<div class="table-wrap" style="margin-top: var(--space-5)">
	<div class="table-toolbar">
		<h3>
			Moje drafty ({draftsForView.length})
			{#if draftId}<span class="badge badge-primary" style="margin-left: 6px">edytujesz: {draftName || '—'}</span>{/if}
		</h3>
		<button class="btn btn-ghost" type="button" onclick={() => (showDrafts = !showDrafts)}>
			{showDrafts ? 'Ukryj' : 'Pokaż'}
		</button>
	</div>
	{#if showDrafts}
		<div class="table-scroll">
			<table class="tbl">
				<thead>
					<tr><th>Nazwa</th><th>Temat</th><th>Sekcja</th><th>Pliki</th><th>Zmieniono</th><th></th></tr>
				</thead>
				<tbody>
					{#each draftsForView as d (d.id)}
						<tr>
							<td><strong>{d.name}</strong></td>
							<td class="muted">{d.subject || '—'}</td>
							<td class="muted">
								{data.categories.find((c) => c.id === d.category_id)?.name ?? '—'}
							</td>
							<td class="muted">{d.assetIds.length > 0 ? `📎 ${d.assetIds.length}` : '—'}</td>
							<td class="muted" style="white-space: nowrap">{fmtDateTime(d.updated_at)}</td>
							<td style="white-space: nowrap; text-align: right">
								<button class="btn btn-ghost" type="button" onclick={() => loadDraft(d)}>Wczytaj</button>
								<form method="POST" action="?/draftDelete" use:enhance={enhanceBusy} style="display: inline">
									<input type="hidden" name="draftId" value={d.id} />
									<button class="btn btn-danger" type="submit" disabled={busy}>Usuń</button>
								</form>
							</td>
						</tr>
					{:else}
						<tr><td colspan="6" class="muted">Brak draftów — skomponuj treść i kliknij „Zapisz draft".</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<div class="grid-2" style="margin-top: var(--space-5)">
	<!-- EDYTOR -->
	<div class="card">
		<h3 style="margin-bottom: var(--space-3)">Treść</h3>
		{#key editorKey}
			<ReactIsland
				component={EmailEditor}
				props={{ initialHtml: bodyHtml, onChange: (h: string) => (bodyHtml = h) }}
			/>
		{/key}

		<div style="display: flex; gap: var(--space-2); margin-top: var(--space-4); flex-wrap: wrap">
			<form method="POST" action="?/draftSave" use:enhance={enhanceBusy}>
				<input type="hidden" name="draftId" value={draftId} />
				<input type="hidden" name="name" value={draftName} />
				<input type="hidden" name="subject" value={subject} />
				<input type="hidden" name="html" value={bodyHtml} />
				<input type="hidden" name="categoryId" value={categoryId} />
				<input type="hidden" name="attachmentMode" value={attachmentMode} />
				{#each selectedAssets as id (id)}<input type="hidden" name="assetIds" value={id} />{/each}
				<button class="btn btn-primary" type="submit" disabled={busy}>
					{draftId ? 'Zapisz draft' : 'Zapisz jako nowy draft'}
				</button>
			</form>

			<form method="POST" action="?/apply" use:enhance={enhanceBusy}>
				<input type="hidden" name="categoryId" value={categoryId} />
				<input type="hidden" name="subject" value={subject} />
				<input type="hidden" name="html" value={bodyHtml} />
				<input type="hidden" name="attachmentMode" value={attachmentMode} />
				{#each selectedAssets as id (id)}<input type="hidden" name="assetIds" value={id} />{/each}
				<button class="btn btn-primary" type="submit" disabled={busy}>Zastosuj do sekcji</button>
			</form>

			<button class="btn btn-ghost" type="button" onclick={copyHtml}>
				{copied ? 'Skopiowano ✓' : 'Kopiuj HTML'}
			</button>
		</div>
	</div>

	<!-- PODGLĄD -->
	<div class="card">
		<h3 style="margin-bottom: var(--space-3)">Podgląd (przykładowe dane)</h3>
		<iframe
			title="Podgląd e-maila"
			srcdoc={previewHtml}
			style="width: 100%; height: 340px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: #fff"
		></iframe>

		<form
			method="POST"
			action="?/test"
			use:enhance={enhanceBusy}
			style="display: flex; gap: var(--space-2); margin-top: var(--space-4); flex-wrap: wrap; align-items: flex-end"
		>
			<input type="hidden" name="categoryId" value={categoryId} />
			<input type="hidden" name="subject" value={subject} />
			<input type="hidden" name="html" value={bodyHtml} />
			<input type="hidden" name="attachmentMode" value={attachmentMode} />
			{#each effectiveAssets as id (id)}<input type="hidden" name="assetIds" value={id} />{/each}
			<div class="form-field" style="margin: 0; flex: 1; min-width: 200px">
				<label class="form-label" for="te">Wyślij testowo na adres</label>
				<input class="form-input" id="te" name="testEmail" type="email" value={data.testEmail} />
			</div>
			<button class="btn btn-ghost" type="submit" disabled={busy}>Wyślij test</button>
		</form>
	</div>
</div>

<!-- ZAŁĄCZNIKI -->
<div class="card" style="margin-top: var(--space-5)">
	<h3 style="margin-bottom: var(--space-3)">Załączniki</h3>

	<div class="form-field" style="max-width: 420px">
		<label class="form-label" for="mode">Jak mają dotrzeć</label>
		<select class="form-select" id="mode" bind:value={attachmentMode}>
			<option value="">jak ustawiono w sekcji ({selectedCategory?.attachment_mode ?? 'attachments'})</option>
			<option value="attachments">załącznik w mailu (Base64, łącznie ≤ ~28 MB)</option>
			<option value="links">linki do pobrania w treści (wstaw {'{{{pliki_html}}}'})</option>
		</select>
	</div>

	{#if inheritedFromSection}
		<p class="muted" style="margin-bottom: var(--space-3)">
			Nic nie zaznaczono — użyte zostaną domyślne pliki sekcji
			{#if (selectedCategory?.assetIds.length ?? 0) > 0}
				(<strong>{selectedCategory?.assetIds.length}</strong>:
				{selectedCategory?.assetIds.map(assetLabel).join(', ')})
			{:else}
				(sekcja nie ma przypiętych plików)
			{/if}. Zaznacz poniżej, aby nadpisać.
		</p>
	{:else}
		<p class="muted" style="margin-bottom: var(--space-3)">
			Zaznaczono <strong>{selectedAssets.length}</strong> — nadpiszą pliki sekcji przy „Zastosuj".
			<button class="btn btn-ghost" type="button" onclick={() => (selectedAssets = [])} style="margin-left: var(--space-2)">
				Wyczyść wybór
			</button>
		</p>
	{/if}

	<div class="checkbox-grid">
		{#each data.assets as a (a.id)}
			<label class="checkbox-tile">
				<input type="checkbox" checked={selectedAssets.includes(a.id)} onchange={() => toggleAsset(a.id)} />
				<span>
					<strong>{a.name || a.filename}</strong>
					<span class="faint" style="display: block">
						{a.filename} · {(a.size_bytes / 1024 / 1024).toFixed(2)} MB
					</span>
				</span>
			</label>
		{:else}
			<p class="muted">Biblioteka jest pusta — wgraj plik poniżej albo w <a href="/library">Bibliotece</a>.</p>
		{/each}
	</div>

	<form
		method="POST"
		action="?/upload"
		enctype="multipart/form-data"
		use:enhance={enhanceBusy}
		style="display: flex; gap: var(--space-2); margin-top: var(--space-4); flex-wrap: wrap; align-items: flex-end"
	>
		<div class="form-field" style="margin: 0; flex: 1; min-width: 240px">
			<label class="form-label" for="file">Wgraj nowy plik (trafi też do Biblioteki)</label>
			<input class="form-input" id="file" name="file" type="file" required />
		</div>
		<button class="btn btn-ghost" type="submit" disabled={busy}>Wgraj</button>
	</form>
</div>

<div class="alert alert-warning" style="margin-top: var(--space-5)">
	<strong>Personalizacja:</strong> <span class="mono">{'{{firma}}'}</span>,
	<span class="mono">{'{{kontakt}}'}</span>, <span class="mono">{'{{miasto}}'}</span>,
	<span class="mono">{'{{nip}}'}</span>, wypis <span class="mono">{'{{{UNSUBSCRIBE_URL}}}'}</span>.
	<br />
	<strong>Zapisz draft</strong> = odłóż wersję roboczą (nie wpływa na wysyłkę).
	<strong>Zastosuj do sekcji</strong> = od tej chwili wysyłki tej sekcji używają tej treści.
</div>
