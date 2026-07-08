/**
 * Weryfikacja podpisu webhooków Resend (schemat Svix) na Web Crypto —
 * działa w Cloudflare Workers bez dodatkowych zależności.
 * https://docs.svix.com/receiving/verifying-payloads/how-manual
 */

const TOLERANCE_SECONDS = 5 * 60;

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin);
}

export async function verifySvixSignature(
	secret: string,
	payload: string,
	svixId: string | null,
	svixTimestamp: string | null,
	svixSignature: string | null
): Promise<boolean> {
	if (!secret || !svixId || !svixTimestamp || !svixSignature) return false;

	const timestamp = Number.parseInt(svixTimestamp, 10);
	if (!Number.isFinite(timestamp)) return false;
	const skew = Math.abs(Date.now() / 1000 - timestamp);
	if (skew > TOLERANCE_SECONDS) return false;

	const secretBytes = base64ToBytes(secret.startsWith('whsec_') ? secret.slice(6) : secret);
	const key = await crypto.subtle.importKey(
		'raw',
		secretBytes as BufferSource,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
	const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
	const expected = bytesToBase64(new Uint8Array(mac));

	// Nagłówek może zawierać wiele podpisów rozdzielonych spacją: "v1,BASE64 v1,BASE64"
	return svixSignature.split(' ').some((part) => {
		const [version, signature] = part.split(',');
		return version === 'v1' && signature != null && timingSafeEqual(signature, expected);
	});
}
