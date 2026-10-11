import { env } from '$env/dynamic/private';

export interface ResendAttachment {
	filename: string;
	/** Zawartość pliku zakodowana Base64. */
	content: string;
}

export interface ResendSendArgs {
	from: string;
	to: string;
	subject?: string;
	/** Id lub alias opublikowanego szablonu Resend. */
	templateId?: string | null;
	variables?: Record<string, string>;
	html?: string;
	attachments?: ResendAttachment[];
	/**
	 * Klucz idempotencji (nagłówek `Idempotency-Key`, ważny w Resend 24 h).
	 * Ponowienie z tym samym kluczem i tą samą treścią zwraca pierwotną
	 * odpowiedź zamiast wysyłać drugiego maila.
	 */
	idempotencyKey?: string;
}

export interface ResendSendResult {
	ok: boolean;
	id?: string;
	error?: string;
	/** 429: Resend nic nie wysłał, bo przekroczono limit zapytań — to nie wina wiadomości. */
	rateLimited?: boolean;
}

/**
 * Wysyła pojedynczy mail przez Resend API (POST /emails).
 * Przy szablonie (`template.id`) nie wolno przekazywać html/text.
 * Każdy mail marketingowy dostaje nagłówek List-Unsubscribe.
 */
export async function sendResendEmail(args: ResendSendArgs): Promise<ResendSendResult> {
	if (!env.RESEND_API_KEY) {
		return { ok: false, error: 'Brak RESEND_API_KEY w środowisku' };
	}

	const headers: Record<string, string> = {};
	if (env.RESEND_UNSUBSCRIBE_URL) {
		headers['List-Unsubscribe'] = `<${env.RESEND_UNSUBSCRIBE_URL}>`;
		headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
	}

	const body: Record<string, unknown> = {
		from: args.from,
		to: [args.to]
	};
	if (args.subject) body.subject = args.subject;
	if (Object.keys(headers).length > 0) body.headers = headers;
	if (args.attachments && args.attachments.length > 0) body.attachments = args.attachments;

	if (args.templateId) {
		body.template = { id: args.templateId, variables: args.variables ?? {} };
	} else if (args.html) {
		body.html = args.html;
	} else {
		return { ok: false, error: 'Kategoria nie ma szablonu Resend ani treści HTML' };
	}

	const requestHeaders: Record<string, string> = {
		Authorization: `Bearer ${env.RESEND_API_KEY}`,
		'Content-Type': 'application/json'
	};
	if (args.idempotencyKey) requestHeaders['Idempotency-Key'] = args.idempotencyKey;

	let res: Response;
	try {
		res = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: requestHeaders,
			body: JSON.stringify(body)
		});
	} catch (e) {
		return { ok: false, error: `Błąd sieci: ${e instanceof Error ? e.message : String(e)}` };
	}

	if (!res.ok) {
		let message = `Resend HTTP ${res.status}`;
		try {
			const err = (await res.json()) as { message?: string; name?: string };
			if (err.message) message = `${message}: ${err.message}`;
		} catch {
			// treść błędu nie była JSON-em
		}
		return { ok: false, error: message, rateLimited: res.status === 429 };
	}

	const data = (await res.json()) as { id: string };
	return { ok: true, id: data.id };
}

export interface ResendTemplateInfo {
	/** Nadawca zapisany w szablonie (null = szablon go nie ma). */
	from: string | null;
	/** Szablon nadal linkuje wypis przez zmienną, którą Resend wypełnia tylko w Broadcasts. */
	deadUnsubscribeLink: boolean;
}

/** Pamięć szablonów w obrębie izolatu — szablon zmienia się rzadko. */
const templateCache = new Map<string, { info: ResendTemplateInfo; expires: number }>();
const TEMPLATE_CACHE_MS = 5 * 60_000;

/**
 * Odczyt szablonu Resend (GET /templates/:id). Przy błędzie API zwraca ostatnią
 * znaną wersję, nawet przeterminowaną; bez niej — `ok: false`. Wywołujący NIE
 * może wtedy po cichu wysłać z RESEND_FROM, bo to dokładnie ten błąd, w którym
 * newsletter jednej marki wychodził z adresu innej.
 */
export async function getResendTemplate(
	templateId: string
): Promise<{ ok: true; info: ResendTemplateInfo } | { ok: false; error: string; rateLimited?: boolean }> {
	if (!env.RESEND_API_KEY) return { ok: false, error: 'Brak RESEND_API_KEY w środowisku' };
	const cached = templateCache.get(templateId);
	if (cached && cached.expires > Date.now()) return { ok: true, info: cached.info };

	let failure: { error: string; rateLimited?: boolean };
	try {
		const res = await fetch(`https://api.resend.com/templates/${encodeURIComponent(templateId)}`, {
			headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` }
		});
		if (res.ok) {
			const data = (await res.json()) as { from?: string | null; html?: string | null };
			const html = data.html ?? '';
			const info: ResendTemplateInfo = {
				from: typeof data.from === 'string' && data.from.trim() ? data.from.trim() : null,
				// Każde wystąpienie się liczy — obok działającego {{{link_wypisu}}} może stać
				// drugi, pusty link („Zarządzaj subskrypcją”).
				deadUnsubscribeLink: /RESEND_UNSUBSCRIBE_URL|\{\{\{?\s*UNSUBSCRIBE_URL/.test(html)
			};
			templateCache.set(templateId, { info, expires: Date.now() + TEMPLATE_CACHE_MS });
			return { ok: true, info };
		}
		failure = {
			error: `Odczyt szablonu Resend ${templateId}: HTTP ${res.status}`,
			rateLimited: res.status === 429
		};
	} catch (e) {
		failure = {
			error: `Odczyt szablonu Resend ${templateId}: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	if (cached) return { ok: true, info: cached.info };
	console.error(failure.error);
	return { ok: false, ...failure };
}

/**
 * Pobiera stan pojedynczego maila (GET /emails/:id).
 * Resend zwraca wyłącznie `last_event` — ostatnie zdarzenie, bez znaczników czasu
 * poszczególnych zdarzeń. Służy do uzupełniania statystyk sprzed subskrypcji webhooka.
 */
export async function getResendEmail(
	id: string
): Promise<{ ok: boolean; lastEvent?: string; error?: string; rateLimited?: boolean }> {
	if (!env.RESEND_API_KEY) return { ok: false, error: 'Brak RESEND_API_KEY w środowisku' };

	let res: Response;
	try {
		res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}`, {
			headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` }
		});
	} catch (e) {
		return { ok: false, error: `Błąd sieci: ${e instanceof Error ? e.message : String(e)}` };
	}

	if (res.status === 429) return { ok: false, rateLimited: true, error: 'Limit zapytań Resend' };
	if (!res.ok) return { ok: false, error: `Resend HTTP ${res.status}` };

	const data = (await res.json()) as { last_event?: string };
	return { ok: true, lastEvent: data.last_event };
}
