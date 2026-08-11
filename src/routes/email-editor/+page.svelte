<script lang="ts">
	import { enhance } from '$app/forms';
	import ReactIsland from '$lib/react/ReactIsland.svelte';
	import EmailEditor from '$lib/react/EmailEditor';
	import { renderEmailHtml, wrapEmailHtml } from '$lib/email/render';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const SAMPLE = {
		firma: 'Przykładowa Firma sp. z o.o.',
		kontakt: 'Jan Kowalski',
		miasto: 'Warszawa',
		nip: '1234567890'
	};

	let selectedOverride = $state<string | null>(null);
	const selectedId = $derived(selectedOverride ?? data.categories[0]?.id ?? '');
	let bodyHtml = $state('');
	let subject = $state('');
	let copied = $state(false);
	let busy = $state(false);

	const selected = $derived(data.categories.find((c) => c.id === selectedId) ?? null);

	// Wczytaj treść/temat tylko przy realnej zmianie sekcji — nie przy każdym
	// odświeżeniu danych (inaczej po teście skasowałoby niezapisane zmiany).
	let loadedId = '';
	$effect(() => {
		if (selectedId !== loadedId) {
			loadedId = selectedId;
			const c = data.categories.find((x) => x.id === selectedId);
			bodyHtml = c?.html_body ?? '';
			subject = c?.subject ?? '';
		}
	});

	function onChange(html: string) {
		bodyHtml = html;
	}

	const previewHtml = $derived(
		renderEmailHtml(bodyHtml, SAMPLE, { unsubscribeUrl: 'https://przyklad/wypis' })
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
</script>

<svelte:head><title>Edytor e-mail — Aura HUB</title></svelte:head>

<h1 class="page-title">EDYTOR E-MAIL</h1>
<p class="page-subtitle">
	Skomponuj treść, zapisz w sekcji i wysyłaj bezpośrednio z HUB — bez wychodzenia do Resend.
	Gdy sekcja ma zapisaną treść, wszystkie wysyłki tej sekcji (szybka, kampanie, „do wszystkich")
	używają jej zamiast szablonu Resend.
</p>

{#if form?.saved}
	<div class="alert alert-success">Zapisano treść sekcji.</div>
{:else if form?.tested}
	<div class="alert alert-success">Wysłano testowego maila na {form.tested}.</div>
{:else if form?.error}
	<div class="alert alert-error">{form.error}</div>
{/if}

<div class="card" style="display: flex; gap: var(--space-4); flex-wrap: wrap; align-items: flex-end">
	<div class="form-field" style="margin: 0; min-width: 240px">
		<label class="form-label" for="cat">Sekcja</label>
		<select class="form-select" id="cat" value={selectedId} onchange={(e) => (selectedOverride = e.currentTarget.value)}>
			{#each data.categories as c (c.id)}
				<option value={c.id}>{c.name}{c.html_body ? ' • ma treść HTML' : c.hasTemplate ? ' • szablon Resend' : ''}</option>
			{/each}
		</select>
	</div>
	<div class="form-field" style="margin: 0; flex: 1; min-width: 240px">
		<label class="form-label" for="subj">Temat maila (wymagany przy treści HTML)</label>
		<input class="form-input" id="subj" bind:value={subject} placeholder="np. Ubezpieczenie OC dla Twojej firmy" />
	</div>
</div>

<div class="grid-2" style="margin-top: var(--space-5)">
	<div class="card">
		<h3 style="margin-bottom: var(--space-3)">Edytor treści</h3>
		{#key selectedId}
			<ReactIsland component={EmailEditor} props={{ initialHtml: selected?.html_body ?? '', onChange }} />
		{/key}

		<div style="display: flex; gap: var(--space-2); margin-top: var(--space-4); flex-wrap: wrap">
			<form method="POST" action="?/save" use:enhance={() => { busy = true; return async ({ update }) => { busy = false; await update(); }; }}>
				<input type="hidden" name="categoryId" value={selectedId} />
				<input type="hidden" name="subject" value={subject} />
				<input type="hidden" name="html" value={bodyHtml} />
				<button class="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Zapisywanie…' : 'Zapisz w sekcji'}</button>
			</form>
			<button class="btn btn-ghost" type="button" onclick={copyHtml}>{copied ? 'Skopiowano ✓' : 'Kopiuj HTML'}</button>
		</div>
	</div>

	<div class="card">
		<h3 style="margin-bottom: var(--space-3)">Podgląd (z przykładowymi danymi)</h3>
		<iframe
			title="Podgląd e-maila"
			srcdoc={previewHtml}
			style="width: 100%; height: 380px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: #fff"
		></iframe>

		<form
			method="POST"
			action="?/test"
			use:enhance={() => { busy = true; return async ({ update }) => { busy = false; await update(); }; }}
			style="display: flex; gap: var(--space-2); margin-top: var(--space-4); flex-wrap: wrap; align-items: flex-end"
		>
			<input type="hidden" name="categoryId" value={selectedId} />
			<input type="hidden" name="subject" value={subject} />
			<input type="hidden" name="html" value={bodyHtml} />
			<div class="form-field" style="margin: 0; flex: 1; min-width: 200px">
				<label class="form-label" for="te">Wyślij testowo na adres</label>
				<input class="form-input" id="te" name="testEmail" type="email" value={data.testEmail} placeholder="ty@twojafirma.pl" />
			</div>
			<button class="btn btn-ghost" type="submit" disabled={busy}>Wyślij test</button>
		</form>
	</div>
</div>

<div class="alert alert-warning" style="margin-top: var(--space-5)">
	<strong>Personalizacja:</strong> <span class="mono">{'{{firma}}'}</span>,
	<span class="mono">{'{{kontakt}}'}</span>, <span class="mono">{'{{miasto}}'}</span>,
	<span class="mono">{'{{nip}}'}</span>, link wypisu <span class="mono">{'{{{UNSUBSCRIBE_URL}}}'}</span>.
	Załączniki sekcji (jeśli są) dokładają się automatycznie przy realnej wysyłce.
	Test idzie z przykładowymi danymi i prefiksem <span class="mono">[TEST]</span>.
</div>
