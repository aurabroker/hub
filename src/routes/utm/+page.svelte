<script lang="ts">
	import { enhance } from '$app/forms';
	import { fmtDateTime } from '$lib/ud/format';
	import { buildUtmUrl, shortLinkUrl, slugifyUtm } from '$lib/utm';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	// --- Generator: stan formularza i podgląd adresu na żywo -----------------
	let destinationId = $state('');
	let path = $state('');
	let source = $state('');
	let medium = $state('');
	let campaign = $state('');
	let content = $state('');
	let term = $state('');
	let extraParams = $state('');
	let label = $state('');

	const chosen = $derived(data.destinations.find((d) => d.id === destinationId));

	/** Adres bazowy: serwis ze słownika plus opcjonalna ścieżka dopisana ręcznie. */
	const baseUrl = $derived.by(() => {
		if (!chosen) return '';
		const root = String(chosen.base_url).replace(/\/+$/, '');
		const suffix = path.trim();
		if (!suffix) return root;
		return suffix.startsWith('/') ? root + suffix : `${root}/${suffix}`;
	});

	const preview = $derived(
		baseUrl && slugifyUtm(source) && slugifyUtm(medium) && slugifyUtm(campaign)
			? buildUtmUrl(baseUrl, {
					source,
					medium,
					campaign,
					content,
					term,
					extra: parseExtra(extraParams)
				})
			: ''
	);

	function parseExtra(raw: string): Record<string, string> {
		const out: Record<string, string> = {};
		for (const line of raw.split('\n')) {
			const idx = line.indexOf('=');
			if (idx <= 0) continue;
			const key = line.slice(0, idx).trim();
			const value = line.slice(idx + 1).trim();
			if (key && value) out[key] = value;
		}
		return out;
	}

	function presets(kind: string) {
		return data.presets.filter((p) => p.kind === kind);
	}

	// --- Kopiowanie do schowka ----------------------------------------------
	let copied = $state('');
	async function copy(value: string, marker: string) {
		try {
			await navigator.clipboard.writeText(value);
			copied = marker;
			setTimeout(() => (copied = copied === marker ? '' : copied), 1500);
		} catch {
			copied = '';
		}
	}

	// --- Kod QR --------------------------------------------------------------
	let qrLink = $state<{ id: string; label: string; slug: string } | null>(null);
	let qrTarget = $state<'krotki' | 'pelny'>('krotki');
	const qrSrc = $derived(qrLink ? `/utm/qr/${qrLink.id}?cel=${qrTarget}&px=512` : '');

	/**
	 * PNG składamy w przeglądarce z pobranego SVG — dzięki temu serwer nie musi
	 * mieć kodera PNG, a operator dostaje plik gotowy do wklejenia w ulotkę.
	 */
	async function downloadPng(size = 1024) {
		if (!qrLink) return;
		const response = await fetch(`/utm/qr/${qrLink.id}?cel=${qrTarget}&px=${size}`);
		const svg = await response.text();
		const img = new Image();
		img.src = 'data:image/svg+xml;base64,' + btoa(String.fromCharCode(...new TextEncoder().encode(svg)));
		await img.decode();
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		canvas.getContext('2d')?.drawImage(img, 0, 0, size, size);
		const a = document.createElement('a');
		a.href = canvas.toDataURL('image/png');
		a.download = `qr-${qrLink.slug}.png`;
		a.click();
	}

	let editing = $state('');

	const bitlyLeft = $derived(Math.max(data.bitly.limit - data.bitly.used, 0));
</script>

<svelte:head><title>UTM — linki — Aura HUB</title></svelte:head>

<h1 class="page-title">Generator linków UTM</h1>
<p class="page-subtitle">
	Każdy link do naszych serwisów tagujemy parametrami <span class="mono">utm_*</span>, żeby dało
	się policzyć, co przynosi leady. Wartości wybieraj ze słownika — jedna literówka i kampania
	rozjedzie się w raporcie na dwa wiersze. Zapisany link dostaje krótki adres
	<span class="mono">/l/…</span>, którego kliknięcia liczymy u siebie, oraz kod QR do materiałów
	drukowanych. Serwisy i dopuszczalne wartości ustawiasz w
	<a href="/utm/slowniki">słownikach</a>, a wyniki zobaczysz w
	<a href="/utm/raport">raporcie</a>.
</p>

