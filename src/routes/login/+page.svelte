<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	let submitting = $state(false);
</script>

<svelte:head><title>Logowanie — Aura HUB</title></svelte:head>

<div class="login-wrap">
	<form
		class="login-card"
		method="POST"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				submitting = false;
				await update();
			};
		}}
	>
		<div class="brand" style="margin-bottom: var(--space-6)">Aura<span>HUB</span></div>
		<h1 style="font-size: var(--text-lg); margin-bottom: var(--space-4)">Panel administratora</h1>

		{#if form?.error}
			<div class="alert alert-error">{form.error}</div>
		{/if}

		<div class="form-field">
			<label class="form-label" for="email">Adres e-mail</label>
			<input
				class="form-input"
				id="email"
				name="email"
				type="email"
				required
				autocomplete="username"
				value={form?.email ?? ''}
			/>
		</div>
		<div class="form-field">
			<label class="form-label" for="password">Hasło</label>
			<input
				class="form-input"
				id="password"
				name="password"
				type="password"
				required
				autocomplete="current-password"
			/>
		</div>
		<button class="btn btn-primary btn-lg" type="submit" disabled={submitting} style="width: 100%">
			{submitting ? 'Logowanie…' : 'Zaloguj się'}
		</button>
	</form>
</div>

<style>
	.login-wrap {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
	}
	.login-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-8);
		width: 100%;
		max-width: 380px;
	}
</style>
