<script lang="ts">
	import { onMount } from 'svelte';
	import { createElement, type ComponentType } from 'react';
	import { createRoot, type Root } from 'react-dom/client';

	// Generyczna „wyspa" Reacta: montuje dowolny komponent React w Svelte.
	// Komunikacja: propsy w dół, callbacki (np. onChange) w górę.
	let {
		component,
		props = {}
	}: { component: ComponentType<any>; props?: Record<string, unknown> } = $props();

	let container: HTMLDivElement;
	let root: Root | null = null;

	onMount(() => {
		root = createRoot(container);
		root.render(createElement(component, props));
		return () => {
			root?.unmount();
			root = null;
		};
	});

	// Przerysuj Reacta, gdy propsy ze Svelte się zmienią.
	$effect(() => {
		if (root) root.render(createElement(component, props));
	});
</script>

<div bind:this={container}></div>
