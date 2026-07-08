import { createServerClient } from '@supabase/ssr';
import { env as publicEnv } from '$env/dynamic/public';
import { redirect, type Handle } from '@sveltejs/kit';

/** Ścieżki dostępne bez zalogowanego administratora. */
const PUBLIC_PREFIXES = ['/login', '/api/webhooks/', '/api/cron/'];

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createServerClient(
		publicEnv.PUBLIC_SUPABASE_URL ?? '',
		publicEnv.PUBLIC_SUPABASE_ANON_KEY ?? '',
		{
			cookies: {
				getAll: () => event.cookies.getAll(),
				setAll: (cookies: { name: string; value: string; options: Record<string, unknown> }[]) => {
					for (const { name, value, options } of cookies) {
						event.cookies.set(name, value, { ...options, path: '/' });
					}
				}
			}
		}
	);

	const {
		data: { user }
	} = await event.locals.supabase.auth.getUser();
	event.locals.user = user;
	event.locals.isAdmin = false;

	if (user) {
		const { data } = await event.locals.supabase.rpc('is_platform_admin');
		event.locals.isAdmin = data === true;
	}

	const path = event.url.pathname;
	const isPublic = PUBLIC_PREFIXES.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p));

	if (!isPublic && !event.locals.isAdmin) {
		redirect(303, '/login');
	}
	if (path === '/login' && event.locals.isAdmin) {
		redirect(303, '/');
	}

	return resolve(event, {
		filterSerializedResponseHeaders: (name) => name === 'content-range' || name === 'x-supabase-api-version'
	});
};
