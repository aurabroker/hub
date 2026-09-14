<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageServerData } from './$types';
	import { fmtDate, dayKey, todayKey } from '$lib/ud/format';
	import { normalizeInterest, CODE_LABELS, CODE_COLORS, type CanonicalCode } from '$lib/categories';

	let { data }: { data: PageServerData } = $props();

	/**
	 * Ile dni wpis liczy się jako świeży. Siedem, bo tyle realnie trwa
	 * oddzwonienie do kogoś, kto zapisał się w piątek wieczorem.
	 */
	const NOWY_PRZEZ_DNI = 7;

	const today = todayKey();
	const nowyOd = Date.now() - NOWY_PRZEZ_DNI * 864e5;

	let search = $state('');
	let tylkoDoKontaktu = $state(false);

	function kategoria(c: { ubezpieczenie: string | null }): CanonicalCode {
		return normalizeInterest(c.ubezpieczenie);
	}

	function jestNowy(created: string | null): boolean {
		return created ? Date.parse(created) >= nowyOd : false;
	}

	/** Świeży wpis z prośbą o konsultację — jedyny wiersz malowany na zielono. */
	function doKontaktu(c: { ubezpieczenie: string | null; created_at: string | null }): boolean {
		return jestNowy(c.created_at) && kategoria(c) === 'konsultacja';
	}

	const doKontaktuCount = $derived(data.clients.filter(doKontaktu).length);

	let filtered = $derived.by(() => {
		let list = data.clients;
		if (tylkoDoKontaktu) list = list.filter(doKontaktu);

		const q = search.trim().toLowerCase();
		if (!q) return list;
		return list.filter((c) =>
			[c.company, c.contact, c.email, c.phone, c.nip, CODE_LABELS[kategoria(c)]].some((v) =>
				String(v ?? '').toLowerCase().includes(q)
			)
		);
	});
</script>

<svelte:head><title>Baza Klientów — Aura HUB</title></svelte:head>

<h1 class="page-title">Baza Klientów</h1>
<p class="page-subtitle">
	Kliknij wiersz, aby otworzyć kartę Klienta. Kliknięcie w adres e-mail przenosi do szybkiej
	wysyłki. Na zielono świecą świeże zapytania o konsultację — te czekają na telefon.
</p>

{#if data.error}
	<div class="alert alert-error" style="margin-bottom: var(--space-4)">
		Nie udało się pobrać danych: {data.error}
	</div>
{/if}

<div class="table-wrap">
	<div class="table-toolbar">
		<input
			class="form-input"
			type="search"
			placeholder="Szukaj: firma, osoba, e-mail, telefon, NIP…"
			bind:value={search}
			style="width: 340px; max-width: 100%"
		/>
		<div style="display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap">
			<button
				class="chip-filter is-hot"
				type="button"
				aria-pressed={tylkoDoKontaktu}
				onclick={() => (tylkoDoKontaktu = !tylkoDoKontaktu)}
				title="Zapytania o konsultację z ostatnich {NOWY_PRZEZ_DNI} dni"
			>
				Do kontaktu · {doKontaktuCount}
			</button>
			<span class="muted" style="font-size: var(--text-xs)">
				{filtered.length} z {data.clients.length}
			</span>
		</div>
	</div>

	<div class="table-scroll tall">
		<table class="tbl">
			<!-- Szerokości wprost, inaczej przeglądarka rozdziela je wg treści
			     i kolumna z datą odpływa na drugi koniec ekranu. -->
			<colgroup>
				<col style="width: 32%" />
				<col style="width: 26%" />
				<col style="width: 18%" />
				<col style="width: 12%" />
				<col style="width: 12%" />
			</colgroup>
			<thead>
				<tr>
					<th>Klient</th>
					<th>Kontakt</th>
					<th>Zapytanie</th>
					<th>Wysyłki</th>
					<th>Zapis</th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as c (c.id)}
					{@const kod = kategoria(c)}
					{@const isToday = c.created_at ? dayKey(c.created_at) === today : false}
					{@const hot = doKontaktu(c)}
					{@const stat = data.sendStats[c.id]}
					<tr
						class="row-click"
						class:row-hot={hot}
						class:row-today={isToday && !hot}
						onclick={() => goto(`/clients/${c.id}`)}
					>
						<td>
							<span class="cell-main">{c.company ?? c.contact ?? '—'}</span>
							{#if c.company && c.contact}
								<span class="cell-sub">{c.contact}{c.title ? ' · ' + c.title : ''}</span>
							{/if}
							{#if c.nip}<span class="cell-sub mono">NIP {c.nip}</span>{/if}
						</td>
						<td>
							{#if c.email}
								<a
									href="/send?email={encodeURIComponent(c.email)}"
									onclick={(e) => e.stopPropagation()}
									title="Wyślij e-mail na ten adres"
								>{c.email}</a>
							{:else}
								<span class="faint">brak e-maila</span>
							{/if}
							{#if c.phone}<span class="cell-sub">{c.phone}</span>{/if}
						</td>
						<td>
							<span class="chip" style="--chip: {CODE_COLORS[kod]}">{CODE_LABELS[kod]}</span>
							{#if hot}
								<span class="cell-sub" style="color: var(--color-success); font-weight: 600">
									oddzwoń
								</span>
							{/if}
						</td>
						<td>
							{#if stat && stat.sent > 0}
								<span
									class="badge badge-success"
									title="Wysłanych maili: {stat.sent}{stat.opened > 0
										? `, otwartych: ${stat.opened}`
										: ''}"
								>
									{stat.sent}{stat.opened > 0 ? ` · ${stat.opened} otw.` : ''}
								</span>
								{#if stat.lastSentAt}<span class="cell-sub">{fmtDate(stat.lastSentAt)}</span>{/if}
							{:else}
								<span class="faint">—</span>
							{/if}
						</td>
						<td style="white-space: nowrap">
							{c.created_at ? fmtDate(c.created_at) : '—'}
							{#if isToday}<span class="badge badge-today" style="margin-left: 6px">dziś</span>{/if}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="5" class="muted" style="text-align: center; padding: var(--space-8)">
							{#if data.clients.length === 0}
								Baza crm_companies jest jeszcze pusta.
							{:else if tylkoDoKontaktu}
								Brak świeżych zapytań o konsultację.
							{:else}
								Brak Klientów spełniających kryteria.
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
