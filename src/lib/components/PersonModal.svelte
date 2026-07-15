<script lang="ts">
	import type { CrmCompany } from '$lib/ud/types';
	import { fmtDateTime } from '$lib/ud/format';

	let { company, onclose }: { company: CrmCompany | null; onclose: () => void } = $props();

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
			return { kind: 'link', href: 'mailto:' + v, text: v };
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

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && company) onclose();
	}
</script>

<svelte:window on:keydown={onKey} />

{#if company}
	<div
		class="modal-overlay"
		role="button"
		tabindex="-1"
		aria-label="Zamknij okno"
		onclick={(e) => e.target === e.currentTarget && onclose()}
		onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onclose()}
	>
		<div class="modal">
			<div class="modal-header">
				<h2 class="modal-title">
					Karta Klienta: {company.company ?? company.contact ?? '#' + company.id}
				</h2>
				<button type="button" class="btn-icon" aria-label="Zamknij" onclick={onclose}>×</button>
			</div>
			<div class="modal-body">
				{#each SECTIONS as [title, fields] (title)}
					<div class="person-section">
						<h4>{title}</h4>
						<div class="kv-grid">
							{#each fields as [key, label] (key)}
								{@const v = fmtVal(key, company[key])}
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
							<div class="kv-value mono">#{company.id}</div>
						</div>
					</div>
				</div>
			</div>
			<div class="modal-footer">
				<button type="button" class="btn btn-ghost" onclick={onclose}>Zamknij</button>
			</div>
		</div>
	</div>
{/if}