{#if form?.error}
	<div class="alert alert-error">{form.error}</div>
{/if}
{#if form?.success}
	<div class="alert alert-success">{form.success}</div>
{/if}

<form class="card" method="POST" action="?/create" use:enhance style="border-style: dashed">
	<h3 style="margin-bottom: var(--space-3)">➕ Nowy link</h3>

	<div class="form-row">
		<div class="form-field">
			<label class="form-label" for="destination">Serwis</label>
			<select class="form-select" id="destination" name="destination_id" bind:value={destinationId} required>
				<option value="">— wybierz serwis —</option>
				{#each data.destinations as destination (destination.id)}
					<option value={destination.id}>{destination.name} · {destination.base_url}</option>
				{/each}
			</select>
		</div>
		<div class="form-field">
			<label class="form-label" for="path">Podstrona (opcjonalnie)</label>
			<input class="form-input mono" id="path" bind:value={path} placeholder="/oferta-grupowe" />
			<span class="form-hint">Puste = strona główna serwisu.</span>
		</div>
	</div>
	<input type="hidden" name="base_url" value={baseUrl} />

	<div class="form-row">
		<div class="form-field">
			<label class="form-label" for="source">Źródło · utm_source</label>
			<input class="form-input mono" id="source" name="utm_source" list="lista-source" bind:value={source} required />
			<datalist id="lista-source">
				{#each presets('source') as preset (preset.id)}
					<option value={preset.value}>{preset.label}</option>
				{/each}
			</datalist>
		</div>
		<div class="form-field">
			<label class="form-label" for="medium">Medium · utm_medium</label>
			<input class="form-input mono" id="medium" name="utm_medium" list="lista-medium" bind:value={medium} required />
			<datalist id="lista-medium">
				{#each presets('medium') as preset (preset.id)}
					<option value={preset.value}>{preset.label}</option>
				{/each}
			</datalist>
		</div>
		<div class="form-field">
			<label class="form-label" for="campaign">Kampania · utm_campaign</label>
			<input
				class="form-input mono"
				id="campaign"
				name="utm_campaign"
				list="lista-campaign"
				bind:value={campaign}
				placeholder="np. wiosna-2026-grupowe"
				required
			/>
			<datalist id="lista-campaign">
				{#each presets('campaign') as preset (preset.id)}
					<option value={preset.value}>{preset.label}</option>
				{/each}
			</datalist>
		</div>
	</div>

	<div class="form-row">
		<div class="form-field">
			<label class="form-label" for="content">Wariant · utm_content</label>
			<input class="form-input mono" id="content" name="utm_content" bind:value={content} placeholder="np. baner-a" />
			<span class="form-hint">Rozróżnia kreacje w tej samej kampanii.</span>
		</div>
		<div class="form-field">
			<label class="form-label" for="term">Słowo kluczowe · utm_term</label>
			<input class="form-input mono" id="term" name="utm_term" bind:value={term} />
		</div>
		<div class="form-field">
			<label class="form-label" for="category">Sekcja wysyłki (opcjonalnie)</label>
			<select class="form-select" id="category" name="category_id">
				<option value="">— brak —</option>
				{#each data.categories as category (category.id)}
					<option value={category.id}>{category.name}</option>
				{/each}
			</select>
		</div>
	</div>

	<div class="form-row">
		<div class="form-field">
			<label class="form-label" for="label">Nazwa robocza</label>
			<input class="form-input" id="label" name="label" bind:value={label} placeholder="np. FB baner A — grupowe" />
			<span class="form-hint">Puste = nazwa kampanii.</span>
		</div>
		<div class="form-field">
			<label class="form-label" for="extra">Dodatkowe parametry</label>
			<textarea
				class="form-textarea mono"
				id="extra"
				name="extra_params"
				rows="2"
				bind:value={extraParams}
				placeholder="gad_campaignid=123"
			></textarea>
			<span class="form-hint">Po jednym w linii, w formacie klucz=wartość.</span>
		</div>
		<div class="form-field">
			<label class="form-label" for="notes">Notatka</label>
			<input class="form-input" id="notes" name="notes" />
		</div>
	</div>

	<div class="form-field" style="margin-bottom: var(--space-4)">
		<span class="form-label">Podgląd adresu</span>
		{#if preview}
			<div class="mono" style="word-break: break-all; padding: var(--space-3); background: var(--surface-2, rgba(127,127,127,0.08)); border-radius: 6px">
				{preview}
			</div>
			<span class="form-hint">
				Wartości są normalizowane: polskie znaki na ASCII, wielkie litery na małe, spacje na myślnik.
			</span>
		{:else}
			<div class="faint" style="padding: var(--space-3)">
				Wybierz serwis oraz uzupełnij źródło, medium i kampanię.
			</div>
		{/if}
	</div>

	<button class="btn btn-primary" type="submit" disabled={!preview}>Zapisz link</button>
</form>

<div class="table-wrap">
	<div class="table-toolbar" style="display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); flex-wrap: wrap">
		<h3>{data.filters.showArchived ? 'Archiwum' : 'Linki'} ({data.links.length})</h3>
		<div style="display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap">
			<form method="GET" style="display: flex; gap: var(--space-2)">
				<input class="form-input" name="q" value={data.filters.search} placeholder="Szukaj po nazwie, kampanii, adresie" />
				{#if data.filters.showArchived}<input type="hidden" name="archived" value="1" />{/if}
				<button class="btn btn-ghost" type="submit">Szukaj</button>
			</form>
			<a class="btn btn-ghost" href={data.filters.showArchived ? '/utm' : '/utm?archived=1'}>
				{data.filters.showArchived ? 'Pokaż aktywne' : 'Pokaż archiwum'}
			</a>
			{#if data.bitly.configured}
				<form method="POST" action="?/syncBitly" use:enhance>
					<button class="btn btn-ghost" type="submit" title="Pobierz liczniki kliknięć z API Bitly">
						⟳ Statystyki Bitly
					</button>
				</form>
			{/if}
		</div>
	</div>

	<div style="padding: 0 var(--space-4) var(--space-3)">
		{#if data.bitly.configured}
			<span class="faint" style="font-size: var(--text-sm)">
				Bitly: zużyto {data.bitly.used} z {data.bitly.limit} linków w tym miesiącu, zostało {bitlyLeft}.
				Kliknięcia linków Bitly nie przechodzą przez nasze przekierowanie, więc liczy je osobna kolumna.
			</span>
		{:else}
			<span class="faint" style="font-size: var(--text-sm)">
				Bitly nieskonfigurowane — ustaw <span class="mono">BITLY_TOKEN</span>, żeby skracać linki
				przyciskiem. Bez tokenu możesz wkleić krótki link ręcznie w edycji.
			</span>
		{/if}
	</div>

	<div class="table-scroll">
		<table class="tbl">
			<thead>
				<tr>
					<th>Nazwa / kampania</th>
					<th>Adres z UTM</th>
					<th>Krótki link</th>
					<th class="num">Kliknięcia</th>
					<th>Akcje</th>
				</tr>
			</thead>
			<tbody>
				{#each data.links as link (link.id)}
					{@const shortUrl = shortLinkUrl(data.shortBase, link.slug)}
					<tr>
						<td>
							<strong>{link.label}</strong><br />
							<span class="mono faint" style="font-size: var(--text-sm)">
								{link.utm_source} / {link.utm_medium} / {link.utm_campaign}{link.utm_content
									? ' / ' + link.utm_content
									: ''}
							</span>
							{#if link.notes}<br /><span class="faint" style="font-size: var(--text-sm)">{link.notes}</span>{/if}
						</td>
						<td class="mono" style="max-width: 320px; word-break: break-all; font-size: var(--text-sm)">
							{link.final_url}
						</td>
						<td class="mono" style="font-size: var(--text-sm)">
							{shortUrl}
							{#if link.short_url_external}
								<br /><span class="badge badge-muted">Bitly</span> {link.short_url_external}
							{/if}
						</td>
						<td class="num">
							<strong>{link.clicks_total + (link.bitly_clicks ?? 0)}</strong><br />
							<span class="faint" style="font-size: var(--text-sm)">
								własne {link.clicks_total}{link.bitly_id ? ` · Bitly ${link.bitly_clicks ?? 0}` : ''}
							</span>
							{#if link.last_click_at}
								<br /><span class="faint" style="font-size: var(--text-sm)">{fmtDateTime(link.last_click_at)}</span>
							{/if}
						</td>
						<td>
							<div style="display: flex; gap: 6px; flex-wrap: wrap">
								<button class="btn btn-ghost" type="button" onclick={() => copy(link.final_url, 'f' + link.id)}>
									{copied === 'f' + link.id ? '✓' : '⧉'} Adres
								</button>
								<button class="btn btn-ghost" type="button" onclick={() => copy(link.short_url_external || shortUrl, 's' + link.id)}>
									{copied === 's' + link.id ? '✓' : '⧉'} Krótki
								</button>
								<button
									class="btn btn-ghost"
									type="button"
									onclick={() => {
										qrLink = { id: link.id, label: link.label, slug: link.slug };
										qrTarget = 'krotki';
									}}
								>▦ QR</button>
								<button class="btn btn-ghost" type="button" onclick={() => (editing = editing === link.id ? '' : link.id)}>
									✎ Edytuj
								</button>
								{#if data.bitly.configured && !link.bitly_id && !link.archived}
									<form method="POST" action="?/shorten" use:enhance>
										<input type="hidden" name="id" value={link.id} />
										<button class="btn btn-ghost" type="submit" disabled={bitlyLeft <= 0}>
											Skróć w Bitly
										</button>
									</form>
								{/if}
								<form method="POST" action="?/archive" use:enhance>
									<input type="hidden" name="id" value={link.id} />
									<input type="hidden" name="archived" value={link.archived ? '0' : '1'} />
									<button class="btn btn-ghost" type="submit">
										{link.archived ? '↺ Przywróć' : '⌫ Archiwizuj'}
									</button>
								</form>
							</div>

							{#if editing === link.id}
								<form
									method="POST"
									action="?/update"
									use:enhance={() => async ({ update }) => {
										editing = '';
										await update({ reset: false });
									}}
									style="margin-top: var(--space-3)"
								>
									<input type="hidden" name="id" value={link.id} />
									<div class="form-field">
										<label class="form-label" for="label-{link.id}">Nazwa robocza</label>
										<input class="form-input" id="label-{link.id}" name="label" value={link.label} />
									</div>
									<div class="form-field">
										<label class="form-label" for="notes-{link.id}">Notatka</label>
										<input class="form-input" id="notes-{link.id}" name="notes" value={link.notes ?? ''} />
									</div>
									<div class="form-field">
										<label class="form-label" for="cat-{link.id}">Sekcja wysyłki</label>
										<select class="form-select" id="cat-{link.id}" name="category_id">
											<option value="">— brak —</option>
											{#each data.categories as category (category.id)}
												<option value={category.id} selected={category.id === link.category_id}>{category.name}</option>
											{/each}
										</select>
									</div>
									<div class="form-field">
										<label class="form-label" for="ext-{link.id}">Krótki link zewnętrzny (Bitly)</label>
										<input
											class="form-input mono"
											id="ext-{link.id}"
											name="short_url_external"
											value={link.short_url_external ?? ''}
											placeholder="https://bit.ly/…"
										/>
										<span class="form-hint">Wklej ręcznie, jeśli skracasz w panelu Bitly.</span>
									</div>
									<button class="btn btn-primary" type="submit">Zapisz</button>
								</form>
							{/if}
						</td>
					</tr>
				{:else}
					<tr><td colspan="5" class="faint">Brak linków. Utwórz pierwszy powyżej.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

{#if qrLink}
	<div
		class="modal-overlay"
		role="button"
		tabindex="0"
		aria-label="Zamknij podgląd kodu QR"
		onclick={() => (qrLink = null)}
		onkeydown={(e) => e.key === 'Escape' && (qrLink = null)}
	>
		<div class="modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()} onkeydown={() => {}} tabindex="-1">
			<div class="modal-header"><h3 class="modal-title">Kod QR — {qrLink.label}</h3></div>
			<div class="modal-body" style="text-align: center">
				<img src={qrSrc} alt="Kod QR" style="width: 260px; height: 260px; background: #fff; border-radius: 6px" />
				<div class="form-field" style="margin-top: var(--space-4); text-align: left">
					<span class="form-label">Dokąd prowadzi kod</span>
					<label style="display: flex; gap: 8px; align-items: center">
						<input type="radio" bind:group={qrTarget} value="krotki" />
						Przez nasz krótki link — kliknięcia liczone w HUB
					</label>
					<label style="display: flex; gap: 8px; align-items: center">
						<input type="radio" bind:group={qrTarget} value="pelny" />
						Prosto na adres z UTM — bez licznika w HUB
					</label>
				</div>
			</div>
			<div class="modal-footer" style="display: flex; gap: var(--space-2); flex-wrap: wrap">
				<a class="btn btn-ghost" href="{qrSrc}&pobierz=1" download>Pobierz SVG</a>
				<button class="btn btn-ghost" type="button" onclick={() => downloadPng(1024)}>Pobierz PNG</button>
				<button class="btn btn-primary" type="button" onclick={() => (qrLink = null)}>Zamknij</button>
			</div>
		</div>
	</div>
{/if}
