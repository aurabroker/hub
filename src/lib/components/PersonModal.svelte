<script lang="ts">
	import type { CrmClient } from '$lib/ud/types';
	import { fmtDateTime, fmtDate } from '$lib/ud/format';

	let { client, onclose }: { client: CrmClient | null; onclose: () => void } = $props();

	type FmtResult =
		| { kind: 'empty' }
		| { kind: 'text'; text: string }
		| { kind: 'link'; href: string; text: string }
		| { kind: 'yes' }
		| { kind: 'no' };

	function fmtVal(key: keyof CrmClient, v: unknown): FmtResult {
		if (v === null || v === undefined || v === '') return { kind: 'empty' };
		if (v === true) return { kind: 'yes' };
		if (v === false) return { kind: 'no' };
		if (key === 'created_at') return { kind: 'text', text: fmtDateTime(String(v)) };
		if (key === 'rodo_data') return { kind: 'text', text: fmtDate(String(v)) };
		if (key === 'email' && typeof v === 'string')
			return { kind: 'link', href: 'mailto:' + v, text: v };
		if (key === 'telefon' && (typeof v === 'string' || typeof v === 'number'))
			return { kind: 'link', href: 'tel:' + String(v).replace(/\s/g, ''), text: String(v) };
		return { kind: 'text', text: String(v) };
	}

	const SECTIONS: Array<[string, Array<[keyof CrmClient, string]>]> = [
		[
			'Dane Klienta',
			[
				['nazwa', 'Nazwa'],
				['nazwa_skrocona', 'Nazwa skrócona'],
				['typ', 'Typ'],
				['ulica', 'Adres'],
				['gwarancje', 'Obsługa gwarancji']
			]
		],
		[
			'Kontakt',
			[
				['email', 'E-mail'],
				['telefon', 'Telefon']
			]
		],
		[
			'Identyfikatory',
			[
				['nip', 'NIP'],
				['regon', 'REGON'],
				['krs', 'KRS'],
				['pesel', 'PESEL']
			]
		],
		[
			'Zgoda RODO',
			[
				['rodo_zgoda', 'Zgoda RODO'],
				['rodo_kanal', 'Kanał zgody'],
				['rodo_data', 'Data zgody']
			]
		],
		[
			'Obsługa i historia',
			[
				['opiekun_id', 'Opiekun (ID)'],
				['created_at', 'Data zapisu']
			]
		],
		[
			'Powiązania (techniczne)',
			[
				['id', 'ID Klienta'],
				['tenant_id', 'Tenant ID'],
				['auth_user_id', 'Auth user ID'],
				['beauty_id', 'Beauty ID']
			]
		]
	];

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && client) onclose();
	}
</script>

<svelte:window on:keydown={onKey} />

{#if client}
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
					Karta Klienta: {client.nazwa ?? client.nazwa_skrocona ?? '—'}
				</h2>
				<button type="button" class="btn-icon" aria-label="Zamknij" onclick={onclose}>×</button>
			</div>
			<div class="modal-body">
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
										{:else if v.kind === 'yes'}
											<span style="color: var(--color-success); font-weight: 600">Tak</span>
										{:else if v.kind === 'no'}
											<span class="muted">Nie</span>
										{:else if v.kind === 'link'}
											<a href={v.href}>{v.text}</a>
										{:else}
											{v.text}
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
			<div class="modal-footer">
				<button type="button" class="btn btn-ghost" onclick={onclose}>Zamknij</button>
			</div>
		</div>
	</div>
{/if}
