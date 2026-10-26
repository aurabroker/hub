<script lang="ts">
	import BarChart from '$lib/components/BarChart.svelte';
	import Sparkline from '$lib/components/Sparkline.svelte';
	import { formatInt } from '$lib/ads/format';
	import type { PageServerData } from './$types';

	/**
	 * Tygodniowy raport Google Ads. Komponent tylko układa gotowe teksty
	 * z `buildAdsView` — liczby, porównania i ocena świeżości są policzone
	 * po stronie serwera, w czystych funkcjach z testami.
	 *
	 * Ani jedna wartość z raportu nie idzie przez {@html}: wyszukiwane hasła
	 * wpisał dowolny użytkownik Google, więc to dane wrogie z definicji.
	 */
	let { data }: { data: PageServerData } = $props();

	const ALERT_BADGE = { error: 'badge-error', warning: 'badge-warning', info: 'badge-today' } as const;

	/** Strzałka niesie kierunek dla kogoś, kto nie rozróżnia kolorów. */
	function arrow(direction: number): string {
		return direction > 0 ? '▲' : direction < 0 ? '▼' : '';
	}
</script>

<svelte:head><title>Google Ads — Aura HUB</title></svelte:head>

<div class="head">
	<h1 class="page-title" style="margin: 0">Google Ads</h1>
	{#if data.header}
		<span class="faint" style="font-size: var(--text-xs)">
			raport tygodniowy · wygenerowano {data.header.generated}
			{#if data.header.scriptVersion}
				· <span class="mono" title="Wersja skryptu Google Ads">{data.header.scriptVersion}</span>
			{/if}
		</span>
	{/if}
</div>

{#if data.error}
	<div class="alert alert-error">{data.error}</div>
{/if}

{#if data.stale}
	<div class="alert alert-warning">
		<strong>Skrypt nie przysłał raportu — sprawdź Google Ads → Skrypty.</strong>
		Ostatni raport: tydzień do {data.stale.lastPeriod}, odebrany {data.stale.lastReceived}.
	</div>
{/if}

{#if data.empty && !data.error}
	<div class="card empty">
		<h3>Brak raportów</h3>
		<p class="muted">
			Skrypt Google Ads nie przysłał jeszcze żadnego raportu. Raporty przychodzą co poniedziałek
			około 06:00 na <span class="mono">POST /api/webhooks/ads-report</span>, z tokenem
			<span class="mono">ADS_REPORT_TOKEN</span> w nagłówku
			<span class="mono">Authorization: Bearer …</span> i z
			<span class="mono">Content-Type: application/json</span> (w UrlFetchApp:
			<span class="mono">contentType: 'application/json'</span>). Bez tego typu treści serwer
			odpowiada 403 jeszcze przed sprawdzeniem tokenu.
		</p>
	</div>
{:else if data.header}
	{#if data.missingWeek}
		<div class="alert alert-warning">
			Nie ma raportu za tydzień <span class="mono">{data.missingWeek}</span> — pokazuję najnowszy.
		</div>
	{/if}

	<div class="report-bar">
		<div>
			<div class="report-campaign">{data.header.campaign}</div>
			<div class="report-period">{data.header.period}</div>
			<div class="faint">porównanie z tygodniem {data.header.previousPeriod}</div>
		</div>
		<div class="report-actions">
			<form method="GET" action="/google-ads" class="week-form">
				<label class="sr-only" for="tydzien">Tydzień</label>
				<select class="form-select" id="tydzien" name="tydzien">
					{#each data.weeks as w (w.value)}
						<option value={w.value} selected={w.selected}>{w.label}</option>
					{/each}
				</select>
				<button class="btn btn-ghost" type="submit">Pokaż</button>
			</form>
			{#if data.downloadHref}
				<a class="btn btn-ghost" href={data.downloadHref} download>Pobierz .md</a>
			{/if}
		</div>
	</div>

	{#if data.alerts.length > 0}
		<ul class="alerts">
			{#each data.alerts as a, i (i)}
				<li class="ads-alert ads-alert-{a.kind}">
					<span class="badge {ALERT_BADGE[a.kind]}">{a.level}</span>
					<span class="alert-msg">{a.message}</span>
					<span class="alert-code mono faint">{a.code}</span>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="kpi-grid">
		{#each data.kpis as k (k.key)}
			<div class="kpi-card">
				<div class="kpi-label">{k.label}</div>
				<div class="kpi-value kpi-value-sm">{k.value}</div>
				<div class="kpi-delta change-{k.tone}" title="Zmiana tydzień do tygodnia">
					{arrow(k.direction)}
					{k.change}
				</div>
				{#if k.spark.length > 0}
					<div class="kpi-spark">
						<Sparkline data={k.spark} color={k.color} label="{k.label} — ostatnie tygodnie" />
					</div>
				{/if}
				<div class="kpi-sub">tydzień wcześniej: {k.previous}</div>
			</div>
		{/each}
	</div>

	<div class="card">
		<div class="card-head">
			<h3>Trend tygodniowy</h3>
			<span class="faint">
				zapisane tygodnie: {data.savedWeeks}
				{#if data.savedWeeks > data.trendWeeks}
					· na wykresach ostatnie {data.trendWeeks}
				{/if}
			</span>
		</div>
		{#if data.trend.length === 0}
			<p class="muted small">
				Historia dopiero się buduje — wykresy pojawią się po trzech tygodniach raportów. Każdy
				poniedziałkowy raport dokłada jeden tydzień.
			</p>
		{:else}
			<div class="trend-grid">
				{#each data.trend as s (s.key)}
					<div>
						<div class="trend-head">
							<span class="trend-title">{s.title}</span>
							<span class="faint">{s.unit}</span>
						</div>
						<BarChart
							data={s.points}
							color={s.color}
							format={formatInt}
							width={420}
							height={150}
							maxXLabels={6}
						/>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<div class="grid-2 sections">
		<div class="card">
			<div class="card-head"><h3>Ustawienia kampanii</h3></div>
			{#if data.settings.length === 0}
				<p class="muted small">Brak danych w tym raporcie.</p>
			{:else}
				<table class="tbl compact">
					<colgroup><col style="width: 48%" /><col /></colgroup>
					<tbody>
						{#each data.settings as s (s.label)}
							<tr>
								<td class="muted">{s.label}</td>
								<td>
									{#if s.badge}
										<span class="badge badge-{s.badge}">{s.value}</span>
									{:else}
										{s.value}
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>

		<div class="card">
			<div class="card-head"><h3>Konwersje</h3></div>
			{#if data.conversions.length === 0}
				<p class="muted small">Brak konwersji w tym tygodniu.</p>
			{:else}
				<table class="tbl compact">
					<colgroup><col style="width: 7.5rem" /><col /><col style="width: 6rem" /></colgroup>
					<thead><tr><th>Data</th><th>Działanie</th><th class="num">Konwersje</th></tr></thead>
					<tbody>
						{#each data.conversions as c, i (i)}
							<tr>
								<td>{c.date}</td>
								<td>{c.action}</td>
								<td class="num">{c.conversions}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
	</div>

	<div class="table-wrap">
		<div class="table-toolbar"><h3>Słowa kluczowe</h3></div>
		{#if data.keywords.length === 0}
			<p class="muted small pad">Brak danych w tym raporcie.</p>
		{:else}
			<div class="table-scroll">
				<table class="tbl">
					<colgroup>
						<col style="width: 26%" />
						<col style="width: 10%" />
						<col style="width: 9%" />
						<col style="width: 7%" />
						<col style="width: 8%" />
						<col style="width: 8%" />
						<col style="width: 11%" />
						<col style="width: 8%" />
						<col style="width: 13%" />
					</colgroup>
					<thead>
						<tr>
							<th>Słowo kluczowe</th>
							<th>Dopasowanie</th>
							<th>Status</th>
							<th class="num" title="Wynik jakości">WJ</th>
							<th class="num">Wyświetl.</th>
							<th class="num">Kliknięcia</th>
							<th class="num">Koszt</th>
							<th class="num">Konw.</th>
							<th class="num">Koszt konw.</th>
						</tr>
					</thead>
					<tbody>
						{#each data.keywords as k, i (i)}
							<tr>
								<td>
									<span class="cell-main">{k.keyword}</span>
									<span class="cell-sub">{k.adGroup}</span>
								</td>
								<td>{k.matchType}</td>
								<td><span class="badge badge-{k.statusBadge}">{k.status}</span></td>
								<td class="num">{k.qualityScore}</td>
								<td class="num">{k.impressions}</td>
								<td class="num">{k.clicks}</td>
								<td class="num">{k.cost}</td>
								<td class="num">{k.conversions}</td>
								<td class="num">{k.cpa}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	<div class="table-wrap">
		<div class="table-toolbar"><h3>Wyszukiwane hasła</h3></div>
		{#if data.searchTerms.length === 0}
			<p class="muted small pad">Brak danych w tym raporcie.</p>
		{:else}
			<div class="table-scroll">
				<table class="tbl">
					<colgroup>
						<col style="width: 46%" />
						<col style="width: 12%" />
						<col style="width: 12%" />
						<col style="width: 16%" />
						<col style="width: 14%" />
					</colgroup>
					<thead>
						<tr>
							<th>Wyszukiwane hasło</th>
							<th class="num">Wyświetl.</th>
							<th class="num">Kliknięcia</th>
							<th class="num">Koszt</th>
							<th class="num">Konw.</th>
						</tr>
					</thead>
					<tbody>
						{#each data.searchTerms as t, i (i)}
							<tr>
								<td>
									<span class="cell-main">{t.term}</span>
									<span class="cell-sub">{t.adGroup}</span>
								</td>
								<td class="num">{t.impressions}</td>
								<td class="num">{t.clicks}</td>
								<td class="num">{t.cost}</td>
								<td class="num">{t.conversions}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	<div class="table-wrap">
		<div class="table-toolbar">
			<h3>Zmiany na koncie</h3>
			<span class="faint">wyróżnione: zmiany z rekomendacji Google — do przejrzenia</span>
		</div>
		{#if data.changes.length === 0}
			<p class="muted small pad">Brak zmian w tym tygodniu.</p>
		{:else}
			<div class="table-scroll">
				<table class="tbl">
					<colgroup>
						<col style="width: 10rem" />
						<col style="width: 32%" />
						<col />
						<col style="width: 20%" />
					</colgroup>
					<thead>
						<tr><th>Kiedy</th><th>Co</th><th>Szczegóły</th><th>Źródło</th></tr>
					</thead>
					<tbody>
						{#each data.changes as c, i (i)}
							<tr class:row-reco={c.recommended}>
								<td class="nowrap">{c.when}</td>
								<td>
									<span class="cell-main">{c.object}</span>
									<span class="cell-sub">{c.resource} · {c.operation}</span>
								</td>
								<td class="details">{c.details}</td>
								<td>
									{c.source}
									{#if c.flag}
										<span class="badge badge-warning reco-badge">{c.flag}</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
{/if}

<style>
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}

	.empty h3 {
		margin-bottom: var(--space-2);
		font-size: var(--text-base);
	}
	.empty p {
		font-size: var(--text-sm);
		max-width: 68ch;
	}

	/* Nagłówek raportu: kampania i okres po lewej, wybór tygodnia po prawej. */
	.report-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
		margin-bottom: var(--space-5);
	}
	.report-campaign {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
	}
	.report-period {
		font-size: var(--text-lg);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.report-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}
	.week-form {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}
	.week-form .form-select {
		width: auto;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	/* Alerty: poziom niesie kolor paska i plakietki, ale zawsze stoi przy nim
	   słowo (KRYTYCZNE / UWAGA / INFO) — sam kolor nie wystarcza. */
	.alerts {
		list-style: none;
		display: grid;
		gap: var(--space-2);
		margin-bottom: var(--space-6);
	}
	.ads-alert {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-left: 4px solid var(--tone);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--tone) 7%, var(--color-surface));
		font-size: var(--text-sm);
	}
	.ads-alert-error {
		--tone: var(--color-error);
	}
	.ads-alert-warning {
		--tone: var(--color-warning);
	}
	.ads-alert-info {
		--tone: var(--color-accent);
	}
	.alert-msg {
		flex: 1;
	}
	.alert-code {
		white-space: nowrap;
	}

	/* Osiem metryk w dwóch rzędach — mniejsza liczba niż na pulpicie, bo przy
	   kwotach „1 234,56 zł" 2,5 rem rozpychało kolumny. */
	.kpi-value-sm {
		font-size: 1.85rem;
		white-space: nowrap;
	}
	.kpi-delta {
		margin-top: var(--space-2);
	}
	/* Kolor zmiany wynika z jej znaczenia, nie z kierunku: wzrost kosztu
	   konwersji jest zły, wzrost kliknięć dobry. Strzałka mówi kierunek. */
	.change-good {
		color: var(--color-success);
	}
	.change-bad {
		color: var(--color-error);
	}
	.change-neutral,
	.change-none {
		color: var(--color-text-muted);
	}

	.card-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
	}
	.card-head h3 {
		margin: 0;
		font-size: var(--text-base);
	}
	.card-head .faint {
		font-size: var(--text-xs);
	}
	.small {
		font-size: var(--text-sm);
	}
	.muted.small {
		margin: 0;
	}
	.pad {
		padding: var(--space-4) var(--space-5);
	}

	.trend-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: var(--space-5) var(--space-6);
	}
	.trend-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		margin-bottom: var(--space-1);
	}
	.trend-title {
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.sections {
		margin-bottom: 0;
	}
	.tbl.compact th,
	.tbl.compact td {
		padding: 0.35rem 0.5rem;
		font-size: var(--text-sm);
	}
	.nowrap {
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.details {
		overflow-wrap: anywhere;
	}
	.reco-badge {
		margin-left: var(--space-1);
	}

	/* Zmiana z rekomendacji Google: bursztyn, nie zieleń. Zieleń w tabelach
	   panelu znaczy „zadzwoń" (.row-hot, README „Zasady wyglądu"), a tu chodzi
	   o „sprawdź, co Google zmienił za Ciebie". */
	.tbl tbody tr.row-reco td {
		background: color-mix(in srgb, var(--color-warning) 9%, transparent);
	}
	.tbl tbody tr.row-reco:hover td {
		background: color-mix(in srgb, var(--color-warning) 15%, transparent);
	}
	.tbl tbody tr.row-reco td:first-child {
		box-shadow: inset 3px 0 0 var(--color-warning);
	}
</style>
