import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { EMAIL_RE, hasRodoConsent, normalizeInterest } from '$lib/categories';
import { renderEmailHtml } from '$lib/email/render';
import { fetchAllRows } from '$lib/server/supabase';
import { decorateLinksWithUtm, slugifyUtm } from '$lib/utm';
import { startOfWarsawDayIso } from '$lib/warsaw';
import { resendTemplateFrom, sendResendEmail, type ResendAttachment } from './resend';

export const BUCKET = 'email-assets';
/**
 * Odstęp między pojedynczymi wysyłkami. Domyślnie pod limit Resend 2 req/s;
 * konto z wyższym limitem może go skrócić zmienną SEND_DELAY_MS.
 */
export const SEND_DELAY_MS = Number(env.SEND_DELAY_MS ?? '') || 650;
/**
 * Dzienny limit realnie wysłanych maili — zabezpieczenie przed masową wysyłką.
 * Z komercyjnym planem Resend praktycznie nieograniczony; domyślnie bardzo wysoki,
 * można ograniczyć zmienną środowiskową DAILY_SEND_LIMIT. Obowiązuje łącznie dla
 * kampanii i wysyłki „do wszystkich" wg kategorii; pierwszeństwo mają kampanie.
 */
export const DAILY_SEND_LIMIT = Number(env.DAILY_SEND_LIMIT ?? '') || 100000;
const MAX_ATTEMPTS = 3;
/** Po tylu minutach wiadomość w stanie 'sending' uznajemy za zawieszoną i wracamy z nią do kolejki. */
const STALE_SENDING_MINUTES = 15;
/**
 * Resend pamięta klucz idempotencji 24 h. Zawieszonej wiadomości starszej niż
 * ten próg nie ponawiamy automatycznie — klucz mógł już wygasnąć, a wtedy
 * ponowienie wysłałoby drugi egzemplarz.
 */
const IDEMPOTENCY_SAFE_HOURS = 23;
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

/**
 * ILIKE bez symboli wieloznacznych: '_' w adresie (jan_kowalski@…) dopasowałby
 * też inny znak, czyli innego klienta.
 */
function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Adres w postaci do porównań (duplikaty, blokady). */
export function normalizeEmail(email: string | null | undefined): string {
	return (email ?? '').trim().toLowerCase();
}

/**
 * Adresy, na które nie wysyłamy marketingu: twarde odbicie albo zgłoszenie
 * spamu w historii wysyłek (zdarzenia z webhooka Resend). Resend i tak
 * blokuje takie adresy u siebie, ale wtedy HUB pokazywałby je jako „wysłane”.
 * To nie jest rejestr wypisów — wypisów HUB jeszcze nie zbiera.
 */
export async function loadBlockedEmails(db: SupabaseClient): Promise<Set<string>> {
	const rows = await fetchAllRows<{ to_email: string }>(
		(from, to) =>
			db
				.from('email_messages')
				.select('to_email')
				.or('status.eq.bounced,complained_at.not.is.null')
				.order('id')
				.range(from, to),
		'email_messages blokady'
	);
	return new Set(rows.map((r) => normalizeEmail(r.to_email)));
}

export const BLOCKED_REASON = 'Adres wcześniej odbił maila albo zgłosił spam';
export const DUPLICATE_REASON = 'Ten sam adres jest już w tej wysyłce';
export const CANCELED_REASON = 'Kampania anulowana';

export async function loadActiveCategories(db: SupabaseClient): Promise<EmailCategory[]> {
	const { data, error } = await db
		.from('email_categories')
		.select('*')
		.eq('active', true)
		.order('sort_order');
	if (error) throw new Error(`email_categories: ${error.message}`);
	return (data ?? []) as EmailCategory[];
}

/**
 * Pobiera wskazane pliki z biblioteki i zamienia na załączniki Resend (Base64).
 * Używane m.in. przy wysyłce testowej z Edytora e-mail.
 */
export async function loadAssetsAsAttachments(
	db: SupabaseClient,
	assetIds: string[]
): Promise<{ attachments: ResendAttachment[]; error?: string }> {
	if (assetIds.length === 0) return { attachments: [] };

	const { data, error } = await db
		.from('email_assets')
		.select('storage_path, filename, size_bytes')
		.in('id', assetIds);
	if (error) return { attachments: [], error: `email_assets: ${error.message}` };

	const rows = data ?? [];
	const total = rows.reduce((sum, a) => sum + ((a.size_bytes as number | null) ?? 0), 0);
	if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
		return {
			attachments: [],
			error: `Łączny rozmiar załączników ${(total / 1024 / 1024).toFixed(1)} MB przekracza bezpieczny limit ~28 MB`
		};
	}

	const attachments: ResendAttachment[] = [];
	for (const row of rows) {
		const path = row.storage_path as string;
		const { data: blob, error: dlError } = await db.storage.from(BUCKET).download(path);
		if (dlError || !blob) {
			return { attachments: [], error: `Nie udało się pobrać ${path}: ${dlError?.message ?? 'brak pliku'}` };
		}
		attachments.push({
			filename: row.filename as string,
			content: bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
		});
	}
	return { attachments };
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

interface SnapshotAsset {
	asset_id: string;
	storage_path: string;
	filename: string;
	size_bytes: number | null;
}

