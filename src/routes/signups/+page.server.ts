import { adminClient } from '$lib/server/supabase';
import type { PageServerLoad } from './$types';
import type { Signup, UdClient, UdContact } from '$lib/ud/types';

export const load: PageServerLoad = async () => {
	const db = adminClient();

	const [clientsRes, contactsRes] = await Promise.all([
		db
			.from('ud_clients')
			.select('id, created_at, full_name, email, phone, profession, employment_type')
			.order('created_at', { ascending: false }),
		db
			.from('udochodu_contacts')
			.select('id, created_at, name, email, phone, rodo_consent')
			.order('created_at', { ascending: false })
	]);

	const errors: string[] = [];
	if (clientsRes.error) errors.push('ud_clients: ' + clientsRes.error.message);
	if (contactsRes.error) errors.push('udochodu_contacts: ' + contactsRes.error.message);

	const clients = (clientsRes.data ?? []) as Pick<
		UdClient,
		'id' | 'created_at' | 'full_name' | 'email' | 'phone' | 'profession' | 'employment_type'
	>[];
	const contacts = (contactsRes.data ?? []) as Pick<
		UdContact,
		'id' | 'created_at' | 'name' | 'email' | 'phone' | 'rodo_consent'
	>[];

	const signups: Signup[] = [
		...clients.map<Signup>((r) => ({
			type: 'client',
			id: r.id,
			name: r.full_name,
			email: r.email,
			phone: r.phone,
			sub: r.profession,
			created_at: r.created_at
		})),
		...contacts.map<Signup>((r) => ({
			type: 'contact',
			id: r.id,
			name: r.name,
			email: r.email,
			phone: r.phone,
			sub: 'Formularz kontaktowy',
			created_at: r.created_at
		}))
	].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

	return {
		signups,
		counts: { clients: clients.length, contacts: contacts.length },
		errors
	};
};
