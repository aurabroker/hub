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
| `/utm` | **Generator linków UTM** — budowanie otagowanych linków ze słowników, biblioteka linków, krótkie linki `/l/{slug}` z licznikiem kliknięć, kody QR, skracanie w Bitly |
| `/utm/slowniki` | Serwisy Aura i kanoniczne wartości `utm_*` |
| `/utm/raport` | Skuteczność kampanii: kliknięcia (własne + Bitly) zestawione z leadami |

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

## Moduł UTM

Zakładka `/utm` generuje linki do naszych serwisów z parametrami `utm_*`, żeby dało się
policzyć, skąd faktycznie przychodzą leady. Migracja
`supabase/migrations/20260903120000_utm_module.sql` tworzy:

- tabele `utm_destinations` (serwisy), `utm_presets` (słowniki wartości), `utm_links`
  (wygenerowane linki), `utm_clicks` (kliknięcia własnego przekierowania),
  `utm_attributions` (źródło leada) — wszystkie z RLS (polityki tylko dla adminów),
- funkcję `public.utm_slugify(text)` — normalizacja wartości parametru (polskie znaki na
  ASCII, małe litery, spacje na myślnik); jej bliźniak w TypeScript to `slugifyUtm`
  w `src/lib/utm.ts` i **obie muszą dawać ten sam wynik**,
- widoki `utm_link_stats` (kliknięcia w oknach 7/30 dni) oraz `utm_campaign_performance`
  (kliknięcia zestawione z leadami),
- seed serwisów (auraexpert.pl, auraconsulting.pl, utratadochodu.pl, grupowe.pro,
  gwarancje.pro, rozwod.waw.pl) i słowników źródeł/mediów.

Tabele CRM nie są modyfikowane. `utm_attributions.company_id` celowo **nie ma klucza
obcego** do `crm_companies` — moduł nie zakłada żadnego więzu na tabelach CRM.

### Dwie drogi na stronę, dwa liczniki

| Droga | Adres | Kto liczy kliknięcia |
|---|---|---|
| Własne przekierowanie | `hub.auraexpert.pl/l/{slug}` | HUB, tabela `utm_clicks`, bez limitu |
| Skrót Bitly | `bit.ly/…` (lub własna domena) | Bitly; do HUB trafiają przyciskiem „Statystyki Bitly” |

Krótki link Bitly celuje **prosto w adres docelowy**, więc jego kliknięcia nie przechodzą
przez `/l/`. Bez synchronizacji raport pokazywałby dla takich linków zero.

Skracanie w Bitly jest zawsze świadomym kliknięciem, nigdy automatem — plan Starter ma
**50 linków na miesiąc**, a licznik zużycia widać nad listą linków. Bez `BITLY_TOKEN`
przycisk jest ukryty; krótki link można wtedy wkleić ręcznie w edycji linku.

Trasa `/l/{slug}` jest publiczna (prefiks dodany w `src/hooks.server.ts`). Linki
zarchiwizowane nadal przekierowują — raz wydrukowana ulotka nie przestaje działać, bo
ktoś schował link w panelu.

### Automatyczne UTM-y w mailach

Przy wysyłce linki w treści dostają `utm_source=email`, `utm_medium=email`,
`utm_campaign` = kod sekcji, `utm_content` = nazwa kampanii masowej (albo
`szybka-wysylka`). Linki, które już mają `utm_source`, zostają nietknięte — ręcznie
wklejony link z biblioteki UTM ma pierwszeństwo.

> ⚠️ Działa to **tylko dla sekcji z własną treścią HTML** (`email_categories.html_body`,
> czyli treść z Edytora e-mail). Sekcje oparte o hostowany szablon Resend mają treść po
> stronie Resend — tam parametry `utm_*` trzeba wpisać ręcznie w szablonie.

### Atrybucja leadów — co trzeba zrobić na landingach

Tabela `utm_attributions` sama się nie napełni. Endpoint `POST /api/webhooks/utm-attribution`
przyjmuje dane z **backendu landingu**, chroniony nagłówkiem `x-utm-secret`
(wartość `UTM_INGEST_SECRET`).

Endpoint **świadomie nie ma CORS** — nie wolno wołać go z JavaScriptu w przeglądarce,
bo sekret byłby jawny dla każdego, kto otworzy podgląd źródła, i każdy mógłby zaśmiecić
raport. Landing ma przekazać parametry UTM do swojego backendu razem z formularzem,
a backend wywołuje ten endpoint.

Krok 1 — na landingu zapamiętaj parametry przy wejściu i dołóż je do formularza:

```html
<script>
  const q = new URLSearchParams(location.search);
  const keys = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid'];
  if (keys.some((k) => q.has(k))) {
    sessionStorage.setItem('aura_utm', JSON.stringify({
      ...Object.fromEntries(keys.filter((k) => q.has(k)).map((k) => [k, q.get(k)])),
      landing_url: location.href,
      referrer: document.referrer,
      first_seen_at: new Date().toISOString()
    }));
  }
  // przed wysłaniem formularza wstaw zawartość sessionStorage w ukryte pole „utm"
</script>
```

Krok 2 — backend landingu, po zapisaniu leada, woła HUB:

```
POST https://hub.auraexpert.pl/api/webhooks/utm-attribution
x-utm-secret: <UTM_INGEST_SECRET>
content-type: application/json

{ "email": "klient@example.com", "utm_source": "facebook", "utm_medium": "cpc",
  "utm_campaign": "wiosna-2026", "utm_content": "baner-a",
  "landing_url": "https://grupowe.pro/?utm_source=facebook",
  "referrer": "https://www.facebook.com/", "slug": "abc1234" }
```

Pola opcjonalne: `company_id`, `lead_intake_id`, `slug` (slug krótkiego linku — wiąże
lead z konkretnym linkiem z biblioteki), `gclid`, `fbclid`, `first_seen_at`. Gdy
`company_id` nie zostanie podane, HUB dopina lead do kontaktu w `crm_companies` po
adresie e-mail (tabela CRM jest wyłącznie czytana).

### Kody QR

Kod QR generuje `GET /utm/qr/{id}` jako SVG (trasa pod bramką admina). Parametry:
`?cel=krotki` (domyślnie, przez `/l/` — kliknięcia liczone w HUB) albo `?cel=pelny`
(prosto na adres z UTM), `?px=` (rozmiar, 128–2048), `?pobierz=1` (wymusza pobranie).
PNG składany jest w przeglądarce z pobranego SVG.

### Prywatność

`utm_clicks.ip_hash` to SHA-256 z adresu IP **posolony** wartością `UTM_INGEST_SECRET`.
Surowy adres IP nie jest nigdzie zapisywany, a przy braku sekretu nie zapisujemy nawet
skrótu — niesolony hash adresu IPv4 jest odwracalny w kilka sekund.

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
