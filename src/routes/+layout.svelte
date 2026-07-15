<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import type { LayoutServerData } from './$types';

	let { data, children }: { data: LayoutServerData; children: Snippet } = $props();

	const nav = [
		{
			label: 'Generalne',
			items: [
				{ href: '/', title: 'Pulpit', icon: '▦' },
				{ href: '/duplicates', title: 'Duplikaty', icon: '⧉' }
			]
		},
		{
			label: 'Klienci',
			items: [
				{ href: '/signups', title: 'Zapisy dzienne', icon: '⋮' },
				{ href: '/clients', title: 'Baza Klientów', icon: '⌸' }
			]
		},
		{
			label: 'Wysyłka',
			items: [
				{ href: '/send', title: 'WYŚLIJ EMAIL', icon: '✉' },
				{ href: '/campaigns', title: 'Kampanie', icon: '⇶' },
				{ href: '/messages', title: 'Historia wysyłek', icon: '≣' }
			]
		},
		{
			label: 'Konfiguracja',
			items: [
				{ href: '/library', title: 'Biblioteka załączników', icon: '⎘' },
				{ href: '/categories', title: 'Kategorie', icon: '☰' }
			]
		}
	];

	function isActive(href: string): boolean {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
	}

	let theme = $state('light');
	$effect(() => {
		theme = document.documentElement.dataset.theme ?? 'light';
	});
	function toggleTheme() {
		theme = theme === 'dark' ? 'light' : 'dark';
		document.documentElement.dataset.theme = theme;
		localStorage.setItem('theme', theme);
	}
</script>

{#if data.userEmail}
	<div class="app-container">
		<aside class="sidebar">
			<a class="brand" href="/" style="margin-bottom: var(--space-1)">Aura<span>HUB</span></a>
			<div
				class="faint mono"
				style="font-size: 0.7rem; padding: 0 var(--space-2); margin-bottom: var(--space-6)"
				title="Zbudowano: {new Date(__APP_BUILT_AT__).toLocaleString('pl-PL')}"
			>
				v{__APP_VERSION__} · {__APP_COMMIT__}
			</div>
			{#each nav as section (section.label)}
				<div class="nav-section">
					<div class="nav-label">{section.label}</div>
					{#each section.items as item (item.href)}
						<a class="nav-item" class:active={isActive(item.href)} href={item.href}>
							<span aria-hidden="true">{item.icon}</span>
							{item.title}
						</a>
					{/each}
				</div>
			{/each}
		</aside>
		<div class="main-content">
			<header class="topbar">
				<div>Zalogowano jako: <strong>{data.userEmail}</strong></div>
				<div style="display: flex; gap: var(--space-2); align-items: center">
					<button
						class="btn btn-ghost"
						type="button"
						onclick={toggleTheme}
						title="Przełącz motyw jasny/ciemny"
					>
						{theme === 'dark' ? '☀️' : '🌙'}
					</button>
					<form method="POST" action="/logout">
						<button class="btn btn-ghost" type="submit">Wyloguj</button>
					</form>
				</div>
			</header>
			<main class="content-area">
				{@render children()}
			</main>
		</div>
	</div>
{:else}
	{@render children()}
{/if}
