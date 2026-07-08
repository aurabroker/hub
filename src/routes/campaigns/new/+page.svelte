<script lang="ts">
	import { enhance } from '$app/forms';
	import { CODE_LABELS } from '$lib/categories';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const segmentCodes = ['oc', 'konsultacja', 'tax', 'utrata_dochodu', 'zdrowie', 'grupowe', 'brak'] as const;
	const crmStatuses = ['lead', 'kontakt', 'oferta', 'negocjacje', 'zamkniety', 'stracony'];
	const audienceModes = [
		{ value: 'all', label: 'Wszyscy z segmentu' },
		{ value: 'new_only', label: 'Tylko nowi (bez wcześniejszej wysyłki tej sekcji)' },
		{ value: 'not_opened', label: 'Nie otworzyli poprzedniego maila tej sekcji' },
		{ value: 'retry_failed', label: 'Ponów nieudane (failed / bounced)' }
	];

	let values = $derived(form?.values ?? null);
</script>

<svelte:head><title>Nowa kampania — Aura HUB</title></svelte:head>

<h1 class="page-title">Nowa kampania</h1>
<p class="page-subtitle">
	Segment → kategoria/treść → podgląd → utworzenie szkicu. Wysyłkę uruchomisz z poziomu kampanii.
</p>

{#if form?.error}
	<div class="alert alert-error">{form.error}</div>
{/if}

{#if form?.preview}
	<div class="card" style="border-color: var(--color-primary)">
		<h3 style="margin-bottom: var(--space-3)">Podgląd odbiorców</h3>
		<div class="kpi-grid" style="margin-bottom: 0">
			<div class="kpi-card">
				<div class="kpi-label">W segmencie</div>
				<div class="kpi-value">{form.preview.total}</div>
			</div>
			<div class="kpi-card">
				<div class="kpi-label">Do wysyłki</div>
				<div class="kpi-value" style="color: var(--color-success)">{form.preview.queued}</div>
			</div>
			<div class="kpi-card">
				<div class="kpi-label">Pominięci — brak zgody RODO</div>
				<div class="kpi-value" style="color: var(--color-warning)">{form.preview.skippedNoConsent}</div>
			</div>
			<div class="kpi-card">
				<div class="kpi-label">Pominięci — zły e-mail</div>
				<div class="kpi-value">{form.preview.skippedBadEmail}</div>
			</div>
			<div class="kpi-card">
				<div class="kpi-label">Wykluczeni (tryb odbiorców)</div>
				<div class="kpi-value">{form.preview.excludedByMode}</div>
			</div>
		</div>
		{#if form.preview.queued === 0 && form.preview.skippedNoConsent > 0}
			<div class="alert alert-warning" style="margin-top: var(--space-4); margin-bottom: 0">
				Uwaga: wszyscy odbiorcy odpadają na bramce RODO (pole <span class="mono">rodo</span> w CRM
				jest puste). Uzupełnij statusy zgód w CRM przed wysyłką masową.
			</div>
		{/if}
	</div>
{/if}

<form class="card" method="POST" use:enhance>
	<h3 style="margin-bottom: var(--space-4)">1. Podstawy</h3>
	<div class="form-row">
		<div class="form-field">
			<label class="form-label" for="name">Nazwa kampanii</label>
			<input class="form-input" id="name" name="name" required value={values?.name ?? ''} />
		</div>
		<div class="form-field">
			<label class="form-label" for="category">Kategoria (sekcja / szablon)</label>
			<select class="form-select" id="category" name="category_id" required>
				<option value="">— wybierz —</option>
				{#each data.categories as c (c.id)}
					<option value={c.id} selected={values?.category_id === c.id}>{c.name} ({c.code})</option>
				{/each}
			</select>
		</div>
	</div>
	<div class="form-row">
		<div class="form-field">
			<label class="form-label" for="subject">Temat (puste = z kategorii)</label>
			<input class="form-input" id="subject" name="subject" value={values?.subject ?? ''} />
		</div>
		<div class="form-field">
			<label class="form-label" for="from_email">Nadawca (puste = z kategorii / RESEND_FROM)</label>
			<input class="form-input" id="from_email" name="from_email" value={values?.from_email ?? ''} />
		</div>
	</div>

	<h3 style="margin: var(--space-4) 0">2. Segment (crm_companies)</h3>
	<div class="form-field">
		<span class="form-label">Zainteresowanie (kod kanoniczny; puste = wszystkie)</span>
		<div class="checkbox-grid">
			{#each segmentCodes as code (code)}
				<label class="checkbox-tile">
					<input
						type="checkbox"
						name="seg_kategorie"
						value={code}
						checked={values?.seg_kategorie?.includes(code) ?? false}
					/>
					<span>{CODE_LABELS[code]} <span class="mono faint">({code})</span></span>
				</label>
			{/each}
		</div>
	</div>
	<div class="form-field">
		<span class="form-label">Status w CRM (puste = wszystkie)</span>
		<div style="display: flex; gap: var(--space-4); flex-wrap: wrap">
			{#each crmStatuses as status (status)}
				<label style="display: flex; gap: 6px; align-items: center; font-size: var(--text-sm)">
					<input
						type="checkbox"
						name="seg_statusy"
						value={status}
						checked={values?.seg_statusy?.includes(status) ?? false}
					/>
					{status}
				</label>
			{/each}
		</div>
	</div>
	<div class="form-row">
		<div class="form-field">
			<label class="form-label" for="seg_miasto">Miasto (zawiera)</label>
			<input class="form-input" id="seg_miasto" name="seg_miasto" value={values?.seg_miasto ?? ''} />
		</div>
		<div class="form-field">
			<label class="form-label" for="seg_tag">Tag (zawiera)</label>
			<input class="form-input" id="seg_tag" name="seg_tag" value={values?.seg_tag ?? ''} />
		</div>
		<div class="form-field">
			<label class="form-label" for="seg_lead_source">Źródło leada (zawiera)</label>
			<input
				class="form-input"
				id="seg_lead_source"
				name="seg_lead_source"
				value={values?.seg_lead_source ?? ''}
			/>
		</div>
	</div>

	<h3 style="margin: var(--space-4) 0">3. Odbiorcy i termin</h3>
	<div class="form-row">
		<div class="form-field">
			<label class="form-label" for="audience_mode">Tryb odbiorców</label>
			<select class="form-select" id="audience_mode" name="audience_mode">
				{#each audienceModes as mode (mode.value)}
					<option value={mode.value} selected={(values?.audience_mode ?? 'all') === mode.value}>
						{mode.label}
					</option>
				{/each}
			</select>
		</div>
		<div class="form-field">
			<label class="form-label" for="scheduled_at">Zaplanuj na (puste = start ręczny)</label>
			<input
				class="form-input"
				id="scheduled_at"
				name="scheduled_at"
				type="datetime-local"
				value={values?.scheduled_at ?? ''}
			/>
		</div>
	</div>

	<div style="display: flex; gap: var(--space-3)">
		<button class="btn btn-ghost" type="submit" formaction="?/preview">Podgląd odbiorców</button>
		<button class="btn btn-primary" type="submit" formaction="?/create">Utwórz kampanię (szkic)</button>
	</div>
</form>
