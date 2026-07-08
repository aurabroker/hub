import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { EMAIL_RE, hasRodoConsent, normalizeInterest } from '$lib/categories';
import { sendResendEmail, type ResendAttachment } from './resend';

export const BUCKET = 'email-assets';
/** Resend domyślnie limituje do 2 req/s — odstęp między pojedynczymi wysyłkami. */
export const SEND_DELAY_MS = 650;
const MAX_ATTEMPTS = 3;
/** Base64 dokłada ~33%; cała wiadomość ma limit 40 MB. */
const MAX_ATTACHMENT_TOTAL_BYTES = 28 * 1024 * 1024;

export interface EmailCategory {
	id: string;
	code: string;
	name: string;
	resend_template_id: string | null;
	subject: string | null;
	from_email: string | null;
	active: boolean;
	sort_order: number;
}

export interface CrmCompany {
	id: number;
	company: string;
	contact: string | null;
	email: string | null;
	city: string | null;
	nip: string | null;
	ubezpieczenie: string | null;
	rodo: string | null;
	status: string | null;
	tag: string | null;
	lead_source: string | null;
}

export interface SegmentFilters {
	/** Kody kanoniczne (normalizacja `ubezpieczenie`). Puste = wszystkie. */
	kategorie?: string[];
	statusy?: string[];
	miasto?: string;
	tag?: string;
	lead_source?: string;
}

const COMPANY_COLUMNS =
	'id, company, contact, email, city, nip, ubezpieczenie, rodo, status, tag, lead_source';

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function bytesToBase64(bytes: Uint8Array): string {
	let bin = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(bin);
}

/** Zmienne szablonu budowane z danych firmy (nazwy zarezerwowane przez Resend są wielkimi literami — unikamy ich). */
export function companyVariables(company: CrmCompany | null): Record<string, string> {
	if (!company) return {};
	return {
		firma: company.company ?? '',
		kontakt: company.contact ?? '',
		miasto: company.city ?? '',
		nip: company.nip ?? ''
	};
}

export async function loadActiveCategories(db: SupabaseClient): Promise<EmailCategory[]> {
	const { data, error } = await db
		.from('email_categories')
		.select('*')
		.eq('active', true)
		.order('sort_order');
	if (error) throw new Error(`email_categories: ${error.message}`);
	return (data ?? []) as EmailCategory[];
}

/** Domyślne załączniki kategorii z biblioteki. */
async function categoryAssetIds(db: SupabaseClient, categoryId: string): Promise<string[]> {
	const { data, error } = await db
		.from('email_category_assets')
		.select('asset_id')
		.eq('category_id', categoryId);
	if (error) throw new Error(`email_category_assets: ${error.message}`);
	return (data ?? []).map((r) => r.asset_id as string);
}

/** Pobiera pliki z prywatnego bucketa i koduje Base64 (snapshot z email_attachments). */
async function buildAttachments(
	db: SupabaseClient,
	messageId: string
): Promise<{ attachments: ResendAttachment[]; error?: string }> {
	const { data, error } = await db
		.from('email_attachments')
		.select('asset_id, email_assets ( storage_path, filename, size_bytes )')
		.eq('message_id', messageId);
	if (error) return { attachments: [], error: `email_attachments: ${error.message}` };

	const assets = (data ?? [])
		.map((r) => r.email_assets as unknown as { storage_path: string; filename: string; size_bytes: number | null })
		.filter(Boolean);

	const total = assets.reduce((sum, a) => sum + (a.size_bytes ?? 0), 0);
	if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
		return {
			attachments: [],
			error: `Łączny rozmiar załączników ${(total / 1024 / 1024).toFixed(1)} MB przekracza bezpieczny limit ~28 MB`
		};
	}

	const attachments: ResendAttachment[] = [];
	for (const asset of assets) {
		const { data: blob, error: dlError } = await db.storage.from(BUCKET).download(asset.storage_path);
		if (dlError || !blob) {
			return { attachments: [], error: `Nie udało się pobrać ${asset.storage_path}: ${dlError?.message ?? 'brak pliku'}` };
		}
		attachments.push({
			filename: asset.filename,
			content: bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
		});
	}
	return { attachments };
}

