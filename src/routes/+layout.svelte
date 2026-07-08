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
			label: 'Wysyłka',
			items: [
				{ href: '/send', title: 'WYŚLIJ EMAIL', icon: '✉' },
				{ href: '/campaigns', title: 'Kampanie', icon: '⇶' }
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
</script>

{#if data.userEmail}
	<div class="app-container">
		<aside class="sidebar">
			<a class="brand" href="/">Aura<span>HUB</span></a>
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
				<form method="POST" action="/logout">
					<button class="btn btn-ghost" type="submit">Wyloguj</button>
				</form>
			</header>
			<main class="content-area">
				{@render children()}
			</main>
		</div>
	</div>
{:else}
	{@render children()}
{/if}
