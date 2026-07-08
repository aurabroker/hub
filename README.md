# Aura HUB

Wewnętrzny panel do zarządzania i wysyłki spersonalizowanych maili do kontaktów z CRM
(`crm_companies`), z załącznikami per odbiorca, analityką zapisów/zainteresowań, szybką
ścieżką 1-do-1 i biblioteką załączników wielokrotnego użytku.

**Stack:** SvelteKit (Svelte 5, runes) · Cloudflare (Pages + Worker cron) · Supabase
(Postgres, Storage, Auth) · Resend (API + Templates + webhooki).

## Ekrany

| Trasa | Co robi |
|---|---|
| `/` | Dashboard: kafle (kontakty, duplikaty, wysłane, open/click rate) + wykresy (zapisy/dzień, rozkład sekcji, wysyłka/dzień) |
| `/send` | **WYŚLIJ EMAIL** — szybka wysyłka 1-do-1: adres + checkboxy kategorii + SEND; każda kategoria = osobny mail z załącznikami z biblioteki |
| `/campaigns` | Kampanie masowe: kreator (segment → kategoria → podgląd), dashboard wysyłki (postęp, statusy per odbiorca, ponowienie nieudanych) |
| `/library` | Biblioteka załączników: upload do prywatnego bucketa, przypinanie do kategorii, pobieranie (signed URL), usuwanie |
| `/categories` | Konfiguracja sekcji: szablon Resend, temat, nadawca, aktywność |
| `/duplicates` | Grupy duplikatów wg e-mail / NIP z akcją „oznacz” (nic nie jest usuwane automatycznie) |

Panel dostępny wyłącznie dla administratorów platformy
(`public.is_platform_admin()` → `profiles.account_type in ('super_admin','support_admin')`).

## Uruchomienie

```bash
npm install
cp .env.example .env   # uzupełnij wartości
npm run dev
```

Zmienne środowiskowe — patrz `.env.example` (nazwy zgodne ze specyfikacją; bez kluczy w kodzie).
`SUPABASE_SERVICE_ROLE_KEY` i `RESEND_API_KEY` są używane wyłącznie po stronie serwera.

## Migracja Supabase

`supabase/migrations/20260708120000_aura_hub_email_module.sql` tworzy:

- tabele `email_categories`, `email_assets`, `email_category_assets`, `email_campaigns`,
  `email_messages`, `email_attachments` — wszystkie z RLS (polityki tylko dla adminów),
- funkcję `email_normalize_interest(text)` — normalizacja wolnego tekstu `ubezpieczenie`
  do kodów kanonicznych (`oc`, `konsultacja`, `tax`, `utrata_dochodu`, `zdrowie`,
  `grupowe`, `brak`, `inne`) z obsługą wariantów myślnika,
- funkcję `email_has_rodo_consent(text)` — interpretacja zgody RODO,
- widoki analityczne: `email_stats_signups_daily`, `email_duplicates_by_email`,
  `email_duplicates_by_nip`, `email_stats_interest`, `email_stats_sent_daily`,
- prywatny bucket Storage `email-assets` (ścieżki `library/{asset_id}/{filename}`),
- seed kategorii kanonicznych.

Tabele CRM (`crm_companies`, `crm_history`, …) nie są modyfikowane; po wysyłce dopisywany
jest wpis `crm_history` (`type='email'`).

## Pipeline wysyłki masowej

1. Kampania (szkic) z kategorią i segmentem (`segment_json`).
2. Start → **materializacja** `email_messages`: poprawny e-mail **i zgoda RODO** → `queued`,
   reszta → `skipped` z powodem; snapshot załączników w `email_attachments`;
   idempotencja przez unikalny indeks `(campaign_id, company_id)`.
3. Worker cron (`workers/queue-cron`) co 2 min woła `POST /api/cron/process-queue`
   (nagłówek `x-cron-secret`); endpoint wysyła partię **pojedynczo** przez Resend
   (załączniki wykluczają batch), z throttlingiem ~650 ms/mail i retry z powrotem do
   kolejki (maks. 3 próby → `failed`).
4. Zaplanowane kampanie (`scheduled_at`) uruchamia ten sam cron.
5. Partię można też przetworzyć ręcznie z dashboardu kampanii.

## Resend — konfiguracja

1. Zweryfikuj domenę nadawczą (SPF/DKIM/DMARC) i włącz open/click tracking (Domains).
2. Utwórz szablony (Templates) i wpisz ich id/alias w `/categories`. W treści użyj
   zmiennych `{{firma}}`, `{{kontakt}}`, `{{miasto}}`, `{{nip}}` oraz **wbudowanej**
   `{{{UNSUBSCRIBE_URL}}}` jako linku wypisu.
3. Webhook: endpoint `POST /api/webhooks/resend`, subskrybuj `email.delivered`,
   `email.opened`, `email.clicked`, `email.bounced`, `email.complained`.
   Podpis (Svix) jest weryfikowany sekretem `RESEND_WEBHOOK_SECRET` — zdarzenia bez
   poprawnego podpisu są odrzucane.
4. Każdy mail dostaje nagłówki `List-Unsubscribe` / `List-Unsubscribe-Post`
   (`RESEND_UNSUBSCRIBE_URL`).

Uwaga: open tracking bywa niedokładny (blokowanie obrazków, prefetch, przycinanie
w Gmailu) — kliknięcia to pewniejszy sygnał; dashboard opisuje otwarcia jako orientacyjne.

## RODO (wymóg twardy)

- Wysyłka masowa idzie **wyłącznie** do kontaktów ze spełnioną zgodą
  (`email_has_rodo_consent(crm_companies.rodo)`); brak zgody → `skipped`.
- Status zgody w momencie wysyłki jest zapisywany w `email_messages.rodo_snapshot` (audyt).
- **Stan obecny bazy:** pole `rodo` jest puste we wszystkich rekordach, więc kampania
  masowa pominie wszystkich odbiorców, dopóki zgody nie zostaną uzupełnione w CRM —
  kreator kampanii pokazuje to w podglądzie. Zakres zgód potwierdźcie z osobą
  odpowiedzialną za RODO.
- Szybka wysyłka 1-do-1 jest inicjowana ręcznie przez operatora; również zawiera link
  wypisu i jest logowana.

## Limity i pułapki

- Cała wiadomość ≤ 40 MB; Base64 dokłada ~33% → bezpieczny łączny rozmiar załączników
  ~28 MB (pilnowane przy uploadzie i przed wysyłką).
- Załączniki działają tylko przy wysyłce pojedynczej (nie batch) — stąd kolejka.
- Pliki z prywatnego bucketa idą w mailu jako `content` (Base64), bez publicznych linków.
- Analityka i segmentacja liczą na kodach kanonicznych, nie na surowym `ubezpieczenie`.

## Deploy (Cloudflare)

1. Aplikacja: Cloudflare Pages z adapterem `@sveltejs/adapter-cloudflare`;
   ustaw zmienne środowiskowe z `.env.example` w projekcie Pages.
2. Cron: `cd workers/queue-cron && wrangler deploy`, ustaw `HUB_URL` w `wrangler.toml`
   i sekret `wrangler secret put QUEUE_CRON_SECRET` (ta sama wartość co w aplikacji).