/**
 * Atomowe przejęcie wiadomości z kolejki: update z filtrem status='queued'
 * gwarantuje, że równoległe workery nie wyślą tego samego maila dwa razy.
 */
async function claimMessage(db: SupabaseClient, messageId: string, attempts: number) {
	const { data, error } = await db
		.from('email_messages')
		.update({ status: 'sending', attempts: attempts + 1 })
		.eq('id', messageId)
		.eq('status', 'queued')
		.select('*')
		.maybeSingle();
	if (error) throw new Error(`claim: ${error.message}`);
	return data;
}

export interface SendOutcome {
	ok: boolean;
	resendId?: string;
	error?: string;
	/** true = ktoś inny już przetworzył tę wiadomość (nie liczyć jako błąd). */
	skipped?: boolean;
}

/**
 * Wysyła pojedynczą wiadomość z kolejki: szablon Resend kategorii +
 * załączniki-snapshot z biblioteki, aktualizuje status i loguje do crm_history.
 */
export async function sendMessageNow(db: SupabaseClient, messageId: string): Promise<SendOutcome> {
	const { data: current, error: loadError } = await db
		.from('email_messages')
		.select('*')
		.eq('id', messageId)
		.single();
	if (loadError || !current) return { ok: false, error: `Nie znaleziono wiadomości ${messageId}` };

	const message = await claimMessage(db, messageId, current.attempts as number);
	if (!message) return { ok: false, skipped: true, error: 'Wiadomość już przetworzona' };

	const fail = async (errorText: string): Promise<SendOutcome> => {
		const permanent = (message.attempts as number) >= MAX_ATTEMPTS;
		await db
			.from('email_messages')
			.update({ status: permanent ? 'failed' : 'queued', error: errorText })
			.eq('id', messageId);
		return { ok: false, error: errorText };
	};

	const { data: category } = await db
		.from('email_categories')
		.select('*')
		.eq('id', message.category_id)
		.maybeSingle();
	if (!category) return fail('Wiadomość nie ma przypisanej kategorii');

	let campaign: { subject: string | null; from_email: string | null } | null = null;
	if (message.campaign_id) {
		const { data } = await db
			.from('email_campaigns')
			.select('subject, from_email')
			.eq('id', message.campaign_id)
			.maybeSingle();
		campaign = data;
	}

	const from = campaign?.from_email || category.from_email || env.RESEND_FROM;
	if (!from) return fail('Brak adresu nadawcy (RESEND_FROM / kategoria / kampania)');
	const subject = campaign?.subject || category.subject || undefined;

	const { attachments, error: attachError } = await buildAttachments(db, messageId);
	if (attachError) return fail(attachError);

	const result = await sendResendEmail({
		from,
		to: message.to_email as string,
		subject,
		templateId: category.resend_template_id,
		variables: (message.variables_json ?? {}) as Record<string, string>,
		attachments
	});
	if (!result.ok) return fail(result.error ?? 'Nieznany błąd Resend');

	await db
		.from('email_messages')
		.update({ status: 'sent', resend_id: result.id, sent_at: new Date().toISOString(), error: null })
		.eq('id', messageId);

	if (message.company_id) {
		await db.from('crm_history').insert({
			company_id: message.company_id,
			type: 'email',
			note: `Aura HUB: wysłano mail „${subject ?? category.name}” (sekcja: ${category.code}${message.campaign_id ? ', kampania' : ', szybka wysyłka'})`,
			author: 'Aura HUB'
		});
	}

	return { ok: true, resendId: result.id };
}

