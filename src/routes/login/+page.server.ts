import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');

		if (!email || !password) {
			return fail(400, { error: 'Podaj adres e-mail i hasło', email });
		}

		const { error } = await locals.supabase.auth.signInWithPassword({ email, password });
		if (error) {
			return fail(401, { error: 'Nieprawidłowy e-mail lub hasło', email });
		}

		const { data: isAdmin } = await locals.supabase.rpc('is_platform_admin');
		if (isAdmin !== true) {
			await locals.supabase.auth.signOut();
			return fail(403, { error: 'To konto nie ma uprawnień administratora', email });
		}

		redirect(303, '/');
	}
};
