/**
 * Wspólny (klient + serwer) render treści e-maila z Edytora.
 * Treść z edytora to „wnętrze" maila; tutaj owijamy je w email-safe szkielet
 * (kontener 600 px, inline style) i podstawiamy zmienne personalizacji.
 */

/** Escapowanie wartości zmiennej wstawianej w HTML (ochrona układu i przed wstrzyknięciem). */
export function escapeHtmlValue(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

/** Owinięcie treści edytora w prosty, email-safe szkielet. */
export function wrapEmailHtml(inner: string): string {
	return `<!doctype html>
<html lang="pl">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;">
          <tr>
            <td style="padding:28px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#0f172a;">
${inner || '<p style="color:#94a3b8">Treść e-maila…</p>'}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Buduje finalny HTML maila: szkielet + podstawienie zmiennych.
 * - `{{firma}}`, `{{kontakt}}`, `{{miasto}}`, `{{nip}}` (i inne z `vars`) — escapowane,
 * - `{{{pliki_html}}}` — surowy HTML listy plików (tryb „links"),
 * - `{{{UNSUBSCRIBE_URL}}}` — link wypisu.
 */
export function renderEmailHtml(
	inner: string,
	vars: Record<string, string>,
	opts: { unsubscribeUrl?: string; plikiHtml?: string } = {}
): string {
	let html = wrapEmailHtml(inner);

	for (const [key, value] of Object.entries(vars)) {
		html = html.split(`{{${key}}}`).join(escapeHtmlValue(value ?? ''));
	}

	const pliki = opts.plikiHtml ?? '';
	html = html.split('{{{pliki_html}}}').join(pliki).split('{{pliki_html}}').join(pliki);

	const unsub = escapeHtmlValue(opts.unsubscribeUrl ?? '');
	html = html.split('{{{UNSUBSCRIBE_URL}}}').join(unsub).split('{{UNSUBSCRIBE_URL}}').join(unsub);

	return html;
}
