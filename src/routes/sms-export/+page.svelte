<script lang="ts">
	import type { PageServerData } from './$types';
	import { SMSAPI_HEADER } from '$lib/sms/csv';

	let { data }: { data: PageServerData } = $props();

	let bom = $state(false);

	// Link pobierania dziedziczy aktualne filtry z adresu strony.
	const downloadHref = $derived.by(() => {
		const params = new URLSearchParams(data.query);
		if (bom) params.set('bom', '1');
		else params.delete('bom');
		const q = params.toString();
		return `/sms-export/download${q ? '?' + q : ''}`;
	});
</script>

<svelte:head><title>Eksport SMS (CSV) — Aura HUB</title></svelte:head>

<h1 class="page-title">EKSPORT SMS (CSV)</h1>
<p class="page-subtitle">
	Generuje plik kontaktów w formacie importu SMSAPI (separator średnik, numery w postaci
	<span class="mono">48XXXXXXXXX</span>). Ustaw filtry, sprawdź podgląd, pobierz plik i zaimportuj
	go w panelu SMSAPI.
</p>

<form class="card" method="GET">
	<div class="form-field">
		<span class="form-label">Kategorie zapytań (puste = wszystkie)</span>
		<div class="checkbox-grid">
			{#each data.kategorie as k (k.code)}
				<label class="checkbox-tile">
					<input type="checkbox" name="kat" value={k.code} checked={data.filters.kategorie.includes(k.code)} />
					<span>{k.label}<span class="mono faint" style="display: block">{k.code}</span></span>
				</label>
			{/each}
		</div>
	</div>

	<div class="form-field" style="display: flex; gap: var(--space-5); flex-wrap: wrap">
		<label style="display: flex; gap: 8px; align-items: center; font-size: var(--text-sm)">
			<input type="checkbox" name="zgoda" value="1" checked={data.filters.tylkoZgoda} />
			Tylko ze zgodą RODO
		</label>
		<label style="display: flex; gap: 8px; align-items: center; font-size: var(--text-sm)">
			<input type="checkbox" name="komorki" value="1" checked={data.filters.tylkoKomorki} />
			Tylko numery komórkowe
		</label>
		<label style="display: flex; gap: 8px; align-items: center; font-size: var(--text-sm)">
			<input type="checkbox" name="dedup" value="1" checked={data.filters.deduplikuj} />
			Usuń powtórzone numery
		</label>
	</div>

	<div style="display: flex; gap: var(--space-2); flex-wrap: wrap">
		<button class="btn btn-primary" type="submit">Przelicz</button>
		<a class="btn btn-ghost" href="/sms-export">Wyczyść filtry</a>
	</div>
	<p class="form-hint">
		Odznaczenie pola wyłącza dany filtr (przekazywane jako <span class="mono">0</span> w adresie).
	</p>
</form>

<div class="kpi-grid" style="margin-top: var(--space-5)">
	<div class="kpi-card">
		<div class="kpi-label">Do eksportu</div>
		<div class="kpi-value" style="color: var(--color-success)">{data.stats.doEksportu}</div>
		<div class="kpi-sub">z {data.stats.kontaktow} pasujących kontaktów</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Bez zgody RODO</div>
		<div class="kpi-value">{data.stats.bezZgody}</div>
		<div class="kpi-sub">pominięte</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Brak / błędny numer</div>
		<div class="kpi-value">{data.stats.bezNumeru}</div>
		<div class="kpi-sub">nie da się znormalizować</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Stacjonarne</div>
		<div class="kpi-value">{data.stats.stacjonarne}</div>
		<div class="kpi-sub">SMS nie dojdzie</div>
	</div>
	<div class="kpi-card">
		<div class="kpi-label">Duplikaty numerów</div>
		<div class="kpi-value">{data.stats.duplikaty}</div>
		<div class="kpi-sub">pominięte</div>
	</div>
</div>

<div class="card">
	<div style="display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); flex-wrap: wrap">
		<div>
			<h3 style="margin-bottom: var(--space-2)">Pobierz plik</h3>
			<label style="display: flex; gap: 8px; align-items: center; font-size: var(--text-sm)">
				<input type="checkbox" bind:checked={bom} />
				Dodaj BOM UTF-8 (zaznacz, jeśli otwierasz plik w Excelu i widzisz krzaki zamiast „ą/ę")
			</label>
		</div>
		{#if data.stats.doEksportu > 0}
			<a class="btn btn-primary btn-lg" href={downloadHref} download>
				Pobierz CSV ({data.stats.doEksportu})
			</a>
		{:else}
			<span class="badge badge-warning">Brak kontaktów dla tych filtrów</span>
		{/if}
	</div>
</div>

<div class="table-wrap">
	<div class="table-toolbar">
		<h3>Podgląd (pierwsze {data.podglad.length} wierszy)</h3>
	</div>
	<div class="table-scroll">
		<table class="tbl">
			<thead>
				<tr>{#each SMSAPI_HEADER as h (h)}<th>{h}</th>{/each}</tr>
			</thead>
			<tbody>
				{#each data.podglad as c (c.telefon)}
					<tr>
						<td>{c.imie || '—'}</td>
						<td>{c.nazwisko || '—'}</td>
						<td class="mono">{c.telefon}</td>
						<td>{c.opis}</td>
						<td class="faint">—</td>
						<td class="faint">—</td>
						<td>{c.miasto || '—'}</td>
						<td>{c.email || '—'}</td>
						<td class="faint">—</td>
					</tr>
				{:else}
					<tr><td colspan="9" class="muted">Brak kontaktów spełniających filtry.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<div class="alert alert-warning">
	<strong>Kolumny bez danych:</strong> <span class="mono">Płeć</span>,
	<span class="mono">Data urodzenia</span> i <span class="mono">Numer buta</span> zostają puste —
	CRM ich nie zawiera. Kolumny są zachowane, żeby układ pliku zgadzał się ze wzorcem i mapowanie
	przy imporcie działało bez zmian.
	<br />
	<strong>Imię i nazwisko</strong> są rozdzielane z pola „osoba kontaktowa" (pierwszy człon = imię).
	<br />
	<strong>Zgoda na SMS:</strong> filtr RODO dotyczy zgody na przetwarzanie danych, a nie osobnej
	zgody na marketing SMS — tę kwestię warto potwierdzić przed wysyłką.
</div>
