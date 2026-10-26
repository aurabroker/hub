import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

/**
 * Konfiguracja testów, osobno od vite.config.ts — build aplikacji jej nie widzi.
 *
 * Plugin SvelteKit daje aliasy `$lib` i kompilację komponentów. Środowisko
 * `node` kompiluje .svelte w trybie serwerowym, więc test może wyrenderować
 * stronę przez `render` z `svelte/server` bez przeglądarki i bez jsdom.
 */
export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
