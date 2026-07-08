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
}

export interface ResendSendResult {
	ok: boolean;
	id?: string;
	error?: string;
}

/**
 * Wysyła pojedynczy mail przez Resend API (POST /emails).
 * Przy szablonie (`template.id`) nie wolno przekazywać html/text.
 * Każdy mail marketingowy dostaje nagłówek List-Unsubscribe.
 */
export async function sendResendEmail(args: ResendSendArgs): Promise<ResendSendResult> {
	if (!env.RESEND_API_KEY) return { ok: false, error: 'Brak RESEND_API_KEY w środowisku' };

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

	let res: Response;
	try {
		res = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${env.RESEND_API_KEY}`,
				'Content-Type': 'application/json'
			},
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
		return { ok: false, error: message };
	}

	const data = (await res.json()) as { id: string };
	return { ok: true, id: data.id };
}
