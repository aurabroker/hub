/**
 * Worker-cron: cyklicznie odpala przetwarzanie kolejki wysyłki Aura HUB.
 * Endpoint sam pilnuje throttlingu i limitu partii.
 */
interface Env {
	HUB_URL: string;
	QUEUE_CRON_SECRET: string;
}

export default {
	async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(
			fetch(`${env.HUB_URL}/api/cron/process-queue?limit=20`, {
				method: 'POST',
				headers: { 'x-cron-secret': env.QUEUE_CRON_SECRET }
			})
		);
	}
};
