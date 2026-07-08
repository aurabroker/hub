import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		userEmail: locals.user?.email ?? null
	};
};
