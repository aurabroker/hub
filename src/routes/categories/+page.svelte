<script lang="ts">
	import { enhance } from '$app/forms';
	import { fmtDateTime } from '$lib/ud/format';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();
</script>

<svelte:head><title>Kategorie — Aura HUB</title></svelte:head>

<h1 class="page-title">Kategorie wysyłki</h1>
<p class="page-subtitle">
	Sekcje = „co wysyłamy”. Każda kategoria ma szablon Resend, temat, nadawcę i domyślne pliki
	(przypinane w bibliotece) — wysyłane jako załączniki albo linki do pobrania. W szablonie Resend
	użyj wbudowanej zmiennej <span class="mono">{'{{{UNSUBSCRIBE_URL}}}'}</span> jako linku wypisu,
	zmiennych <span class="mono">{'{{firma}}'}</span>, <span class="mono">{'{{kontakt}}'}</span>,
	<span class="mono">{'{{miasto}}'}</span>, <span class="mono">{'{{nip}}'}</span>, a w trybie
	linków wstaw <span class="mono">{'{{{pliki_html}}}'}</span> tam, gdzie ma się pojawić lista
	plików. Gotowa stopka do wklejenia: <span class="mono">docs/email-footer.html</span> w repo.
</p>

{#if form?.error}
	<div class="alert alert-error">{form.error}</div>
{/if}
{#if form?.success}
	<div class="alert alert-success">{form.success}</div>
{/if}

<form class="card" method="POST" action="?/create" use:enhance style="border-style: dashed">
	<h3 style="margin-bottom: var(--space-3)">➕ Nowy typ maila (kategoria)</h3>
	<p class="form-hint" style="margin-bottom: var(--space-4)">
		Napisz i opublikuj szablon w Resend, a tutaj utwórz kategorię z jego ID — pojawi się w
		szybkiej wysyłce i kampaniach. Załączniki przypniesz w bibliotece.
	</p>
	<div class="form-row">
		<div class="form-field">
			<label class="form-label" for="new-name">Nazwa (etykieta w UI)</label>
			<input class="form-input" id="new-name" name="name" required placeholder="np. Oferta wakacyjna" />
		</div>
		<div class="form-field">
			<label class="form-label" for="new-code">Kod (małe litery, bez spacji)</label>
			<input class="form-input mono" id="new-code" name="code" required placeholder="np. oferta_wakacyjna" />
		</div>
		<div class="form-field">
			<label class="form-label" for="new-tpl">Szablon Resend (id lub alias)</label>
			<input class="form-input mono" id="new-tpl" name="resend_template_id" placeholder="UUID szablonu" />
		</div>
	</div>
	<div class="form-row">
		<div class="form-field">
			<label class="form-label" for="new-subject">Temat maila</label>
			<input class="form-input" id="new-subject" name="subject" />
		</div>
		<div class="form-field">
			<label class="form-label" for="new-mode">Pliki w mailu</label>
			<select class="form-select" id="new-mode" name="attachment_mode">
				<option value="attachments">Załączniki (pliki w mailu)</option>
				<option value="links">Linki do pobrania (lekki mail)</option>
			</select>
		</div>
		<div class="form-field" style="max-width: 120px">
			<label class="form-label" for="new-sort">Kolejność</label>
			<input class="form-input" id="new-sort" name="sort_order" type="number" value="100" />
		</div>
	</div>
	<button class="btn btn-primary" type="submit">Utwórz kategorię</button>
</form>

{#each data.categories as category (category.id)}
	<form
		class="card"
		method="POST"
		action="?/update"
		use:enhance={() => {
			// bez resetu: po zapisie formularz ma pokazywać stan zapisany w bazie,
			// a nie wartości sprzed edycji (domyślny reset udawał odrzucony zapis)
			return async ({ update }) => {
				await update({ reset: false });
			};
		}}
	>
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
			<div class="form-field">
				<label class="form-label" for="mode-{category.id}">Pliki w mailu</label>
				<select class="form-select" id="mode-{category.id}" name="attachment_mode">
					<option value="attachments" selected={category.attachment_mode !== 'links'}>
						Załączniki (pliki w mailu)
					</option>
					<option value="links" selected={category.attachment_mode === 'links'}>
						Linki do pobrania (lekki mail — wymaga {'{{{pliki_html}}}'} w szablonie)
					</option>
				</select>
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

	<!-- Automat: osobny formularz (formularzy nie można zagnieżdżać) -->
	<div class="card" style="margin-top: calc(-1 * var(--space-4)); border-top: none">
		<div style="display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); flex-wrap: wrap">
			<div>
				<strong style="font-size: var(--text-sm)">Automatyczna wysyłka</strong>
				{#if category.auto_send}
					<span class="badge badge-success" style="margin-left: 6px">WŁĄCZONA</span>
				{:else}
					<span class="badge badge-muted" style="margin-left: 6px">wyłączona</span>
				{/if}
				<div class="faint" style="margin-top: 4px">
					{#if category.auto_send}
						Nowe zapisy w tej sekcji dostają maila automatycznie (cron).
						{#if category.auto_send_since}
							Obejmuje zapisy od {fmtDateTime(category.auto_send_since)} — starsza baza jest pominięta.
						{/if}
					{:else}
						Po włączeniu automat obejmie <strong>tylko zapisy od tego momentu</strong> —
						istniejąca baza nie dostanie maila.
					{/if}
				</div>
			</div>
			<form
				method="POST"
				action="?/autoSend"
				use:enhance
				style="display: flex; gap: var(--space-2); align-items: flex-end; flex-wrap: wrap"
				onsubmit={(e) => {
					// ISO liczone lokalnie w przeglądarce — serwer (UTC) nie przesunie godziny.
					const f = e.currentTarget as HTMLFormElement;
					const d = (f.elements.namedItem('startDate') as HTMLInputElement | null)?.value;
					const iso = f.elements.namedItem('sinceIso') as HTMLInputElement;
					if (iso) iso.value = d ? new Date(d + 'T00:00:00').toISOString() : '';
				}}
			>
				<input type="hidden" name="id" value={category.id} />
				<input type="hidden" name="enable" value={category.auto_send ? '0' : '1'} />
				<input type="hidden" name="sinceIso" value="" />
				{#if !category.auto_send}
					<div class="form-field" style="margin: 0">
						<label class="form-label" for="start-{category.id}">Start (puste = od teraz)</label>
						<input class="form-input" id="start-{category.id}" name="startDate" type="date" />
					</div>
				{/if}
				<button class={category.auto_send ? 'btn btn-danger' : 'btn btn-primary'} type="submit">
					{category.auto_send ? 'Wyłącz automat' : 'Włącz automat'}
				</button>
			</form>
		</div>
	</div>
{/each}
