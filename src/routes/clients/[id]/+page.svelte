<script lang="ts">
	import type { PageServerData } from './$types';
	import type { CrmCompany } from '$lib/ud/types';
	import { fmtDateTime } from '$lib/ud/format';
	import { normalizeInterest, CODE_LABELS, hasRodoConsent } from '$lib/categories';

	let { data }: { data: PageServerData } = $props();
	const client = $derived(data.client);
	const emails = $derived(data.emails);

	const category = $derived(CODE_LABELS[normalizeInterest(client.ubezpieczenie)]);
	const rodoOk = $derived(hasRodoConsent(client.rodo));

	const sentCount = $derived(emails.filter((e) => e.sent_at).length);

	const statusBadge: Record<string, string> = {
		queued: 'badge-warning',
		sending: 'badge-primary',
		sent: 'badge-success',
		failed: 'badge-error',
		bounced: 'badge-error',
		skipped: 'badge-muted'
	};

	const statusLabel: Record<string, string> = {
		queued: 'w kolejce',
		sending: 'wysyłanie',
		sent: 'wysłano',
		failed: 'błąd',
		bounced: 'odbicie',
		skipped: 'pominięto'
	};

	const SECTIONS: Array<[string, Array<[keyof CrmCompany, string]>]> = [
		[
			'Firma',
			[
				['company', 'Nazwa firmy'],
				['nip', 'NIP'],
				['regon', 'REGON'],
				['industry', 'Branża'],
				['url', 'Strona www'],
				['revenue', 'Przychód (roczny)'],
				['employees', 'Liczba pracowników']
			]
		],
		[
			'Osoba kontaktowa',
			[
				['contact', 'Imię i nazwisko'],
				['title', 'Stanowisko'],
				['email', 'E-mail'],
				['phone', 'Telefon']
			]
		],
		[
			'Lokalizacja',
			[
				['city', 'Miasto'],
				['state', 'Województwo']
			]
		],
		[
			'Sprzedaż i obsługa',
			[
				['status', 'Status'],
				['assigned_to', 'Opiekun (imię/nazwisko)'],
				['assigned_user_id', 'Opiekun (ID)']
			]
		],
		[
			'Uwagi i historia',
			[
				['notes', 'Notatki'],
				['created_at', 'Data zapisu'],
				['updated_at', 'Ostatnia modyfikacja']
			]
		]
	];

	type FmtResult =
		| { kind: 'empty' }
		| { kind: 'text'; text: string }
		| { kind: 'link'; href: string; text: string }
		| { kind: 'multiline'; text: string };

	function fmtVal(key: keyof CrmCompany, v: unknown): FmtResult {
		if (v === null || v === undefined || v === '') return { kind: 'empty' };
		if (key === 'created_at' || key === 'updated_at')
			return { kind: 'text', text: fmtDateTime(String(v)) };
		if (key === 'email' && typeof v === 'string')
			return { kind: 'link', href: '/send?email=' + encodeURIComponent(v), text: v };
		if (key === 'phone' && (typeof v === 'string' || typeof v === 'number'))
			return { kind: 'link', href: 'tel:' + String(v).replace(/\s/g, ''), text: String(v) };
		if (key === 'url' && typeof v === 'string') {
			const href = v.startsWith('http') ? v : 'https://' + v;
			return { kind: 'link', href, text: v };
		}
		if (key === 'revenue' && typeof v === 'number')
			return { kind: 'text', text: v.toLocaleString('pl-PL') + ' PLN' };
		if (key === 'notes' && typeof v === 'string') return { kind: 'multiline', text: v };
		return { kind: 'text', text: String(v) };
	}
</script>

<svelte:head><title>Karta Klienta — Aura HUB</title></svelte:head>

