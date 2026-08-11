<script lang="ts">
	import ReactIsland from '$lib/react/ReactIsland.svelte';
	import EmailEditor from '$lib/react/EmailEditor';

	let bodyHtml = $state('');
	let copied = $state(false);

	function onChange(html: string) {
		bodyHtml = html;
	}

	// Owinięcie treści w prosty, email-safe szkielet (kontener 600px, inline style).
	function wrapEmailHtml(inner: string): string {
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

	const fullHtml = $derived(wrapEmailHtml(bodyHtml));

	async function copyHtml() {
		try {
			await navigator.clipboard.writeText(fullHtml);
			copied = true;
			setTimeout(() => (copied = false), 1800);
		} catch {
			copied = false;
		}
	}

	function downloadHtml() {
		const blob = new Blob([fullHtml], { type: 'text/html' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'email.html';
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<svelte:head><title>Edytor e-mail — Aura HUB</title></svelte:head>

<h1 class="page-title">EDYTOR E-MAIL</h1>
<p class="page-subtitle">
	Wizualny edytor treści e-maila (wyspa React). Wstaw zmienne personalizacji, sformatuj treść,
	skopiuj gotowy HTML do szablonu Resend albo pobierz plik. Podgląd po prawej pokazuje maila
	w docelowym szkielecie (600&nbsp;px).
</p>

<div class="grid-2">
	<div class="card">
		<h3 style="margin-bottom: var(--space-3)">Edytor</h3>
		<ReactIsland component={EmailEditor} props={{ initialHtml: bodyHtml, onChange }} />

		<div style="display: flex; gap: var(--space-2); margin-top: var(--space-4); flex-wrap: wrap">
			<button class="btn btn-primary" type="button" onclick={copyHtml}>
				{copied ? 'Skopiowano ✓' : 'Kopiuj HTML'}
			</button>
			<button class="btn btn-ghost" type="button" onclick={downloadHtml}>Pobierz .html</button>
		</div>
	</div>

	<div class="card">
		<h3 style="margin-bottom: var(--space-3)">Podgląd</h3>
		<iframe
			title="Podgląd e-maila"
			srcdoc={fullHtml}
			style="width: 100%; height: 460px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: #fff"
		></iframe>
	</div>
</div>

<div class="alert alert-warning" style="margin-top: var(--space-5)">
	<strong>Jak użyć:</strong> skopiuj HTML i wklej jako treść szablonu w Resend, a jego id/alias wpisz
	w <a href="/categories">Kategoriach</a>. Personalizacja: <span class="mono">{'{{firma}}'}</span>,
	<span class="mono">{'{{kontakt}}'}</span>, <span class="mono">{'{{miasto}}'}</span>,
	<span class="mono">{'{{nip}}'}</span>, wypis: <span class="mono">{'{{{UNSUBSCRIBE_URL}}}'}</span>.
	<br />
	Kolejny krok (osobno): zapis treści w bazie i wysyłka bezpośrednio z HUB przez
	<span class="mono">html</span> — <span class="mono">sendResendEmail</span> już to obsługuje.
</div>