/** Snapshot plików przypiętych do wiadomości (email_attachments → email_assets). */
async function loadSnapshotAssets(
	db: SupabaseClient,
	messageId: string
): Promise<{ assets: SnapshotAsset[]; error?: string }> {
	const { data, error } = await db
		.from('email_attachments')
		.select('asset_id, email_assets ( storage_path, filename, size_bytes )')
		.eq('message_id', messageId);
	if (error) return { assets: [], error: `email_attachments: ${error.message}` };

	const assets = (data ?? [])
		.map((r) => {
			const a = r.email_assets as unknown as Omit<SnapshotAsset, 'asset_id'> | null;
			return a ? { asset_id: r.asset_id as string, ...a } : null;
		})
		.filter((a): a is SnapshotAsset => a !== null);
	return { assets };
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

/**
 * Przygotowuje pliki wiadomości zależnie od trybu kategorii:
 * - 'attachments' → pobranie z prywatnego bucketa + Base64 (limit ~28 MB),
 * - 'links' → lekki mail bez załączników; zmienna szablonu {{{pliki_html}}}
 *   z listą linków do pobrania przez publiczny endpoint /files/{asset_id}.
 */
async function prepareFiles(
	db: SupabaseClient,
	messageId: string,
	mode: string,
	origin: string
): Promise<{ attachments: ResendAttachment[]; variables: Record<string, string>; error?: string }> {
	const { assets, error } = await loadSnapshotAssets(db, messageId);
	if (error) return { attachments: [], variables: {}, error };
	if (assets.length === 0) return { attachments: [], variables: { pliki_html: '' } };

	if (mode === 'links') {
		const items = assets
			.map(
				(a) =>
					`<li style="margin: 4px 0"><a href="${origin}/files/${a.asset_id}">${escapeHtml(a.filename)}</a></li>`
			)
			.join('');
		return { attachments: [], variables: { pliki_html: `<ul style="padding-left: 18px">${items}</ul>` } };
	}

	const total = assets.reduce((sum, a) => sum + (a.size_bytes ?? 0), 0);
	if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
		return {
			attachments: [],
			variables: {},
			error: `Łączny rozmiar załączników ${(total / 1024 / 1024).toFixed(1)} MB przekracza bezpieczny limit ~28 MB`
		};
	}

	const attachments: ResendAttachment[] = [];
	for (const asset of assets) {
		const { data: blob, error: dlError } = await db.storage.from(BUCKET).download(asset.storage_path);
		if (dlError || !blob) {
			return {
				attachments: [],
				variables: {},
				error: `Nie udało się pobrać ${asset.storage_path}: ${dlError?.message ?? 'brak pliku'}`
			};
		}
		attachments.push({
			filename: asset.filename,
			content: bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
		});
	}
	return { attachments, variables: { pliki_html: '' } };
}

/**
 * Atomowe przejęcie wiadomości z kolejki: update z filtrem status='queued'
 * gwarantuje, że równoległe workery nie wyślą tego samego maila dwa razy.
 */
async function claimMessage(db: SupabaseClient, messageId: string, attempts: number) {
	const { data, error } = await db
		.from('email_messages')
		.update({ status: 'sending', attempts: attempts + 1, claimed_at: new Date().toISOString() })
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
	/** Resend odpowiedział 429 — dalsze wysyłki w tej partii nie mają sensu. */
	rateLimited?: boolean;
}

/**
 * Wysyła pojedynczą wiadomość z kolejki: szablon Resend kategorii +
 * pliki (załączniki albo linki wg trybu kategorii), aktualizuje status
 * i loguje do crm_history. `origin` = baza publicznych linków do plików.
 */
