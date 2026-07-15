<script lang="ts">
	import type { Signup, UdClient } from '$lib/ud/types';
	import { EMPLOYMENT_LABELS, fmtDateTime } from '$lib/ud/format';

	let {
		signup,
		full = null,
		onclose
	}: { signup: Signup | null; full?: UdClient | null; onclose: () => void } = $props();

	const CLIENT_FIELD_GROUPS: Array<[string, Array<[string, string]>]> = [
		[
			'Dane osobowe i kontakt',
			[
				['full_name', 'Imię i nazwisko'],
				['email', 'E-mail'],
				['phone', 'Telefon'],
				['pesel', 'PESEL'],
				['height', 'Wzrost (cm)'],
				['weight', 'Waga (kg)'],
				['weight_change', 'Zmiana wagi'],
				['handedness', 'Ręka dominująca'],
				['smoker', 'Palacz']
			]
		],
		[
			'Zatrudnienie i działalność',
			[
				['employment_type', 'Forma zatrudnienia'],
				['profession', 'Zawód'],
				['tax_form', 'Forma opodatkowania'],
				['employs_people', 'Zatrudnia pracowników'],
				['b2b_start_date', 'Początek działalności (B2B)'],
				['b2b_industry', 'Branża (B2B)'],
				['b2b_character', 'Charakter pracy (B2B)'],
				['b2b_area', 'Obszar działalności (B2B)'],
				['b2b_employees_2024', 'Pracownicy 2024'],
				['b2b_employees_2025', 'Pracownicy 2025'],
				['b2b_own_contribution', 'Wkład własny (B2B)'],
				['b2b_description', 'Opis działalności']
			]
		],
		[
			'Stan zdrowia',
			[
				['med_heart', 'Choroby serca / krążenia'],
				['med_diabetes', 'Cukrzyca'],
				['med_bones', 'Choroby kości / stawów'],
				['med_stomach', 'Układ pokarmowy'],
				['med_neuro', 'Choroby neurologiczne'],
				['med_surgery', 'Przebyte operacje'],
				['med_aids', 'HIV / AIDS'],
				['takes_meds', 'Przyjmuje leki'],
				['pending_diagnosis', 'Diagnostyka w toku'],
				['disability_congenital', 'Niepełnosprawność wrodzona'],
				['event_hospitalization', 'Hospitalizacja'],
				['event_sick_leave_30', 'Zwolnienie L4 > 30 dni'],
				['event_further_diagnosis', 'Zalecona dalsza diagnostyka'],
				['med_notes', 'Uwagi medyczne']
			]
		],
		[
			'Sporty i aktywności ryzykowne',
			[
				['risk_balloon', 'Baloniarstwo'],
				['risk_sailing', 'Żeglarstwo'],
				['risk_skiing', 'Narciarstwo / snowboard'],
				['risk_skydiving', 'Spadochroniarstwo'],
				['risk_diving', 'Nurkowanie'],
				['risk_caving', 'Speleologia'],
				['risk_aviation', 'Lotnictwo'],
				['risk_extreme_bike_boat', 'Ekstremalne rowery / łodzie'],
				['risk_climbing', 'Wspinaczka'],
				['risk_paragliding', 'Paralotniarstwo'],
				['risk_horse', 'Jazda konna'],
				['risk_horse_jumping', 'Skoki przez przeszkody (konie)'],
				['risk_gravity_bike', 'Kolarstwo grawitacyjne'],
				['risk_quad', 'Quady'],
				['risk_hunting', 'Myślistwo']
			]
		],
		[
			'Zakres ochrony i sumy',
			[
				['risk_death_invalidity', 'Ryzyko: śmierć / inwalidztwo'],
				['risk_temp_incapacity', 'Ryzyko: czasowa niezdolność'],
				['risk_perm_incapacity', 'Ryzyko: trwała niezdolność'],
				['temp_incapacity_sum', 'Suma — czasowa niezdolność'],
				['perm_incapacity_sum', 'Suma — trwała niezdolność'],
				['nw_death_sum', 'NW — śmierć'],
				['nw_funeral', 'NW — koszty pogrzebu'],
				['nw_adaptation', 'NW — koszty adaptacji'],
				['nw_hospital_daily', 'NW — świadczenie szpitalne (dzienne)'],
				['nw_medical_costs', 'NW — koszty leczenia'],
				['nw_unconscious_weekly', 'NW — świadczenie tygodniowe'],
				['nw_permanent_damage', 'NW — trwały uszczerbek']
			]
		],
		[
			'Zgody i źródło zapisu',
			[
				['informed_accepted', 'Oświadczenie o poinformowaniu'],
				['exclusions_accepted', 'Akceptacja wyłączeń'],
				['source', 'Źródło zapisu'],
				['referred_by', 'Polecenie od'],
				['affiliate_code_used', 'Użyty kod partnerski'],
				['created_at', 'Data zapisu']
			]
		]
	];

	function fmtVal(key: string, v: unknown): { html?: string; text?: string; kind: 'text' | 'yes' | 'no' | 'empty' | 'json' | 'link' } {
		if (v === null || v === undefined || v === '') return { kind: 'empty' };
		if (v === true) return { kind: 'yes' };
		if (v === false) return { kind: 'no' };
		if (key === 'created_at' && typeof v === 'string') return { kind: 'text', text: fmtDateTime(v) };
		if (key === 'employment_type' && typeof v === 'string')
			return { kind: 'text', text: EMPLOYMENT_LABELS[v] ?? v };
		if (key === 'email' && typeof v === 'string')
			return { kind: 'link', html: `mailto:${v}`, text: v };
		if (key === 'phone' && (typeof v === 'string' || typeof v === 'number'))
			return { kind: 'link', html: `tel:${String(v).replace(/\s/g, '')}`, text: String(v) };
		if (typeof v === 'object') return { kind: 'json', text: JSON.stringify(v, null, 2) };
		return { kind: 'text', text: String(v) };
	}

	let coveredKeys = $derived.by(() => {
		const set = new Set<string>(['id', 'form_data']);
		for (const [, fields] of CLIENT_FIELD_GROUPS) for (const [k] of fields) set.add(k);
		return set;
	});

	let leftovers = $derived.by(() => {
		if (!full) return [];
		return Object.keys(full).filter((k) => !coveredKeys.has(k));
	});

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && signup) onclose();
	}
