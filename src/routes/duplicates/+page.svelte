<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();
</script>

<svelte:head><title>Duplikaty — Aura HUB</title></svelte:head>

<h1 class="page-title">Duplikaty</h1>
<p class="page-subtitle">
	Weryfikacja zdublowanych rekordów: najpierw po adresie e-mail (po normalizacji), wtórnie po NIP.
	Rekordy można oznaczyć tagiem „duplikat” — nic nie jest usuwane automatycznie.
</p>

{#if form?.error}
	<div class="alert alert-error">{form.error}</div>
{/if}
{#if form?.success}
	<div class="alert alert-success">{form.success}</div>
{/if}

{#snippet groupTable(
	title: string,
	rows: { key: string; ile: number; ids: number[]; firmy: string[] }[]
)}
	<div class="table-wrap">
		<div class="table-toolbar"><h3>{title} ({rows.length} grup)</h3></div>
		<div class="table-scroll">
			<table class="tbl">
				<thead>
					<tr>
						<th>Wartość</th>
						<th class="num">Ile</th>
						<th>Rekordy (pierwszy = najstarszy, proponowany główny)</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as group (group.key)}
						<tr>
							<td class="mono">{group.key}</td>
							<td class="num">{group.ile}</td>
							<td>
								<div style="display: flex; flex-direction: column; gap: 6px">
									{#each group.ids as id, i (id)}
										<div style="display: flex; align-items: center; gap: 8px">
											<span class="mono">#{id}</span>
											<span>{group.firmy[i] ?? ''}</span>
											{#if i === 0}
												<span class="badge badge-primary">główny</span>
											{:else}
												<form method="POST" action="?/mark" use:enhance>
													<input type="hidden" name="id" value={id} />
													<input type="hidden" name="keep_id" value={group.ids[0]} />
													<button class="btn btn-ghost" style="padding: 2px 10px" type="submit">
														Oznacz jako duplikat
													</button>
												</form>
											{/if}
										</div>
									{/each}
								</div>
							</td>
						</tr>
					{:else}
						<tr><td colspan="3" class="muted">Brak duplikatów 🎉</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/snippet}

{@render groupTable(
	'Duplikaty wg e-mail',
	data.byEmail.map((g) => ({ key: g.email, ile: g.ile, ids: g.ids, firmy: g.firmy }))
)}
{@render groupTable(
	'Duplikaty wg NIP',
	data.byNip.map((g) => ({ key: g.nip, ile: g.ile, ids: g.ids, firmy: g.firmy }))
)}
