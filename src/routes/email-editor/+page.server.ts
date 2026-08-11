import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { adminClient } from '$lib/server/supabase';
import { sendResendEmail } from '$lib/server/resend';
import { BUCKET, loadAssetsAsAttachments } from '$lib/server/sender';
import { renderEmailHtml } from '$lib/email/render';
import { EMAIL_RE } from '$lib/categories';
import type { Actions, PageServerLoad } from './$types';

const SAMPLE_VARS: Record<string, string> = {
	firma: 'Przykładowa Firma sp. z o.o.',
	kontakt: 'Jan Kowalski',
	miasto: 'Warszawa',
	nip: '1234567890'
};

const MAX_UPLOAD_BYTES = 28 * 1024 * 1024;

/** Nazwa widoczna w mailu — bez ścieżek i znaków sterujących. */
function displayFilename(name: string): string {
	const base = name.split(/[\\/]/).pop() ?? 'plik';
	return base.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 180) || 'plik';
}

/** Klucz w Storage musi być ASCII — transliteracja diakrytyków. */
function storageFilename(name: string): string {
	const ascii = displayFilename(name)
		.replace(/\u0142/g, 'l')
		.replace(/\u0141/g, 'L')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
	return ascii.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'plik';
}

export const load: PageServerLoad = async ({ locals }) => {
	const db = adminClient();
	const [catsRes, draftsRes, draftAssetsRes, assetsRes, catAssetsRes] = await Promise.all([
		db
			.from('email_categories')
			.select('id, code, name, subject, resend_template_id, html_body, attachment_mode')
			.eq('active', true)
			.order('sort_order'),
		db
			.from('email_drafts')
			.select('id, name, subject, html_body, category_id, attachment_mode, updated_at')
			.order('updated_at', { ascending: false })
			.limit(200),
		db.from('email_draft_assets').select('draft_id, asset_id'),
		db.from('email_assets').select('id, name, filename, size_bytes').order('created_at', { ascending: false }),
		db.from('email_category_assets').select('category_id, asset_id')
	]);

	const draftAssets = new Map<string, string[]>();
	for (const row of draftAssetsRes.data ?? []) {
		const id = row.draft_id as string;
		draftAssets.set(id, [...(draftAssets.get(id) ?? []), row.asset_id as string]);
	}

	const categoryAssets = new Map<string, string[]>();
	for (const row of catAssetsRes.data ?? []) {
		const id = row.category_id as string;
		categoryAssets.set(id, [...(categoryAssets.get(id) ?? []), row.asset_id as string]);
	}

	return {
		categories: (catsRes.data ?? []).map((c) => ({
			id: c.id as string,
			code: c.code as string,
			name: c.name as string,
			subject: (c.subject as string | null) ?? '',
			hasTemplate: Boolean(c.resend_template_id),
			html_body: (c.html_body as string | null) ?? '',
			attachment_mode: (c.attachment_mode as string | null) ?? 'attachments',
			assetIds: categoryAssets.get(c.id as string) ?? []
		})),
		drafts: (draftsRes.data ?? []).map((d) => ({
			id: d.id as string,
			name: d.name as string,
			subject: (d.subject as string | null) ?? '',
			html_body: (d.html_body as string | null) ?? '',
			category_id: (d.category_id as string | null) ?? '',
			attachment_mode: (d.attachment_mode as string | null) ?? '',
			updated_at: d.updated_at as string,
			assetIds: draftAssets.get(d.id as string) ?? []
		})),
		assets: (assetsRes.data ?? []).map((a) => ({
			id: a.id as string,
			name: a.name as string,
			filename: a.filename as string,
			size_bytes: (a.size_bytes as number | null) ?? 0
		})),
		testEmail: locals.user?.email ?? '',
		error: catsRes.error?.message ?? draftsRes.error?.message ?? null
	};
};