export async function sendMessageNow(
	db: SupabaseClient,
	messageId: string,
	origin: string
): Promise<SendOutcome> {
	const { data: current, error: loadError } = await db
		.from('email_messages')
		.select('*')
		.eq('id', messageId)
		.single();
	if (loadError || !current) return { ok: false, error: `Nie znaleziono wiadomości ${messageId}` };

	const message = await claimMessage(db, messageId, current.attempts as number);
	if (!message) return { ok: false, skipped: true, error: 'Wiadomość już przetworzona' };
	const attempt = message.attempts as number;

	const fail = async (errorText: string): Promise<SendOutcome> => {
		const permanent = attempt >= MAX_ATTEMPTS;
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

	let campaign: { name: string | null; subject: string | null; from_email: string | null } | null =
		null;
	if (message.campaign_id) {
		const { data } = await db
			.from('email_campaigns')
			.select('name, subject, from_email')
			.eq('id', message.campaign_id)
			.maybeSingle();
		campaign = data;
	}

	// Treść z Edytora HUB ma pierwszeństwo: gdy sekcja ma własny html_body,
	// wysyłamy surowy HTML (personalizacja podstawiana po naszej stronie) zamiast
	// szablonu Resend. Brak html_body → dawna ścieżka szablonu (bez zmian).
	const htmlBody = typeof category.html_body === 'string' ? category.html_body.trim() : '';
	const templateId = htmlBody ? null : ((category.resend_template_id as string | null) ?? null);

	// Nadawca: kampania → sekcja → nadawca zapisany w szablonie Resend → RESEND_FROM.
	// Bez kroku z szablonem RESEND_FROM nadpisywał nadawcę szablonu i newsletter
	// jednej marki wychodził z adresu innej.
	const templateFrom =
		!campaign?.from_email && !category.from_email && templateId
			? await resendTemplateFrom(templateId)
			: null;
	const from = campaign?.from_email || category.from_email || templateFrom || env.RESEND_FROM;
	if (!from) return fail('Brak adresu nadawcy (RESEND_FROM / kategoria / kampania)');
	const subject = campaign?.subject || category.subject || undefined;

	const { attachments, variables: fileVariables, error: attachError } = await prepareFiles(
		db,
		messageId,
		(category.attachment_mode as string) ?? 'attachments',
		origin
	);
	if (attachError) return fail(attachError);

	const messageVars = (message.variables_json ?? {}) as Record<string, string>;
	// Klucz idempotencji zależy od numeru próby: po odrzuceniu przez Resend kolejna
	// próba dostaje nowy klucz, a po awarii między wysyłką a zapisem statusu
	// (odzyskiwanie w processQueue oddaje próbę) — ten sam, więc Resend nie wyśle duplikatu.
	const idempotencyKey = `aura-hub/${messageId}/${attempt}`;

	let result;
	if (htmlBody) {
		if (!subject) {
			return fail('Sekcja ma treść HTML, ale brak tematu — ustaw temat sekcji w Edytorze e-mail');
		}
		// Auto-UTM: linki w treści dostają oznaczenie kanału, żeby ruch z maili
		// przestał wpadać w raportach do worka „direct". Kampania = kod sekcji,
		// wariant = nazwa kampanii masowej. Linki, które już mają utm_source
		// (np. wklejone z biblioteki UTM), zostają nietknięte.
		const decorated = decorateLinksWithUtm(htmlBody, {
			source: 'email',
			medium: 'email',
			campaign: category.code as string,
			content: campaign?.name ? slugifyUtm(campaign.name) : 'szybka-wysylka'
		});
		const html = renderEmailHtml(decorated, messageVars, {
			unsubscribeUrl: env.RESEND_UNSUBSCRIBE_URL,
			plikiHtml: fileVariables.pliki_html
		});
		result = await sendResendEmail({
			from,
			to: message.to_email as string,
			subject,
			html,
			attachments,
			idempotencyKey
		});
	} else {
		result = await sendResendEmail({
			from,
			to: message.to_email as string,
			subject,
			templateId,
			// link_wypisu: Resend NIE wypełnia {{{RESEND_UNSUBSCRIBE_URL}}} przy wysyłce
			// przez API (tylko w Broadcasts), więc szablon musi używać tej zmiennej.
			variables: {
				...messageVars,
				...fileVariables,
				link_wypisu: env.RESEND_UNSUBSCRIBE_URL ?? ''
			},
			attachments,
			idempotencyKey
		});
	}
	if (!result.ok) {
		if (result.rateLimited) {
			// 429 to limit konta, nie wina wiadomości: wracamy do kolejki bez zużycia próby.
			await db
				.from('email_messages')
				.update({ status: 'queued', attempts: attempt - 1, error: result.error ?? null })
				.eq('id', messageId);
			return { ok: false, error: result.error, rateLimited: true };
		}
		return fail(result.error ?? 'Nieznany błąd Resend');
	}

	// Mail już wyszedł. Nieudany zapis statusu zostawia wiadomość w 'sending';
	// odzyskiwanie ponowi ją z tym samym kluczem idempotencji, więc bez duplikatu.
	const sentUpdate = {
		status: 'sent',
		resend_id: result.id,
		sent_at: new Date().toISOString(),
		error: null
	};
	const saveStatus = () => db.from('email_messages').update(sentUpdate).eq('id', messageId);
	let { error: saveError } = await saveStatus();
	if (saveError) ({ error: saveError } = await saveStatus());
	if (saveError) console.error(`zapis statusu ${messageId} po wysyłce: ${saveError.message}`);

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
	categoryIds: string[],
	origin: string
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
		.ilike('email', escapeLike(toEmail.trim()))
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
			const outcome = await sendMessageNow(db, messageId, origin);
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
	// Builder zapytania budujemy od nowa dla KAŻDEJ strony. Ponowne użycie
	// jednego obiektu doklejałoby order/range przy każdym przebiegu i psuło URL.
	const buildQuery = (from: number, to: number) => {
		let query = db.from('crm_companies').select(COMPANY_COLUMNS);
		if (filters.statusy && filters.statusy.length > 0) query = query.in('status', filters.statusy);
		if (filters.miasto) query = query.ilike('city', `%${filters.miasto}%`);
		if (filters.tag) query = query.ilike('tag', `%${filters.tag}%`);
		if (filters.lead_source) query = query.ilike('lead_source', `%${filters.lead_source}%`);
		return query.order('id').range(from, to);
	};

	// Segment potrafi objąć całą bazę, a PostgREST tnie odpowiedź do db_max_rows
	// bez błędu — bez stronicowania kampania po cichu omijałaby część kontaktów.
	let companies = await fetchAllRows<CrmCompany>(buildQuery, 'crm_companies');
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
	/** Adres z twardym odbiciem albo skargą na spam w historii wysyłek. */
	skippedBlocked: number;
	/** Ten sam adres na kilku kartach CRM — wysyłamy raz. */
	skippedDuplicate: number;
	excludedByMode: number;
}

/**
 * Wspólna bramka odbiorcy dla kampanii, wysyłki „do wszystkich” i automatu:
 * poprawny adres → brak sprzeciwu RODO → brak blokady → pierwszy raz w tej wysyłce.
 * `seen` jest uzupełniany o przepuszczone adresy (deduplikacja po adresie, nie po
 * karcie CRM — ta sama osoba bywa w bazie kilka razy).
 */
function recipientGate(
	company: CrmCompany,
	blocked: Set<string>,
	seen: Set<string>
): { email: string; reason: string | null } {
	const email = (company.email ?? '').trim();
	if (!EMAIL_RE.test(email)) return { email, reason: 'Niepoprawny adres e-mail' };
	if (!hasRodoConsent(company.rodo)) return { email, reason: 'Brak zgody RODO na wysyłkę' };
	const norm = normalizeEmail(email);
	if (blocked.has(norm)) return { email, reason: BLOCKED_REASON };
	if (seen.has(norm)) return { email, reason: DUPLICATE_REASON };
	seen.add(norm);
	return { email, reason: null };
}

/** Zastosowanie audience_mode względem historii wysyłek danej kategorii. */
async function applyAudienceMode(
	db: SupabaseClient,
	companies: CrmCompany[],
	mode: string,
	categoryId: string | null
): Promise<{ companies: CrmCompany[]; excluded: number }> {
	if (mode === 'all' || !categoryId) return { companies, excluded: 0 };

	// Historia decyduje o wykluczeniach — przycięta do db_max_rows dawałaby
	// powtórne maile do osób, które już je dostały. Czytamy stronami.
	const data = await fetchAllRows<{
		company_id: number;
		status: string;
		opened_at: string | null;
	}>(
		(from, to) =>
			db
				.from('email_messages')
				.select('company_id, status, opened_at')
				.eq('category_id', categoryId)
				.not('company_id', 'is', null)
				.order('id')
				.range(from, to),
		'email_messages history'
	);

	const sentTo = new Set<number>();
	const openedBy = new Set<number>();
	const failedFor = new Set<number>();
	for (const row of data ?? []) {
		const cid = row.company_id as number;
		if (row.status === 'sent') {
			sentTo.add(cid);
			if (row.opened_at) openedBy.add(cid);
		}
		// Odbite adresy celowo pomijamy: ponowna wysyłka na twarde odbicie psuje reputację domeny.
		if (row.status === 'failed') failedFor.add(cid);
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
	const [all, blocked] = await Promise.all([segmentCompanies(db, filters), loadBlockedEmails(db)]);
	const { companies, excluded } = await applyAudienceMode(db, all, mode, categoryId);
	const preview: AudiencePreview = {
		total: all.length,
		queued: 0,
		skippedNoConsent: 0,
		skippedBadEmail: 0,
		skippedBlocked: 0,
		skippedDuplicate: 0,
		excludedByMode: excluded
	};
	const seen = new Set<string>();
	for (const c of companies) {
		const { reason } = recipientGate(c, blocked, seen);
		if (reason === null) preview.queued++;
		else if (reason === BLOCKED_REASON) preview.skippedBlocked++;
		else if (reason === DUPLICATE_REASON) preview.skippedDuplicate++;
		else if (reason.startsWith('Brak zgody')) preview.skippedNoConsent++;
		else preview.skippedBadEmail++;
	}
	return preview;
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

	// Wznowienie anulowanej kampanii: wiadomości zdjęte z kolejki przy anulowaniu
	// wracają. Pętla niżej by ich nie odtworzyła, bo te kontakty już mają wiersz.
	const { data: resumedRows, error: resumeError } = await db
		.from('email_messages')
		.update({ status: 'queued', error: null })
		.eq('campaign_id', campaignId)
		.eq('status', 'skipped')
		.eq('error', CANCELED_REASON)
		.select('id');
	if (resumeError) throw new Error(`wznowienie kampanii: ${resumeError.message}`);

	const filters = (campaign.segment_json ?? {}) as SegmentFilters;
	const [all, blocked] = await Promise.all([segmentCompanies(db, filters), loadBlockedEmails(db)]);
	const { companies } = await applyAudienceMode(
		db,
		all,
		campaign.audience_mode as string,
		campaign.category_id as string | null
	);

	// Zbiór już zmaterializowanych odbiorców kampanii: gdyby był niepełny,
	// ponowny start kampanii dopisałby duplikaty.
	const existing = await fetchAllRows<{ company_id: number; to_email: string; status: string }>(
		(from, to) =>
			db
				.from('email_messages')
				.select('company_id, to_email, status')
				.eq('campaign_id', campaignId)
				.not('company_id', 'is', null)
				.order('id')
				.range(from, to),
		'email_messages'
	);
	const already = new Set(existing.map((r) => r.company_id));
	// Adresy, które ta kampania już obsłużyła — drugi wiersz CRM z tym samym
	// adresem nie może dostać drugiego egzemplarza.
	const seen = new Set(
		existing.filter((r) => r.status !== 'skipped').map((r) => normalizeEmail(r.to_email))
	);

	// Budujemy wszystkie wiersze w pamięci, a potem wstawiamy HURTOWO (chunk).
	// Round-trip do bazy per odbiorca przekracza limit ~50 subrequestów pojedynczego
	// żądania Cloudflare (Free) — przy większych segmentach materializacja padała
	// w połowie z błędem 500. Ta sama technika co w enqueueCategoryBlast.
	const categoryId = campaign.category_id as string;
	const queuedRows: Record<string, unknown>[] = [];
	const skippedRows: Record<string, unknown>[] = [];
	for (const company of companies) {
		if (already.has(company.id)) continue;

		const { email, reason } = recipientGate(company, blocked, seen);
		const status: 'queued' | 'skipped' = reason === null ? 'queued' : 'skipped';

		const row = {
			campaign_id: campaignId,
			category_id: categoryId,
			company_id: company.id,
			to_email: email || '(brak)',
			source: 'campaign',
			variables_json: companyVariables(company),
			rodo_snapshot: company.rodo ?? null,
			status,
			error: reason
		};
		if (status === 'queued') queuedRows.push(row);
		else skippedRows.push(row);
	}

	const CHUNK = 500;

	// Pominięte: bez snapshotu załączników.
	let skipped = 0;
	for (let i = 0; i < skippedRows.length; i += CHUNK) {
		const slice = skippedRows.slice(i, i + CHUNK);
		const { error: insErr } = await db.from('email_messages').insert(slice);
		if (insErr) throw new Error(`email_messages insert: ${insErr.message}`);
		skipped += slice.length;
	}

	// W kolejce: wstaw wiadomości i dopnij snapshot domyślnych załączników kategorii.
	let queued = resumedRows?.length ?? 0;
	const assetIds = await categoryAssetIds(db, categoryId);
	for (let i = 0; i < queuedRows.length; i += CHUNK) {
		const slice = queuedRows.slice(i, i + CHUNK);
		const { data: inserted, error: insErr } = await db
			.from('email_messages')
			.insert(slice)
			.select('id');
		if (insErr) throw new Error(`email_messages insert: ${insErr.message}`);
		queued += inserted?.length ?? 0;
		if (assetIds.length > 0 && inserted && inserted.length > 0) {
			const attachRows = inserted.flatMap((m) =>
				assetIds.map((assetId) => ({ message_id: m.id as string, asset_id: assetId }))
			);
			for (let j = 0; j < attachRows.length; j += CHUNK) {
				const { error: attErr } = await db
					.from('email_attachments')
					.insert(attachRows.slice(j, j + CHUNK));
				if (attErr) throw new Error(`email_attachments insert: ${attErr.message}`);
			}
		}
	}

	return { queued, skipped };
}

/** Limity dzienne liczymy od północy w Warszawie, nie w UTC (Cloudflare liczy w UTC). */
function startOfTodayIso(): string {
	return startOfWarsawDayIso();
}

export interface DailySendStatus {
	limit: number;
	sentToday: number;
	queuedCampaign: number;
	/** Ile z dziennego limitu zostaje po odjęciu już wysłanych dziś maili. */
	remaining: number;
	/** Ile realnie zostaje na wysyłkę wg kategorii po rezerwacji dla kampanii. */
	availableForCategories: number;
}

/** Bieżące wykorzystanie dziennego limitu wysyłki (kampanie mają pierwszeństwo). */
export async function dailySendStatus(db: SupabaseClient): Promise<DailySendStatus> {
	const [sentRes, queuedRes] = await Promise.all([
		db
			.from('email_messages')
			.select('id', { count: 'exact', head: true })
			.eq('status', 'sent')
			.gte('sent_at', startOfTodayIso()),
		db
			.from('email_messages')
			.select('id', { count: 'exact', head: true })
			.in('status', ['queued', 'sending'])
			.not('campaign_id', 'is', null)
	]);
	const sentToday = sentRes.count ?? 0;
	const queuedCampaign = queuedRes.count ?? 0;
	const remaining = Math.max(0, DAILY_SEND_LIMIT - sentToday);
	return {
		limit: DAILY_SEND_LIMIT,
		sentToday,
		queuedCampaign,
		remaining,
		availableForCategories: Math.max(0, remaining - queuedCampaign)
	};
}

export interface CategoryBlastResult {
	code: string;
	name: string;
	matched: number;
	enqueued: number;
	skippedNoConsent: number;
	skippedBadEmail: number;
	/** Kontakt (albo ten sam adres na innej karcie CRM) był już obsłużony w tej kategorii. */
	skippedDuplicate: number;
	/** Adres z twardym odbiciem albo skargą na spam. */
	skippedBlocked: number;
}

/**
 * Kolejkuje wysyłkę „do wszystkich" dla jednej kategorii: tworzy niekampanijne
 * wiadomości (source='quick_send', status='queued') dla kontaktów z tej kategorii,
 * które mają poprawny e-mail i zgodę RODO, a nie były jeszcze obsłużone. Realną
 * wysyłką — z limitem dziennym i priorytetem kampanii — zajmuje się processQueue.
 * Wstawianie hurtowe (chunk), by zmieścić się w limitach żądania serverless.
 */
export async function enqueueCategoryBlast(
	db: SupabaseClient,
	categoryId: string
): Promise<CategoryBlastResult> {
	const { data: category, error: catErr } = await db
		.from('email_categories')
		.select('*')
		.eq('id', categoryId)
		.eq('active', true)
		.maybeSingle();
	if (catErr) throw new Error(`email_categories: ${catErr.message}`);
	if (!category) throw new Error('Nie znaleziono aktywnej kategorii');
	const code = category.code as string;

	const [rows, blocked] = await Promise.all([
		fetchAllRows<CrmCompany>(
			(from, to) => db.from('crm_companies').select(COMPANY_COLUMNS).order('id').range(from, to),
			'crm_companies'
		),
		loadBlockedEmails(db)
	]);
	const companies = rows.filter((c) => normalizeInterest(c.ubezpieczenie) === code);

	// Kontakty już obsłużone w tej kategorii: wysłane lub czekające w kolejce.
	// Ta lista decyduje, komu NIE wysyłamy ponownie. Przycięta do db_max_rows
	// oznaczałaby duplikaty maili, więc czytamy ją stronami.
	const existing = await fetchAllRows<{ company_id: number; to_email: string }>(
		(from, to) =>
			db
				.from('email_messages')
				.select('company_id, to_email')
				.eq('category_id', categoryId)
				.not('company_id', 'is', null)
				.in('status', ['queued', 'sending', 'sent'])
				.order('id')
				.range(from, to),
		'email_messages'
	);
	const handled = new Set(existing.map((r) => r.company_id));
	const seen = new Set(existing.map((r) => normalizeEmail(r.to_email)));

	const result: CategoryBlastResult = {
		code,
		name: category.name as string,
		matched: companies.length,
		enqueued: 0,
		skippedNoConsent: 0,
		skippedBadEmail: 0,
		skippedDuplicate: 0,
		skippedBlocked: 0
	};

	const toInsert: Record<string, unknown>[] = [];
	for (const c of companies) {
		if (handled.has(c.id)) {
			result.skippedDuplicate++;
			continue;
		}
		const { email, reason } = recipientGate(c, blocked, seen);
		if (reason === BLOCKED_REASON) result.skippedBlocked++;
		else if (reason === DUPLICATE_REASON) result.skippedDuplicate++;
		else if (reason?.startsWith('Brak zgody')) result.skippedNoConsent++;
		else if (reason) result.skippedBadEmail++;
		if (reason) continue;
		toInsert.push({
			campaign_id: null,
			category_id: categoryId,
			company_id: c.id,
			to_email: email,
			source: 'quick_send',
			variables_json: companyVariables(c),
			rodo_snapshot: c.rodo ?? null,
			status: 'queued'
		});
	}

	if (toInsert.length === 0) return result;

	const assetIds = await categoryAssetIds(db, categoryId);
	const CHUNK = 500;
	for (let i = 0; i < toInsert.length; i += CHUNK) {
		const slice = toInsert.slice(i, i + CHUNK);
		const { data: inserted, error: insErr } = await db
			.from('email_messages')
			.insert(slice)
			.select('id');
		if (insErr) throw new Error(`email_messages insert: ${insErr.message}`);
		result.enqueued += inserted?.length ?? 0;
		if (assetIds.length > 0 && inserted && inserted.length > 0) {
			const attachRows = inserted.flatMap((m) =>
				assetIds.map((assetId) => ({ message_id: m.id as string, asset_id: assetId }))
			);
			const { error: attErr } = await db.from('email_attachments').insert(attachRows);
			if (attErr) throw new Error(`email_attachments insert: ${attErr.message}`);
		}
	}
	return result;
}

/** Dobowy limit maili wysyłanych automatem (osobny od kampanii/ręcznych). */
export const AUTO_SEND_DAILY_LIMIT = Number(env.AUTO_SEND_DAILY_LIMIT ?? '') || 100;
/**
 * Automat odpowiada wyłącznie na świeże zapisy. Mail powitalny po miesiącu jest
 * bardziej dziwny niż pomocny, a okno ogranicza też, ile CRM czytamy co minutę.
 */
const AUTO_SEND_MAX_AGE_DAYS = Number(env.AUTO_SEND_MAX_AGE_DAYS ?? '') || 14;

export interface AutoSendResult {
	enqueued: number;
	perCategory: Record<string, number>;
	/** Wyczerpany dobowy limit automatu. */
	limitReached?: boolean;
}

/**
 * Automatyczna wysyłka: kolejkuje NOWE zapisy dla sekcji z auto_send = true.
 * Bierze wyłącznie kontakty zapisane po `auto_send_since` (data odcięcia) i nie
 * starsze niż AUTO_SEND_MAX_AGE_DAYS, z poprawnym e-mailem i zgodą RODO, które nie
 * były jeszcze obsłużone w tej sekcji. Respektuje dobowy limit automatu.
 */
export async function enqueueAutoSend(db: SupabaseClient): Promise<AutoSendResult> {
	const result: AutoSendResult = { enqueued: 0, perCategory: {} };

	const { data: cats, error: catErr } = await db
		.from('email_categories')
		.select('id, code, auto_send_since')
		.eq('active', true)
		.eq('auto_send', true);
	if (catErr) throw new Error(`email_categories: ${catErr.message}`);
	// Brak daty odcięcia = nie ryzykujemy wysyłki do całej bazy.
	const active = (cats ?? []).filter((c) => Boolean(c.auto_send_since));
	if (active.length === 0) return result;

	// Dobowy limit automatu — liczony na wiadomościach zakolejkowanych dziś przez automat.
	const { count: autoToday } = await db
		.from('email_messages')
		.select('id', { count: 'exact', head: true })
		.eq('source', 'auto')
		.gte('created_at', startOfTodayIso());
	let budget = Math.max(0, AUTO_SEND_DAILY_LIMIT - (autoToday ?? 0));
	if (budget <= 0) return { ...result, limitReached: true };

	// Czytamy tylko kandydatów z okna czasowego, filtrem po stronie bazy. Wcześniej
	// `.limit(20000)` bez sortowania zwracało przypadkowe 1000 z całej bazy
	// (db_max_rows), więc część nowych zapisów automat po prostu nie widział.
	const windowStartMs = Date.now() - AUTO_SEND_MAX_AGE_DAYS * 86_400_000;
	const earliestSinceMs = Math.min(...active.map((c) => Date.parse(c.auto_send_since as string)));
	const fromIso = new Date(Math.max(windowStartMs, earliestSinceMs)).toISOString();
	const companies = await fetchAllRows<
		CrmCompany & { created_at: string | null; data_zgloszenia: string | null }
	>(
		(from, to) =>
			db
				.from('crm_companies')
				.select(`${COMPANY_COLUMNS}, created_at, data_zgloszenia`)
				.or(`created_at.gt."${fromIso}",data_zgloszenia.gt."${fromIso}"`)
				.order('id')
				.range(from, to),
		'crm_companies (automat)'
	);
	if (companies.length === 0) return result;

	const blocked = await loadBlockedEmails(db);

	for (const cat of active) {
		if (budget <= 0) {
			result.limitReached = true;
			break;
		}
		const categoryId = cat.id as string;
		const code = cat.code as string;
		const sinceMs = Math.max(Date.parse(cat.auto_send_since as string), windowStartMs);

		const candidates = companies.filter((c) => {
			if (normalizeInterest(c.ubezpieczenie) !== code) return false;
			const signedUp = Date.parse(c.data_zgloszenia ?? c.created_at ?? '');
			return Number.isFinite(signedUp) && signedUp > sinceMs;
		});
		if (candidates.length === 0) continue;

		// Obsłużony = jakakolwiek wcześniejsza wiadomość tej sekcji poza pominiętą,
		// także nieudana albo odbita. Inaczej każdy przebieg crona kolejkowałby
		// odbity adres od nowa. Sprawdzamy po karcie CRM i po adresie.
		const emails = [...new Set(candidates.map((c) => (c.email ?? '').trim()).filter(Boolean))];
		const [byCompany, byEmail] = await Promise.all([
			db
				.from('email_messages')
				.select('company_id, to_email')
				.eq('category_id', categoryId)
				.neq('status', 'skipped')
				.in('company_id', candidates.map((c) => c.id)),
			emails.length > 0
				? db
						.from('email_messages')
						.select('company_id, to_email')
						.eq('category_id', categoryId)
						.neq('status', 'skipped')
						.in('to_email', emails)
				: Promise.resolve({ data: [], error: null })
		]);
		if (byCompany.error) throw new Error(`email_messages (automat): ${byCompany.error.message}`);
		if (byEmail.error) throw new Error(`email_messages (automat): ${byEmail.error.message}`);
		const handledRows = [...(byCompany.data ?? []), ...(byEmail.data ?? [])] as {
			company_id: number | null;
			to_email: string;
		}[];
		const handled = new Set(handledRows.map((r) => r.company_id));
		const seen = new Set(handledRows.map((r) => normalizeEmail(r.to_email)));

		const toInsert: Record<string, unknown>[] = [];
		for (const c of candidates) {
			if (budget - toInsert.length <= 0) break;
			if (handled.has(c.id)) continue;
			const { email, reason } = recipientGate(c, blocked, seen);
			if (reason) continue;

			toInsert.push({
				campaign_id: null,
				category_id: categoryId,
				company_id: c.id,
				to_email: email,
				source: 'auto',
				variables_json: companyVariables(c),
				rodo_snapshot: c.rodo ?? null,
				status: 'queued'
			});
		}
		if (toInsert.length === 0) continue;

		const assetIds = await categoryAssetIds(db, categoryId);
		const { data: inserted, error: insErr } = await db
			.from('email_messages')
			.insert(toInsert)
			.select('id');
		if (insErr) throw new Error(`email_messages insert: ${insErr.message}`);
		const added = inserted?.length ?? 0;
		if (assetIds.length > 0 && inserted && inserted.length > 0) {
			const attachRows = inserted.flatMap((m) =>
				assetIds.map((assetId) => ({ message_id: m.id as string, asset_id: assetId }))
			);
			const { error: attErr } = await db.from('email_attachments').insert(attachRows);
			if (attErr) throw new Error(`email_attachments insert: ${attErr.message}`);
		}
		result.perCategory[code] = added;
		result.enqueued += added;
		budget -= added;
	}

	return result;
}

/**
 * Odzyskiwanie zawieszonych wiadomości: jeśli funkcja padnie po przejęciu maila
 * (status 'sending'), nikt go już nie podniesie — claimMessage bierze tylko 'queued'.
 *
 * Awaria mogła nastąpić PO przyjęciu maila przez Resend, dlatego wracamy z oddaną
 * próbą: kolejne przejęcie dostaje ten sam numer próby, więc ten sam klucz
 * idempotencji, a Resend zamiast drugiego maila zwraca pierwotną odpowiedź.
 * Klucz żyje 24 h — starszych zawieszonych nie ponawiamy, tylko oznaczamy do
 * ręcznego sprawdzenia.
 */
async function reviveStuckMessages(db: SupabaseClient): Promise<void> {
	const staleBefore = new Date(Date.now() - STALE_SENDING_MINUTES * 60_000).toISOString();
	const { data: stuck, error } = await db
		.from('email_messages')
		.select('id, attempts, claimed_at')
		.eq('status', 'sending')
		.or(`claimed_at.is.null,claimed_at.lt."${staleBefore}"`)
		.limit(50);
	if (error) {
		console.error(`odzyskiwanie zawieszonych: ${error.message}`);
		return;
	}
	if (!stuck || stuck.length === 0) return;

	const unsafeBefore = Date.now() - IDEMPOTENCY_SAFE_HOURS * 3_600_000;
	for (const row of stuck) {
		const claimedMs = row.claimed_at ? Date.parse(row.claimed_at as string) : NaN;
		const update =
			Number.isFinite(claimedMs) && claimedMs > unsafeBefore
				? { status: 'queued', attempts: Math.max(0, (row.attempts as number) - 1) }
				: {
						status: 'failed',
						error: 'Niepewny stan po awarii wysyłki — sprawdź w Resend, czy mail wyszedł'
					};
		await db.from('email_messages').update(update).eq('id', row.id).eq('status', 'sending');
	}
	console.warn(`odzyskano ${stuck.length} zawieszonych wiadomości z 'sending'`);
}

/**
 * Domyka kampanie w stanie 'sending', którym nie została żadna wiadomość
 * w kolejce: 'sent', gdy cokolwiek wyszło, inaczej 'failed'. Bez tego kampania
 * z samymi pominiętymi odbiorcami wisiała „w trakcie wysyłki” na zawsze.
 */
export async function closeFinishedCampaigns(db: SupabaseClient): Promise<void> {
	const { data: open } = await db.from('email_campaigns').select('id').eq('status', 'sending');
	for (const campaign of open ?? []) {
		const { count } = await db
			.from('email_messages')
			.select('id', { count: 'exact', head: true })
			.eq('campaign_id', campaign.id)
			.in('status', ['queued', 'sending']);
		if ((count ?? 0) > 0) continue;
		const { count: sentCount } = await db
			.from('email_messages')
			.select('id', { count: 'exact', head: true })
			.eq('campaign_id', campaign.id)
			.in('status', ['sent', 'bounced']);
		await db
			.from('email_campaigns')
			.update({ status: (sentCount ?? 0) > 0 ? 'sent' : 'failed' })
			.eq('id', campaign.id)
			.eq('status', 'sending');
	}
}

export interface ProcessResult {
	processed: number;
	sent: number;
	failed: number;
	requeued: number;
	/** Osiągnięto dzienny limit wysyłki (dalsza wysyłka wznowi się jutro). */
	dailyLimitReached?: boolean;
	/** Resend odpowiedział 429 — partię przerwano, reszta pójdzie w kolejnym przebiegu. */
	rateLimited?: boolean;
}

/**
 * Przetwarza partię kolejki (wywoływane przez cron Workera lub ręcznie z panelu).
 * Wysyłka pojedynczo z throttlingiem pod limity Resend; nieudane wracają do
 * kolejki do wyczerpania prób (MAX_ATTEMPTS), potem status 'failed'.
 */
export async function processQueue(
	db: SupabaseClient,
	origin: string,
	limit = 20
): Promise<ProcessResult> {
	// Rozmiar partii ogranicza limit subrequestów Cloudflare (jeden mail to ~8–10:
	// odczyty, pobranie załączników ze Storage, wywołanie Resend, zapis statusu, wpis
	// do historii). Plan Workers Paid daje 1000 subrequestów, więc 20/uruchomienie jest
	// bezpieczne. Na planie Free (50) ustaw env QUEUE_BATCH_SIZE=4.
	const batchCap = Number(env.QUEUE_BATCH_SIZE ?? '') || 20;
	limit = Math.min(limit, batchCap);

	await reviveStuckMessages(db);

	// Automat: kolejkujemy nowe zapisy przy każdym przebiegu, więc nowy zapis dostaje
	// maila w ciągu ~minuty niezależnie od stanu kolejki. Błąd automatu nie może
	// przewrócić wysyłki, stąd try/catch.
	try {
		await enqueueAutoSend(db);
	} catch (e) {
		console.error(`auto-send: ${e instanceof Error ? e.message : String(e)}`);
	}

	// Uruchom zaplanowane kampanie, którym minął termin. Błąd jednej kampanii
	// nie może zablokować wysyłki pozostałych.
	const { data: due } = await db
		.from('email_campaigns')
		.select('id')
		.eq('status', 'scheduled')
		.lte('scheduled_at', new Date().toISOString());
	for (const campaign of due ?? []) {
		try {
			await materializeCampaign(db, campaign.id as string);
			await db
				.from('email_campaigns')
				.update({ status: 'sending' })
				.eq('id', campaign.id)
				.eq('status', 'scheduled');
		} catch (e) {
			console.error(`start kampanii ${campaign.id}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	const result: ProcessResult = { processed: 0, sent: 0, failed: 0, requeued: 0 };

	// Dzienny limit — liczony na realnie wysłanych dziś (doba warszawska) mailach.
	const sentTodayRes = await db
		.from('email_messages')
		.select('id', { count: 'exact', head: true })
		.eq('status', 'sent')
		.gte('sent_at', startOfTodayIso());
	const sentToday = sentTodayRes.count ?? 0;
	const budget = Math.max(0, DAILY_SEND_LIMIT - sentToday);
	const effectiveLimit = Math.min(limit, budget);
	if (effectiveLimit <= 0) {
		await closeFinishedCampaigns(db);
		return { ...result, dailyLimitReached: true };
	}

	// Kolejność: automat (odpowiedź na świeży zapis, mały wolumen, liczy się czas),
	// potem kampanie, na końcu wysyłka „do wszystkich” wg kategorii. Wcześniej automat
	// stał za całą kampanią i powitanie przychodziło po kilku godzinach.
	const lanes: ((q: ReturnType<typeof queuedQuery>) => ReturnType<typeof queuedQuery>)[] = [
		(q) => q.eq('source', 'auto'),
		(q) => q.not('campaign_id', 'is', null),
		(q) => q.is('campaign_id', null).neq('source', 'auto')
	];
	function queuedQuery() {
		return db
			.from('email_messages')
			.select('id, campaign_id')
			.eq('status', 'queued')
			.order('created_at', { ascending: true });
	}
	const batch: { id: string; campaign_id: string | null }[] = [];
	for (const lane of lanes) {
		const slots = effectiveLimit - batch.length;
		if (slots <= 0) break;
		const { data, error } = await lane(queuedQuery()).limit(slots);
		if (error) throw new Error(`kolejka: ${error.message}`);
		batch.push(...((data ?? []) as { id: string; campaign_id: string | null }[]));
	}

	for (const [index, row] of batch.entries()) {
		if (index > 0) await sleep(SEND_DELAY_MS);
		const outcome = await sendMessageNow(db, row.id, origin);
		if (outcome.skipped) continue;
		result.processed++;
		if (outcome.ok) result.sent++;
		else if (outcome.rateLimited) {
			result.requeued++;
			result.rateLimited = true;
			break;
		} else {
			const { data: after } = await db
				.from('email_messages')
				.select('status')
				.eq('id', row.id)
				.single();
			if (after?.status === 'failed') result.failed++;
			else result.requeued++;
		}
	}

	await closeFinishedCampaigns(db);

	result.dailyLimitReached = sentToday + result.sent >= DAILY_SEND_LIMIT;
	return result;
}

export interface QueueHealth {
	/** Wiadomości czekające w kolejce (wszystkie źródła). */
	queued: number;
	/** Ostatnie przejęcie wiadomości do wysyłki (cron, przycisk albo szybka wysyłka). */
	lastActivityAt: string | null;
	/** Kolejka nie jest pusta, a od ponad STALL_MINUTES nikt nic z niej nie wziął. */
	stalled: boolean;
	/** Szacowany czas opróżnienia kolejki przy działającym cronie (minuty). */
	etaMinutes: number;
}

/** Ile minut bez ruchu przy niepustej kolejce uznajemy za awarię crona. */
const STALL_MINUTES = 10;
/** Przepustowość crona: partia co minutę (workers/queue-cron/wrangler.toml). */
const CRON_RUNS_PER_HOUR = 60;

/**
 * Stan silnika wysyłki do pokazania w panelu. Bez tego jedyną oznaką martwego
 * crona była kampania, która „sama z siebie” przestawała iść.
 */
export async function queueHealth(db: SupabaseClient): Promise<QueueHealth> {
	const [queuedRes, lastRes] = await Promise.all([
		db.from('email_messages').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
		db
			.from('email_messages')
			.select('claimed_at')
			.not('claimed_at', 'is', null)
			.order('claimed_at', { ascending: false })
			.limit(1)
			.maybeSingle()
	]);
	const queued = queuedRes.count ?? 0;
	const lastActivityAt = (lastRes.data?.claimed_at as string | null | undefined) ?? null;
	const lastMs = lastActivityAt ? Date.parse(lastActivityAt) : 0;
	const batchCap = Number(env.QUEUE_BATCH_SIZE ?? '') || 20;
	return {
		queued,
		lastActivityAt,
		stalled: queued > 0 && Date.now() - lastMs > STALL_MINUTES * 60_000,
		etaMinutes: Math.ceil((queued / (batchCap * CRON_RUNS_PER_HOUR)) * 60)
	};
}
