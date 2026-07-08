import { adminClient } from '$lib/server/supabase';
import type { PageServerLoad } from './$types';

function daysAgoIso(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() - days);
	return d.toISOString();
}

function startOfTodayIso(): string {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d.toISOString();
}

export const load: PageServerLoad = async () => {
	const db = adminClient();

	const [
		contactsTotal,
		newWeek,
		newMonth,
		dupEmail,
		dupNip,
		sentToday,
		sent30,
		opened30,
		clicked30,
		signups,
		interest,
		sentDaily
	] = await Promise.all([
		db.from('crm_companies').select('id', { count: 'exact', head: true }),
		db.from('crm_companies').select('id', { count: 'exact', head: true }).gte('created_at', daysAgoIso(7)),
		db.from('crm_companies').select('id', { count: 'exact', head: true }).gte('created_at', daysAgoIso(30)),
		db.from('email_duplicates_by_email').select('email'),
		db.from('email_duplicates_by_nip').select('nip'),
		db
			.from('email_messages')
			.select('id', { count: 'exact', head: true })
			.eq('status', 'sent')
			.gte('sent_at', startOfTodayIso()),
		db
			.from('email_messages')
			.select('id', { count: 'exact', head: true })
			.eq('status', 'sent')
			.gte('sent_at', daysAgoIso(30)),
		db
			.from('email_messages')
			.select('id', { count: 'exact', head: true })
			.not('opened_at', 'is', null)
			.gte('sent_at', daysAgoIso(30)),
		db
			.from('email_messages')
			.select('id', { count: 'exact', head: true })
			.not('clicked_at', 'is', null)
			.gte('sent_at', daysAgoIso(30)),
		db.from('email_stats_signups_daily').select('*').limit(30),
		db.from('email_stats_interest').select('*'),
		db.from('email_stats_sent_daily').select('*').limit(60)
	]);

	const sentCount = sent30.count ?? 0;
	const openRate = sentCount > 0 ? Math.round(((opened30.count ?? 0) / sentCount) * 100) : null;
	const clickRate = sentCount > 0 ? Math.round(((clicked30.count ?? 0) / sentCount) * 100) : null;

	return {
		kpi: {
			contactsTotal: contactsTotal.count ?? 0,
			newWeek: newWeek.count ?? 0,
			newMonth: newMonth.count ?? 0,
			duplicateGroups: (dupEmail.data?.length ?? 0) + (dupNip.data?.length ?? 0),
			sentToday: sentToday.count ?? 0,
			sent30: sentCount,
			openRate,
			clickRate
		},
		signups: (signups.data ?? []).reverse() as { dzien: string; n: number }[],
		interest: (interest.data ?? []) as { kategoria: string; n: number }[],
		sentDaily: (sentDaily.data ?? []) as {
			dzien: string;
			sekcja: string;
			wyslane: number;
			otwarcia: number;
			klikniecia: number;
		}[]
	};
};
