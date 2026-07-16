export type CrmCompany = {
	id: number;
	company: string | null;
	contact: string | null;
	title: string | null;
	phone: string | null;
	email: string | null;
	city: string | null;
	state: string | null;
	industry: string | null;
	revenue: number | null;
	employees: string | null;
	url: string | null;
	status: string | null;
	assigned_to: string | null;
	created_at: string;
	updated_at: string | null;
	assigned_user_id: string | null;
	nip: string | null;
	regon: string | null;
	notes: string | null;
	/** Surowy tekst zainteresowania z formularza; kategorię liczymy przez normalizeInterest(). */
	ubezpieczenie: string | null;
	/** Zgoda RODO (surowa wartość); interpretacja przez hasRodoConsent(). */
	rodo: string | null;
};