<div style="display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap">
	<div>
		<a href="/clients" class="faint" style="text-decoration: none">← Baza Klientów</a>
		<h1 class="page-title" style="margin-top: var(--space-2)">
			Karta Klienta: {client.company ?? client.contact ?? '#' + client.id}
		</h1>
		<p class="page-subtitle" style="margin-bottom: 0">
			Kategoria zapytania:
			<span class="badge badge-primary" style="margin-left: 4px">{category}</span>
			<span style="margin-left: var(--space-3)">
				RODO:
				{#if rodoOk}
					<span class="badge badge-success">zgoda</span>
				{:else}
					<span class="badge badge-warning">brak zgody</span>
				{/if}
			</span>
		</p>
	</div>
	<div style="display: flex; gap: var(--space-2)">
		{#if client.email}
			<a class="btn btn-primary" href="/send?email={encodeURIComponent(client.email)}">Wyślij e-mail</a>
		{/if}
		<a class="btn btn-ghost" href="/clients">Wróć do listy</a>
	</div>
</div>

<div class="card" style="margin-top: var(--space-5)">
	<h4 style="margin: 0 0 var(--space-3)">
		Historia wysyłek e-mail
		{#if sentCount > 0}
			<span class="badge badge-success" style="margin-left: 6px">{sentCount} wysłano</span>
		{/if}
	</h4>

	{#if data.emailsError}
		<div class="alert alert-error">Nie udało się pobrać historii wysyłek: {data.emailsError}</div>
	{:else if emails.length === 0}
		<p class="muted" style="margin: 0">
			Do tego Klienta nie wysłano jeszcze żadnego maila z Aura HUB.
		</p>
	{:else}
		<div class="table-scroll">
			<table class="tbl">
				<thead>
					<tr>
						<th>Data</th>
						<th>Sekcja</th>
						<th>Źródło</th>
						<th>Status</th>
						<th>Wysłano</th>
						<th>Otwarto</th>
						<th>Kliknięto</th>
						<th>Uwagi</th>
					</tr>
				</thead>
				<tbody>
					{#each emails as m (m.id)}
						<tr>
							<td class="muted" style="white-space: nowrap">{fmtDateTime(m.created_at)}</td>
							<td>{m.email_categories?.name ?? '—'}</td>
							<td>
								{#if m.source === 'quick_send'}
									<span class="badge badge-primary">1-do-1</span>
								{:else if m.email_campaigns}
									<a href="/campaigns/{m.email_campaigns.id}">{m.email_campaigns.name}</a>
								{:else}
									<span class="badge badge-muted">kampania</span>
								{/if}
							</td>
							<td>
								<span class="badge {statusBadge[m.status] ?? 'badge-muted'}">
									{statusLabel[m.status] ?? m.status}
								</span>
							</td>
							<td class="muted" style="white-space: nowrap">{m.sent_at ? fmtDateTime(m.sent_at) : '—'}</td>
							<td class="muted" style="white-space: nowrap">{m.opened_at ? fmtDateTime(m.opened_at) : '—'}</td>
							<td class="muted" style="white-space: nowrap">{m.clicked_at ? fmtDateTime(m.clicked_at) : '—'}</td>
							<td style="max-width: 240px">
								{#if m.error}
									<span style="color: var(--color-error)">{m.error}</span>
								{:else if m.resend_id}
									<span class="mono faint">{m.resend_id}</span>
								{:else}
									<span class="faint">—</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<div class="card" style="margin-top: var(--space-5)">
	<div class="person-section">
		<h4>Zapytanie / kategoria</h4>
		<div class="kv-grid">
			<div class="kv-item">
				<div class="kv-label">Kategoria (kanoniczna)</div>
				<div class="kv-value"><span class="badge badge-primary">{category}</span></div>
			</div>
			<div class="kv-item">
				<div class="kv-label">Zapytanie (surowe)</div>
				<div class="kv-value">
					{#if client.ubezpieczenie}{client.ubezpieczenie}{:else}<span class="faint">—</span>{/if}
				</div>
			</div>
			<div class="kv-item">
				<div class="kv-label">Zgoda RODO</div>
				<div class="kv-value">
					{#if rodoOk}
						<span style="color: var(--color-success); font-weight: 600">Tak</span>
					{:else}
						<span class="muted">Nie / brak</span>
					{/if}
				</div>
			</div>
		</div>
	</div>

	{#each SECTIONS as [title, fields] (title)}
		<div class="person-section">
			<h4>{title}</h4>
			<div class="kv-grid">
				{#each fields as [key, label] (key)}
					{@const v = fmtVal(key, client[key])}
					<div class="kv-item">
						<div class="kv-label">{label}</div>
						<div class="kv-value">
							{#if v.kind === 'empty'}
								<span class="faint">—</span>
							{:else if v.kind === 'link'}
								<a href={v.href}>{v.text}</a>
							{:else if v.kind === 'multiline'}
								<div style="white-space: pre-wrap">{v.text}</div>
							{:else}
								{v.text}
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/each}

	<div class="person-section">
		<h4>Dane techniczne</h4>
		<div class="kv-grid">
			<div class="kv-item">
				<div class="kv-label">ID rekordu</div>
				<div class="kv-value mono">#{client.id}</div>
			</div>
		</div>
	</div>
</div>
