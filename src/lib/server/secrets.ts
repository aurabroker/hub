/** Porównanie odporne na pomiar czasu — sekret nie może wyciec bajt po bajcie. */
export function secretMatches(provided: string | null | undefined, expected: string): boolean {
	if (!provided || provided.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < expected.length; i++) {
		diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
	}
	return diff === 0;
}

/** Sekret crona z nagłówka `x-cron-secret` albo `Authorization: Bearer …`. */
export function cronSecretFrom(request: Request): string | null {
	return (
		request.headers.get('x-cron-secret') ??
		request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
		null
	);
}
