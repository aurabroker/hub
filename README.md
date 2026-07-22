# Aura HUB

Wewnętrzny panel do zarządzania i wysyłki spersonalizowanych maili do kontaktów z CRM
(`crm_companies`), z załącznikami per odbiorca, analityką zapisów/zainteresowań, szybką
ścieżką 1-do-1 i biblioteką załączników wielokrotnego użytku.

**Stack:** SvelteKit (Svelte 5, runes) · Cloudflare (Pages + Worker cron) · Supabase
(Postgres, Storage, Auth) · Resend (API + Templates + webhooki).

- **Produkcja (on-line):** https://hub.auraexpert.pl (Cloudflare Pages).
- **Wersja produkcyjna / działająca:** commit `b1bcabd`. To jest wersja przywrócona jako
  produkcyjna — czyta bazę klientów z tabeli `crm_companies` (spójnie z resztą HUB).
- **Baza klientów:** dane CRM (`crm_companies`) znajdują się w projekcie **BEAUTY** w Supabase.
  HUB tylko z niej czyta — nie modyfikuje struktury tej bazy.

> ## ⛔ Autoryzacja i weryfikacja Supabase — NIE ZMIENIAĆ
>
> Autoryzacja oraz weryfikacja użytkowników w Supabase **działa poprawnie**. Wcześniejszy
> problem z weryfikacją Supabase został **rozwiązany**.
>
> **Nie wolno wprowadzać żadnych zmian w warstwie autoryzacji/weryfikacji Supabase.**
> Nie ma uprawnień do modyfikacji tego obszaru. Dotyczy to w szczególności:
>
> - konfiguracji Supabase **Auth** (providerzy, ustawienia weryfikacji/potwierdzeń, JWT, sesje),
> - logiki logowania i bramkowania dostępu w `src/hooks.server.ts`
>   (`supabase.auth.getUser()`, RPC `is_platform_admin`, przekierowania na `/login`),
> - funkcji/uprawnień `public.is_platform_admin()` oraz reguł RLS decydujących o dostępie,
> - kluczy i zmiennych środowiskowych Supabase (`PUBLIC_SUPABASE_URL`,
>   `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` / alias `SERVICE_ROLE`).
>
> To wszystko **działa** i pozostaje bez zmian.

## Dostęp

Panel dostępny wyłącznie dla administratorów platformy
(`public.is_platform_admin()` → `profiles.account_type in ('super_admin','support_admin')`).
Niezalogowani/nieuprawnieni są przekierowywani na `/login`. Publiczne trasy (bez logowania):
`/login`, `/api/webhooks/`, `/api/cron/`, `/files/`.

## Ekrany

| Trasa | Co robi |
|---|---|
| `/` | Dashboard: kafle (kontakty, duplikaty, wysłane, open/click rate) + wykresy (zapisy/dzień, rozkład sekcji, wysyłka/dzień) |
| `/signups` | **Zapisy dzienne** — codzienne zapisy klientów do bazy CRM (`crm_companies`), grupowane po dniach; zapisy z dziś wyróżnione |
| `/clients` | **Baza Klientów** — wszystkie kontakty z `crm_companies`; klik w wiersz otwiera pełną kartę klienta |
| `/send` | **WYŚLIJ EMAIL** — szybka wysyłka 1-do-1: adres + checkboxy kategorii + SEND; każda kategoria = osobny mail z załącznikami z biblioteki |
| `/campaigns` | Kampanie masowe: kreator (segment → kategoria → podgląd), dashboard wysyłki (postęp, statusy per odbiorca, ponowienie nieudanych) |
| `/library` | Biblioteka załączników: upload do prywatnego bucketa, przypinanie do kategorii, pobieranie (signed URL), usuwanie |
| `/categories` | Konfiguracja sekcji: szablon Resend, temat, nadawca, aktywność |
| `/messages` | Log wiadomości z filtrami (status / źródło / kategoria) |
| `/duplicates` | Grupy duplikatów wg e-mail / NIP z akcją „oznacz” (nic nie jest usuwane automatycznie) |

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
jest wpis `crm_history` (`type='email'`). Migracja dotyczy wyłącznie modułu e-mail HUB —
**nie obejmuje i nie zmienia autoryzacji Supabase** (patrz sekcja powyżej).

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

