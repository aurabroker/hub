import { execSync } from 'node:child_process';
import { sveltekit } from '@sveltejs/kit/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import pkg from './package.json';

/** Skrót commita: na Cloudflare Pages z env builda, lokalnie z gita. */
function commitSha(): string {
	if (process.env.CF_PAGES_COMMIT_SHA) return process.env.CF_PAGES_COMMIT_SHA.slice(0, 7);
	try {
		return execSync('git rev-parse --short HEAD').toString().trim();
	} catch {
		return 'dev';
	}
}

export default defineConfig({
	// plugin-react ograniczony do plików .tsx/.jsx (wyspa React), reszta idzie przez Svelte.
	plugins: [react({ include: /\.(jsx|tsx)$/ }), sveltekit()],
	// Jedna kopia Reacta w bundlu — inaczej „Invalid hook call".
	resolve: { dedupe: ['react', 'react-dom'] },
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
		__APP_COMMIT__: JSON.stringify(commitSha()),
		__APP_BUILT_AT__: JSON.stringify(new Date().toISOString())
	}
});
