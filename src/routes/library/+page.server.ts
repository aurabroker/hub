import { fail } from '@sveltejs/kit';
import { BUCKET } from '$lib/server/sender';
import { adminClient } from '$lib/server/supabase';
import type { Actions, PageServerLoad } from './$types';

/** Nazwa widoczna w mailu — może zawierać polskie znaki; tylko bez ścieżek i znaków sterujących. */
function displayFilename(name: string): string {
	const base = name.split(/[\\/]/).pop() ?? 'plik';
	return base.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 180) || 'plik';
}

/** Klucz w Supabase Storage musi być ASCII — transliteracja diakrytyków + twarde czyszczenie. */
function storageFilename(name: string): string {
	const ascii = displayFilename(name)
		.replace(/\u0142/g, 'l')
		.replace(/\u0141/g, 'L')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
	const safe = ascii.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
	return safe || 'plik';
}

export const load: PageServerLoad = async () => {
	const db = adminClient();
	const [{ data: assets }, { data: categories }, { data: links }] = await Promise.all([
		db.from('email_assets').select('*').order('created_at', { ascending: false }),
		db.from('email_categories').select('id, code, name').order('sort_order'),
		db.from('email_category_assets').select('category_id, asset_id')
	]);

	return {
		assets: assets ?? [],
		categories: categories ?? [],
		links: links ?? []
	};
};

export const actions: Actions = {
	upload: async ({ request }) => {
		const form = await request.formData();
		const file = form.get('file');
		const name = String(form.get('name') ?? '').trim();

		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'Wybierz plik do wgrania' });
		}
		if (file.size > 28 * 1024 * 1024) {
			return fail(400, { error: 'Plik przekracza bezpieczny limit ~28 MB (Base64 w mailu dokłada ~33%)' });
		}

		const db = adminClient();
		const assetId = crypto.randomUUID();
		const filename = displayFilename(file.name);
		const storagePath = `library/${assetId}/${storageFilename(file.name)}`;

		const { error: uploadError } = await db.storage
			.from(BUCKET)
			.upload(storagePath, file, { contentType: file.type || 'application/octet-stream' });
		if (uploadError) {
			return fail(500, { error: `Upload nie powiódł się: ${uploadError.message}` });
		}

		const { error: insertError } = await db.from('email_assets').insert({
			id: assetId,
			name: name || filename,
			storage_path: storagePath,
			filename,
			content_type: file.type || null,
			size_bytes: file.size
		});
		if (insertError) {
			await db.storage.from(BUCKET).remove([storagePath]);
			return fail(500, { error: `Zapis do biblioteki nie powiódł się: ${insertError.message}` });
		}

		return { success: `Wgrano „${filename}” do biblioteki` };
	},

	pin: async ({ request }) => {
		const form = await request.formData();
		const assetId = String(form.get('asset_id') ?? '');
		const categoryIds = form.getAll('categories').map(String).filter(Boolean);
		if (!assetId) return fail(400, { error: 'Brak identyfikatora pliku' });

		const db = adminClient();
		const { error: delError } = await db.from('email_category_assets').delete().eq('asset_id', assetId);
		if (delError) return fail(500, { error: delError.message });

		if (categoryIds.length > 0) {
			const { error: insError } = await db
				.from('email_category_assets')
				.insert(categoryIds.map((categoryId) => ({ category_id: categoryId, asset_id: assetId })));
			if (insError) return fail(500, { error: insError.message });
		}
		return { success: 'Zaktualizowano przypięcia do kategorii' };
	},

	remove: async ({ request }) => {
		const form = await request.formData();
		const assetId = String(form.get('asset_id') ?? '');
		if (!assetId) return fail(400, { error: 'Brak identyfikatora pliku' });

		const db = adminClient();
		const { data: asset } = await db
			.from('email_assets')
			.select('storage_path')
			.eq('id', assetId)
			.maybeSingle();

		const { error } = await db.from('email_assets').delete().eq('id', assetId);
		if (error) {
			// FK z email_attachments blokuje usunięcie — plik jest częścią historii wysyłek
			return fail(409, {
				error: 'Nie można usunąć: plik został już użyty w wysłanych mailach (snapshot audytowy). Odepnij go od kategorii zamiast usuwać.'
			});
		}
		if (asset?.storage_path) {
			await db.storage.from(BUCKET).remove([asset.storage_path]);
		}
		return { success: 'Usunięto plik z biblioteki' };
	}
};
