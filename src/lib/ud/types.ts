export type UdClient = {
	id: string;
	created_at: string;
	full_name: string | null;
	email: string | null;
	phone: string | null;
	pesel: string | null;
	employment_type: string | null;
	profession: string | null;
	[key: string]: unknown;
};

export type UdContact = {
	id: string;
	created_at: string;
	name: string | null;
	email: string | null;
	phone: string | null;
	rodo_consent: boolean | null;
};

export type Signup = {
	type: 'client' | 'contact';
	id: string;
	name: string | null;
	email: string | null;
	phone: string | null;
	sub: string | null;
	created_at: string;
};
