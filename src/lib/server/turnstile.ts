import { env } from '$env/dynamic/private';

/**
 * Weryfikacja tokenu Cloudflare Turnstile po stronie serwera.
 * Do użycia na PUBLICZNYCH endpointach (np. lead-intake) — panel Aura HUB
 * jest chroniony logowaniem i Turnstile go nie dotyczy.
 */
export async function verifyTurnstile(token: string, remoteIp?: string): Promise<boolean> {
	if (!env.TURNSTILE_SECRET_KEY) return false;
	const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
	if (remoteIp) body.set('remoteip', remoteIp);

	const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
		method: 'POST',
		body
	});
	if (!res.ok) return false;
	const data = (await res.json()) as { success: boolean };
	return data.success === true;
}