/** Nadpisuje listę załączników draftu. */
async function setDraftAssets(
	db: ReturnType<typeof adminClient>,
	draftId: string,
	assetIds: string[]
): Promise<string | null> {
	const { error: delErr } = await db.from('email_draft_assets').delete().eq('draft_id', draftId);
	if (delErr) return delErr.message;
	if (assetIds.length > 0) {
		const { error: insErr } = await db
			.from('email_draft_assets')
			.insert(assetIds.map((assetId) => ({ draft_id: draftId, asset_id: assetId })));
		if (insErr) return insErr.message;
	}
	return null;
}

export const actions: Actions = {
	/** Zapis/aktualizacja draftu (robocza wersja treści — nie rusza wysyłki). */
	draftSave: async ({ request }) => {
		const form = await request.formData();
		const draftId = String(form.get('draftId') ?? '').trim();
		const name = String(form.get('name') ?? '').trim();
		const subject = String(form.get('subject') ?? '').trim();
		const html = String(form.get('html') ?? '');
		const categoryId = String(form.get('categoryId') ?? '').trim();
		const mode = String(form.get('attachmentMode') ?? '').trim();
		const assetIds = form.getAll('assetIds').map(String).filter(Boolean);

		if (!name) return fail(400, { error: 'Podaj nazwę draftu' });

		const db = adminClient();
		const row = {
			name,
			subject: subject || null,
			html_body: html,
			category_id: categoryId || null,
			attachment_mode: mode === 'attachments' || mode === 'links' ? mode : null
		};

		let id = draftId;
		if (id) {
			const { error } = await db.from('email_drafts').update(row).eq('id', id);
			if (error) return fail(500, { error: error.message });
		} else {
			const { data, error } = await db.from('email_drafts').insert(row).select('id').single();
			if (error) return fail(500, { error: error.message });
			id = data.id as string;
		}

		const assetErr = await setDraftAssets(db, id, assetIds);
		if (assetErr) return fail(500, { error: assetErr });

		return { draftSaved: name, draftId: id };
	},

	draftDelete: async ({ request }) => {
		const form = await request.formData();
		const draftId = String(form.get('draftId') ?? '').trim();
		if (!draftId) return fail(400, { error: 'Brak identyfikatora draftu' });

		const { error } = await adminClient().from('email_drafts').delete().eq('id', draftId);
		if (error) return fail(500, { error: error.message });
		return { draftDeleted: true };
	},

	/**
	 * Zastosowanie treści do sekcji — dopiero to wpływa na realną wysyłkę.
	 * Załączniki: gdy podano, nadpisują pliki sekcji; puste = zostają pliki sekcji.
	 */
	apply: async ({ request }) => {
		const form = await request.formData();
		const categoryId = String(form.get('categoryId') ?? '').trim();
		const subject = String(form.get('subject') ?? '').trim();
		const html = String(form.get('html') ?? '');
		const mode = String(form.get('attachmentMode') ?? '').trim();
		const assetIds = form.getAll('assetIds').map(String).filter(Boolean);

		if (!categoryId) return fail(400, { error: 'Wybierz sekcję' });
		if (html.trim() && !subject) {
			return fail(400, { error: 'Ustaw temat maila — przy treści HTML jest wymagany' });
		}

		const db = adminClient();
		const update: Record<string, unknown> = { html_body: html, subject: subject || null };
		if (mode === 'attachments' || mode === 'links') update.attachment_mode = mode;

		const { error } = await db.from('email_categories').update(update).eq('id', categoryId);
		if (error) return fail(500, { error: error.message });

		if (assetIds.length > 0) {
			const { error: delErr } = await db
				.from('email_category_assets')
				.delete()
				.eq('category_id', categoryId);
			if (delErr) return fail(500, { error: delErr.message });
			const { error: insErr } = await db
				.from('email_category_assets')
				.insert(assetIds.map((assetId) => ({ category_id: categoryId, asset_id: assetId })));
			if (insErr) return fail(500, { error: insErr.message });
		}

		return { applied: true };
	},

	/** Upload pliku wprost z edytora — trafia też do Biblioteki. */
	upload: async ({ request }) => {
		const form = await request.formData();
		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'Wybierz plik do wgrania' });
		}
		if (file.size > MAX_UPLOAD_BYTES) {
			return fail(400, { error: 'Plik przekracza bezpieczny limit ~28 MB' });
		}

		const db = adminClient();
		const assetId = crypto.randomUUID();
		const filename = displayFilename(file.name);
		const storagePath = `library/${assetId}/${storageFilename(file.name)}`;

		const { error: upErr } = await db.storage
			.from(BUCKET)
			.upload(storagePath, file, { contentType: file.type || 'application/octet-stream' });
		if (upErr) return fail(500, { error: `Upload nie powiódł się: ${upErr.message}` });

		const { error: insErr } = await db.from('email_assets').insert({
			id: assetId,
			name: filename,
			storage_path: storagePath,
			filename,
			content_type: file.type || null,
			size_bytes: file.size
		});
		if (insErr) {
			await db.storage.from(BUCKET).remove([storagePath]);
			return fail(500, { error: `Zapis do biblioteki nie powiódł się: ${insErr.message}` });
		}

		return { uploaded: filename, uploadedId: assetId };
	},

	/** Wysyłka testowa bieżącej treści (przykładowe dane + wybrane załączniki). */
	test: async ({ request, url }) => {
		const form = await request.formData();
		const categoryId = String(form.get('categoryId') ?? '').trim();
		const subject = String(form.get('subject') ?? '').trim();
		const html = String(form.get('html') ?? '');
		const toEmail = String(form.get('testEmail') ?? '').trim();
		const mode = String(form.get('attachmentMode') ?? '').trim();
		const assetIds = form.getAll('assetIds').map(String).filter(Boolean);

		if (!EMAIL_RE.test(toEmail)) return fail(400, { error: 'Podaj poprawny adres do testu' });
		if (!subject) return fail(400, { error: 'Ustaw temat maila przed testem' });
		if (!html.trim()) return fail(400, { error: 'Treść jest pusta' });

		const db = adminClient();
		let fromEmail = env.RESEND_FROM ?? '';
		if (categoryId) {
			const { data: cat } = await db
				.from('email_categories')
				.select('from_email')
				.eq('id', categoryId)
				.maybeSingle();
			fromEmail = (cat?.from_email as string | null) || fromEmail;
		}
		if (!fromEmail) return fail(500, { error: 'Brak adresu nadawcy (RESEND_FROM / sekcja)' });

		// Tryb 'links' → pliki jako lista linków w treści; inaczej realne załączniki.
		let attachments: { filename: string; content: string }[] = [];
		let plikiHtml = '';
		if (assetIds.length > 0) {
			if (mode === 'links') {
				const { data: rows } = await db
					.from('email_assets')
					.select('id, filename')
					.in('id', assetIds);
				plikiHtml = `<ul style="padding-left:18px">${(rows ?? [])
					.map((r) => `<li><a href="${url.origin}/files/${r.id}">${r.filename}</a></li>`)
					.join('')}</ul>`;
			} else {
				const loaded = await loadAssetsAsAttachments(db, assetIds);
				if (loaded.error) return fail(400, { error: loaded.error });
				attachments = loaded.attachments;
			}
		}

		const rendered = renderEmailHtml(html, SAMPLE_VARS, {
			unsubscribeUrl: env.RESEND_UNSUBSCRIBE_URL,
			plikiHtml
		});
		const res = await sendResendEmail({
			from: fromEmail,
			to: toEmail,
			subject: `[TEST] ${subject}`,
			html: rendered,
			attachments
		});
		if (!res.ok) return fail(502, { error: res.error ?? 'Błąd wysyłki testowej' });

		return { tested: toEmail };
	}
};