/** Tworzy wiadomość + snapshot domyślnych załączników kategorii. Zwraca id wiadomości. */
export async function createMessage(
	db: SupabaseClient,
	args: {
		campaignId?: string | null;
		categoryId: string;
		companyId?: number | null;
		toEmail: string;
		source: 'campaign' | 'quick_send';
		variables: Record<string, string>;
		rodoSnapshot?: string | null;
		status?: 'queued' | 'skipped';
		error?: string | null;
	}
): Promise<string> {
	const { data, error } = await db
		.from('email_messages')
		.insert({
			campaign_id: args.campaignId ?? null,
			category_id: args.categoryId,
			company_id: args.companyId ?? null,
			to_email: args.toEmail,
			source: args.source,
			variables_json: args.variables,
			rodo_snapshot: args.rodoSnapshot ?? null,
			status: args.status ?? 'queued',
			error: args.error ?? null
		})
		.select('id')
		.single();
	if (error) throw new Error(`email_messages insert: ${error.message}`);

	if ((args.status ?? 'queued') === 'queued') {
		const assetIds = await categoryAssetIds(db, args.categoryId);
		if (assetIds.length > 0) {
			await db
				.from('email_attachments')
				.insert(assetIds.map((assetId) => ({ message_id: data.id, asset_id: assetId })));
		}
	}
	return data.id as string;
}

export interface QuickSendResult {
	categoryId: string;
	code: string;
	name: string;
	ok: boolean;
	resendId?: string;
	error?: string;
}

/**
 * Szybka wysyłka 1-do-1: dla każdej zaznaczonej kategorii osobny, dedykowany
 * mail z domyślnymi załącznikami tej kategorii z biblioteki.
 */
export async function quickSend(
	db: SupabaseClient,
	toEmail: string,
	categoryIds: string[]
): Promise<QuickSendResult[]> {
	const { data: categories, error } = await db
		.from('email_categories')
		.select('*')
		.in('id', categoryIds)
		.eq('active', true)
		.order('sort_order');
	if (error) throw new Error(`email_categories: ${error.message}`);

	const { data: company } = await db
		.from('crm_companies')
		.select(COMPANY_COLUMNS)
		.ilike('email', toEmail.trim())
		.order('created_at', { ascending: true })
		.limit(1)
		.maybeSingle();

	const results: QuickSendResult[] = [];
	for (const [index, category] of ((categories ?? []) as EmailCategory[]).entries()) {
		if (index > 0) await sleep(SEND_DELAY_MS);
		try {
			const messageId = await createMessage(db, {
				categoryId: category.id,
				companyId: (company as CrmCompany | null)?.id ?? null,
				toEmail: toEmail.trim(),
				source: 'quick_send',
				variables: companyVariables(company as CrmCompany | null),
				rodoSnapshot: (company as CrmCompany | null)?.rodo ?? null
			});
			const outcome = await sendMessageNow(db, messageId);
			results.push({
				categoryId: category.id,
				code: category.code,
				name: category.name,
				ok: outcome.ok,
				resendId: outcome.resendId,
				error: outcome.error
			});
		} catch (e) {
			results.push({
				categoryId: category.id,
				code: category.code,
				name: category.name,
				ok: false,
				error: e instanceof Error ? e.message : String(e)
			});
		}
	}
	return results;
}

/** Pobiera kontakty CRM spełniające zapisany filtr segmentu. */
export async function segmentCompanies(
	db: SupabaseClient,
	filters: SegmentFilters
): Promise<CrmCompany[]> {
	let query = db.from('crm_companies').select(COMPANY_COLUMNS);
	if (filters.statusy && filters.statusy.length > 0) query = query.in('status', filters.statusy);
	if (filters.miasto) query = query.ilike('city', `%${filters.miasto}%`);
	if (filters.tag) query = query.ilike('tag', `%${filters.tag}%`);
	if (filters.lead_source) query = query.ilike('lead_source', `%${filters.lead_source}%`);

	const { data, error } = await query.limit(10000);
	if (error) throw new Error(`crm_companies: ${error.message}`);

	let companies = (data ?? []) as CrmCompany[];
	if (filters.kategorie && filters.kategorie.length > 0) {
		const wanted = new Set(filters.kategorie);
		companies = companies.filter((c) => wanted.has(normalizeInterest(c.ubezpieczenie)));
	}
	return companies;
}

