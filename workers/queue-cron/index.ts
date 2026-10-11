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

/**
 * Nieudane wywołanie kończy się wyjątkiem, nie tylko wpisem w logu: wtedy
 * statystyki Workera pokazują błąd (status ≠ success). Wcześniej odpowiedź 401
 * przy złym sekrecie wyglądała w statystykach jak udane uruchomienie.
 */
async function call(env: Env, path: string): Promise<void> {
	let res: Response;
	try {
		res = await fetch(`${env.HUB_URL}${path}`, {
			method: 'POST',
			headers: { 'x-cron-secret': (env.QUEUE_CRON_SECRET ?? '').trim() }
		});
	} catch (e) {
		throw new Error(`cron ${path} → błąd sieci: ${e instanceof Error ? e.message : String(e)}`);
	}
	if (!res.ok) {
		throw new Error(`cron ${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
	}
}

export default {
	async scheduled(_event: ScheduledController, env: Env): Promise<void> {
		await call(env, '/api/cron/process-queue?limit=20');
	}
};