1. **Domena nadawcza:** zweryfikuj SPF/DKIM/DMARC (Domains).
2. **Śledzenie otwarć i kliknięć (Open & Click Tracking) — wymaga DWÓCH kroków, nie jednego:**
   - włącz przełącznik trackingu dla domeny (Domains → domena → Configuration →
     *Enable tracking metrics*), **oraz**
   - **skonfiguruj i zweryfikuj subdomenę trackingową** (np. `links.auraexpert.pl`):
     dodaj rekord **CNAME** w DNS, a jeśli na domenie są rekordy **CAA** — także wpis CAA
     (potrzebny do wydania certyfikatu TLS dla subdomeny).

   > ⚠️ **Bez zweryfikowanej subdomeny trackingowej Resend nie wstrzykuje piksela otwarcia,
   > więc zdarzenia `email.opened` w ogóle nie powstają** — sam przełącznik to za mało.
   > Tracking działa **per-domena**; API `POST /emails` nie ma pola `track_opens` — nie da
   > się go włączyć per-wiadomość z poziomu kodu.
3. Utwórz szablony (Templates) i wpisz ich id/alias w `/categories`. W treści użyj
   zmiennych `{{firma}}`, `{{kontakt}}`, `{{miasto}}`, `{{nip}}` oraz **wbudowanej**
   `{{{UNSUBSCRIBE_URL}}}` jako linku wypisu.
4. Webhook: endpoint `POST /api/webhooks/resend`, subskrybuj `email.delivered`,
   `email.opened`, `email.clicked`, `email.bounced`, `email.complained`.
   Podpis (Svix) jest weryfikowany sekretem `RESEND_WEBHOOK_SECRET` — zdarzenia bez
   poprawnego podpisu są odrzucane.
5. Każdy mail dostaje nagłówki `List-Unsubscribe` / `List-Unsubscribe-Post`
   (`RESEND_UNSUBSCRIBE_URL`).

### Gdy otwarcia pokazują 0 (checklist diagnostyczny)

Kod (webhook → `email_messages.opened_at`) działa; „zera" w otwarciach to prawie zawsze
konfiguracja Resend. Sprawdź po kolei:

1. **Subdomena trackingowa** jest dodana i ma status *Verified* (najczęstsza przyczyna).
2. Przełącznik **Open Tracking** dla domeny jest **włączony**.
3. Webhook subskrybuje zdarzenie **`email.opened`** i endpoint zwraca 2xx (nie 401 —
   to znak, że `RESEND_WEBHOOK_SECRET` w aplikacji ≠ sekret z panelu Resend).
4. Test na skrzynce **z włączonymi obrazkami** (patrz niżej — wiele klientów je blokuje).

Uwaga: open tracking bywa niedokładny (blokowanie obrazków, prefetch, Apple Mail Privacy
Protection, przycinanie w Gmailu) — kliknięcia to pewniejszy sygnał; dashboard opisuje
otwarcia jako orientacyjne.

## RODO (wymóg twardy)

- **Zgody RODO są zebrane dla całej bazy Klientów** (potwierdzone przez właściciela
  danych). Interpretacja zgody: `hasRodoConsent(crm_companies.rodo)` w
  `src/lib/categories.ts` — puste/nieuzupełnione pole `rodo` liczy się jako zgoda;
  wykluczany jest **wyłącznie wyraźny sprzeciw** (`nie`, `false`, `0`, `brak`,
  `sprzeciw`, …, patrz `RODO_REFUSED`). Kontakt ze sprzeciwem → `skipped`.
- Bramka RODO obowiązuje tak samo dla kampanii masowych i dla wysyłki „do wszystkich"
  wg kategorii (`/clients/kategorie`).
- Surowa wartość pola `rodo` z momentu wysyłki jest zapisywana w
  `email_messages.rodo_snapshot` (audyt) — niezależnie od interpretacji.
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

> Uwaga do wdrożeń: przywracanie/aktualizacja produkcji dotyczy **wyłącznie kodu aplikacji**.
> Konfiguracja **autoryzacji i weryfikacji Supabase pozostaje nietknięta** (patrz sekcja
> „Autoryzacja i weryfikacja Supabase — NIE ZMIENIAĆ").
