/**
 * Worker-cron: co minutę odpala przetwarzanie kolejki wysyłki Aura HUB.
 * Endpoint sam pilnuje throttlingu, limitów partii i limitu dobowego, a przy
 * okazji kolejkuje automat (nowe zapisy) i startuje zaplanowane kampanie.
 *
 * Wcześniej Worker wołał też osobno /api/cron/auto-enqueue. processQueue i tak
 * uruchamia automat, więc CRM był czytany dwa razy na przebieg — przy planie
 * Free Supabase (5 GB transferu) to realny koszt. Endpoint zostaje do ręcznego użycia.
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
		ctx.waitUntil(call(env, '/api/cron/process-queue?limit=20'));
	}
};