export interface AudiencePreview {
	total: number;
	queued: number;
	skippedNoConsent: number;
	skippedBadEmail: number;
	excludedByMode: number;
}

/** Zastosowanie audience_mode względem historii wysyłek danej kategorii. */
async function applyAudienceMode(
	db: SupabaseClient,
	companies: CrmCompany[],
	mode: string,
	categoryId: string | null
): Promise<{ companies: CrmCompany[]; excluded: number }> {
	if (mode === 'all' || !categoryId) return { companies, excluded: 0 };

	const { data, error } = await db
		.from('email_messages')
		.select('company_id, status, opened_at')
		.eq('category_id', categoryId)
		.not('company_id', 'is', null);
	if (error) throw new Error(`email_messages history: ${error.message}`);

	const sentTo = new Set<number>();
	const openedBy = new Set<number>();
	const failedFor = new Set<number>();
	for (const row of data ?? []) {
		const cid = row.company_id as number;
		if (row.status === 'sent') {
			sentTo.add(cid);
			if (row.opened_at) openedBy.add(cid);
		}
		if (row.status === 'failed' || row.status === 'bounced') failedFor.add(cid);
	}

	let filtered: CrmCompany[];
	switch (mode) {
		case 'new_only':
			filtered = companies.filter((c) => !sentTo.has(c.id));
			break;
		case 'not_opened':
			filtered = companies.filter((c) => sentTo.has(c.id) && !openedBy.has(c.id));
			break;
		case 'retry_failed':
			filtered = companies.filter((c) => failedFor.has(c.id) && !sentTo.has(c.id));
			break;
		default:
			filtered = companies;
	}
	return { companies: filtered, excluded: companies.length - filtered.length };
}

/** Podgląd odbiorców kampanii (bez zapisu) — pokazuje też skutki bramki RODO. */
export async function previewAudience(
	db: SupabaseClient,
	filters: SegmentFilters,
	mode: string,
	categoryId: string | null
): Promise<AudiencePreview> {
	const all = await segmentCompanies(db, filters);
	const { companies, excluded } = await applyAudienceMode(db, all, mode, categoryId);
	let queued = 0;
	let skippedNoConsent = 0;
	let skippedBadEmail = 0;
	for (const c of companies) {
		if (!c.email || !EMAIL_RE.test(c.email.trim())) skippedBadEmail++;
		else if (!hasRodoConsent(c.rodo)) skippedNoConsent++;
		else queued++;
	}
	return { total: all.length, queued, skippedNoConsent, skippedBadEmail, excludedByMode: excluded };
}

/**
 * Materializacja kampanii: tworzy email_messages (queued/skipped) dla segmentu.
 * Idempotentna — kontakty już zmaterializowane w tej kampanii są pomijane
 * (dodatkowo pilnuje tego unikalny indeks campaign_id+company_id).
 */
