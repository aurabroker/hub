/**
 * Worker-cron: cyklicznie odpala przetwarzanie kolejki wysyłki Aura HUB
 * oraz kolejkowanie automatycznej wysyłki (nowe zapisy).
 * Endpointy sam pilnują throttlingu, limitów partii i limitu dobowego.
 *
 * Dwa osobne żądania celowo: każde trafia w oddzielne wywołanie funkcji na
 * Cloudflare, więc ma własny budżet subrequestów (kolejkowanie nie przewraca wysyłki).
 */
interface Env {
	HUB_URL: string;
	QUEUE_CRON_SECRET: string;
}

async function call(env: Env, path: string): Promise<void> {
	try {
		const res = await fetch(`${env.HUB_URL}${path}`, {
			method: 'POST',
			headers: { 'x-cron-secret': env.QUEUE_CRON_SECRET }
		});
		if (!res.ok) {
			// Bez tego log jest pusty i awaria (np. 401 przy złym sekrecie) przechodzi niezauważona.
			console.error(`cron ${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
		}
	} catch (e) {
		console.error(`cron ${path} → błąd sieci: ${e instanceof Error ? e.message : String(e)}`);
	}
}

export default {
	async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(
			(async () => {
				// Najpierw dokolejkuj nowe zapisy, potem wyślij partię z kolejki.
				await call(env, '/api/cron/auto-enqueue');
				await call(env, '/api/cron/process-queue?limit=20');
			})()
		);
	}
};