</script>

<svelte:window on:keydown={onKey} />

{#if signup}
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
					{#if signup.type === 'contact'}
						Zapis (kontakt): {signup.name ?? '—'}
					{:else}
						Karta Klienta: {signup.name ?? '—'}
					{/if}
				</h2>
				<button type="button" class="btn-icon" aria-label="Zamknij" onclick={onclose}>×</button>
			</div>
			<div class="modal-body">
				{#if signup.type === 'contact'}
					<div class="person-section">
						<h4>Kto się zapisał</h4>
						<div class="kv-grid">
							<div class="kv-item">
								<div class="kv-label">Imię i nazwisko</div>
								<div class="kv-value">{signup.name ?? '—'}</div>
							</div>
							<div class="kv-item">
								<div class="kv-label">E-mail</div>
								<div class="kv-value">
									{#if signup.email}<a href="mailto:{signup.email}">{signup.email}</a>{:else}—{/if}
								</div>
							</div>
							<div class="kv-item">
								<div class="kv-label">Telefon</div>
								<div class="kv-value">
									{#if signup.phone}<a href="tel:{String(signup.phone).replace(/\s/g, '')}">{signup.phone}</a>{:else}—{/if}
								</div>
							</div>
							<div class="kv-item">
								<div class="kv-label">Data zapisu</div>
								<div class="kv-value">{fmtDateTime(signup.created_at)}</div>
							</div>
							<div class="kv-item">
								<div class="kv-label">Źródło</div>
								<div class="kv-value">Formularz kontaktowy utratadochodu.com</div>
							</div>
						</div>
					</div>
				{:else if full}
					{#each CLIENT_FIELD_GROUPS as [title, fields] (title)}
						{@const visible = fields.filter(([k]) => k in full)}
						{#if visible.length}
							<div class="person-section">
								<h4>{title}</h4>
								<div class="kv-grid">
									{#each visible as [key, label] (key)}
										{@const v = fmtVal(key, full[key])}
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
													<a href={v.html}>{v.text}</a>
												{:else if v.kind === 'json'}
													<pre class="person-json">{v.text}</pre>
												{:else}
													{v.text}
												{/if}
											</div>
										</div>
									{/each}
								</div>
							</div>
						{/if}
					{/each}

					{#if leftovers.length}
						<div class="person-section">
							<h4>Pozostałe dane</h4>
							<div class="kv-grid">
								{#each leftovers as key (key)}
									{@const v = fmtVal(key, full[key])}
									<div class="kv-item">
										<div class="kv-label">{key}</div>
										<div class="kv-value">
											{#if v.kind === 'empty'}
												<span class="faint">—</span>
											{:else if v.kind === 'yes'}
												<span style="color: var(--color-success); font-weight: 600">Tak</span>
											{:else if v.kind === 'no'}
												<span class="muted">Nie</span>
											{:else if v.kind === 'json'}
												<pre class="person-json">{v.text}</pre>
											{:else}
												{v.text}
											{/if}
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<div class="person-section">
						<h4>Dane techniczne</h4>
						<div class="kv-grid">
							<div class="kv-item">
								<div class="kv-label">ID rekordu</div>
								<div class="kv-value mono" style="font-size: 12px">{full.id}</div>
							</div>
						</div>
						{#if full.form_data}
							<details style="margin-top: var(--space-3)">
								<summary style="cursor: pointer; font-size: var(--text-sm); color: var(--color-text-muted)">
									Surowe dane formularza (JSON)
								</summary>
								<pre class="person-json" style="margin-top: var(--space-2)">{JSON.stringify(full.form_data, null, 2)}</pre>
							</details>
						{/if}
					</div>
				{/if}
			</div>
			<div class="modal-footer">
				<button type="button" class="btn btn-ghost" onclick={onclose}>Zamknij</button>
			</div>
		</div>
	</div>
{/if}