export async function materializeCampaign(
	db: SupabaseClient,
	campaignId: string
): Promise<{ queued: number; skipped: number }> {
	const { data: campaign, error } = await db
		.from('email_campaigns')
		.select('*')
		.eq('id', campaignId)
		.single();
	if (error || !campaign) throw new Error(`Nie znaleziono kampanii ${campaignId}`);

	const filters = (campaign.segment_json ?? {}) as SegmentFilters;
	const all = await segmentCompanies(db, filters);
	const { companies } = await applyAudienceMode(
		db,
		all,
		campaign.audience_mode as string,
		campaign.category_id as string | null
	);

	const { data: existing } = await db
		.from('email_messages')
		.select('company_id')
		.eq('campaign_id', campaignId)
		.not('company_id', 'is', null);
	const already = new Set((existing ?? []).map((r) => r.company_id as number));

	let queued = 0;
	let skipped = 0;
	for (const company of companies) {
		if (already.has(company.id)) continue;

		const email = (company.email ?? '').trim();
		let status: 'queued' | 'skipped' = 'queued';
		let reason: string | null = null;
		if (!EMAIL_RE.test(email)) {
			status = 'skipped';
			reason = 'Niepoprawny adres e-mail';
		} else if (!hasRodoConsent(company.rodo)) {
			status = 'skipped';
			reason = 'Brak zgody RODO na wysyłkę';
		}

		await createMessage(db, {
			campaignId,
			categoryId: campaign.category_id as string,
			companyId: company.id,
			toEmail: email || '(brak)',
			source: 'campaign',
			variables: companyVariables(company),
			rodoSnapshot: company.rodo ?? null,
			status,
			error: reason
		});
		if (status === 'queued') queued++;
		else skipped++;
	}
	return { queued, skipped };
}

export interface ProcessResult {
	processed: number;
	sent: number;
	failed: number;
	requeued: number;
}

/**
 * Przetwarza partię kolejki (wywoływane przez cron Workera lub ręcznie z panelu).
 * Wysyłka pojedynczo z throttlingiem pod limity Resend; nieudane wracają do
 * kolejki do wyczerpania prób (MAX_ATTEMPTS), potem status 'failed'.
 */
export async function processQueue(db: SupabaseClient, limit = 20): Promise<ProcessResult> {
	// Uruchom zaplanowane kampanie, którym minął termin
	const { data: due } = await db
		.from('email_campaigns')
		.select('id')
		.eq('status', 'scheduled')
		.lte('scheduled_at', new Date().toISOString());
	for (const campaign of due ?? []) {
		await materializeCampaign(db, campaign.id as string);
		await db.from('email_campaigns').update({ status: 'sending' }).eq('id', campaign.id);
	}

	const { data: batch, error } = await db
		.from('email_messages')
		.select('id, campaign_id')
		.eq('status', 'queued')
		.not('campaign_id', 'is', null)
		.order('created_at', { ascending: true })
		.limit(limit);
	if (error) throw new Error(`kolejka: ${error.message}`);

	const result: ProcessResult = { processed: 0, sent: 0, failed: 0, requeued: 0 };
	const campaignIds = new Set<string>();

	for (const [index, row] of (batch ?? []).entries()) {
		if (index > 0) await sleep(SEND_DELAY_MS);
		const outcome = await sendMessageNow(db, row.id as string);
		if (outcome.skipped) continue;
		result.processed++;
		if (row.campaign_id) campaignIds.add(row.campaign_id as string);
		if (outcome.ok) result.sent++;
		else {
			const { data: after } = await db
				.from('email_messages')
				.select('status')
				.eq('id', row.id)
				.single();
			if (after?.status === 'failed') result.failed++;
			else result.requeued++;
		}
	}

	// Domknij kampanie bez pozostałych wiadomości w kolejce
	for (const campaignId of campaignIds) {
		const { count } = await db
			.from('email_messages')
			.select('id', { count: 'exact', head: true })
			.eq('campaign_id', campaignId)
			.in('status', ['queued', 'sending']);
		if ((count ?? 0) === 0) {
			const { count: sentCount } = await db
				.from('email_messages')
				.select('id', { count: 'exact', head: true })
				.eq('campaign_id', campaignId)
				.eq('status', 'sent');
			await db
				.from('email_campaigns')
				.update({ status: (sentCount ?? 0) > 0 ? 'sent' : 'failed' })
				.eq('id', campaignId)
				.eq('status', 'sending');
		}
	}

	return result;
}
