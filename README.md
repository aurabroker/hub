# Aura HUB

Wewnętrzny panel do zarządzania i wysyłki spersonalizowanych maili do kontaktów z CRM
(`crm_companies`), z załącznikami per odbiorca, analityką zapisów/zainteresowań, szybką
ścieżką 1-do-1 i biblioteką załączników wielokrotnego użytku.

**Stack:** SvelteKit (Svelte 5, runes; Edytor e-mail jako wyspa React 18) · Cloudflare
(Pages + Worker cron + Worker analityki z Analytics Engine i KV) · Supabase
(Postgres, Storage, Auth) · Resend (API + Templates + webhooki).

- **Produkcja (on-line):** https://hub.auraexpert.pl (Cloudflare Pages).
- **Gałąź produkcyjna:** `main`. Cloudflare Pages buduje i wdraża ostatni commit po każdym
  pushu na `main` — push na `main` jest wdrożeniem. Wdrożony commit widać pod logo
  w menu bocznym (`v{wersja} · {skrót commita}`, skrót z `CF_PAGES_COMMIT_SHA`).
  W lipcu 2026 produkcję przywrócono do commita `b1bcabd` (baza klientów czytana
  z `crm_companies`, spójnie z resztą HUB); dalsze zmiany powstały na tej podstawie.
- **Baza klientów:** dane CRM (`crm_companies`) znajdują się w projekcie **BEAUTY** w Supabase.
  HUB nie modyfikuje struktury tabel CRM. Dane zapisuje w nich tylko w dwóch miejscach:
  po wysyłce do kontaktu z CRM dopisuje wpis `crm_history` (`type='email'`), a akcja
  „oznacz” w `/duplicates` dopisuje tag `duplikat` w `crm_companies.tag` i notatkę
  w `crm_history` (`type='notatka'`).

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
`/login`, `/api/webhooks/`, `/api/cron/`, `/files/` (pliki w trybie „linki”), `/l/` (krótkie
linki UTM).

## Ekrany

| Trasa | Co robi |
|---|---|
| `/` | Dashboard: kafle (kontakty, duplikaty, wysłane, open/click rate) + wykresy (zapisy/dzień, rozkład sekcji, wysyłka/dzień) |
| `/signups` | **Zapisy dzienne** — codzienne zapisy klientów do bazy CRM (`crm_companies`), grupowane po dniach; zapisy z dziś wyróżnione |
| `/clients` | **Baza Klientów** — wszystkie kontakty z `crm_companies`; klik w wiersz otwiera pełną kartę klienta |
| `/clients/kategorie` | **Wysyłka wg kategorii** — per kategoria zapytania: liczba firm, kwalifikujących się (RODO + e-mail) i czekających w kolejce; lista firm (`/clients/kategorie/{kod}`); „Wyślij do wszystkich” kolejkuje wysyłkę z dziennym limitem, kampanie mają pierwszeństwo |
| `/send` | **WYŚLIJ EMAIL** — szybka wysyłka 1-do-1: adres + checkboxy kategorii + SEND; każda kategoria = osobny mail z załącznikami z biblioteki |
| `/email-editor` | **EDYTOR E-MAIL** — treść HTML sekcji (wyspa React, tylko w przeglądarce): drafty (`email_drafts`), upload do biblioteki, wysyłka testowa; „Zastosuj do sekcji” zapisuje `email_categories.html_body`, który ma pierwszeństwo przed szablonem Resend |
| `/campaigns` | Kampanie masowe: kreator (segment → kategoria → podgląd), dashboard wysyłki (postęp, statusy per odbiorca, ponowienie nieudanych) |
| `/sms-export` | **EKSPORT SMS (CSV)** — plik kontaktów do importu w SMSAPI (średnik, numery `48XXXXXXXXX`): filtry kategorii, bez sprzeciwu RODO, tylko komórki, deduplikacja; podgląd przed pobraniem |
| `/library` | Biblioteka załączników: upload do prywatnego bucketa, przypinanie do kategorii, pobieranie (signed URL), usuwanie |
| `/categories` | Konfiguracja sekcji: szablon Resend, temat, nadawca, tryb plików (załączniki albo linki do pobrania), aktywność, dodawanie sekcji oraz **automat** — wysyłka do nowych zapisów sekcji od daty startu `auto_send_since` (puste = od włączenia; starsza baza jest pomijana) |
| `/messages` | **Historia wysyłek** — log wiadomości z filtrami (adres / status / źródło / sekcja); „Przetwórz kolejkę”, gdy coś w niej czeka; „Uzupełnij statystyki z Resend” dla maili sprzed subskrypcji webhooka (partie po 25, daty przybliżone) |
| `/duplicates` | Grupy duplikatów wg e-mail / NIP z akcją „oznacz” (nic nie jest usuwane automatycznie) |
| `/utm` | **Generator linków UTM** — budowanie otagowanych linków ze słowników, biblioteka linków, krótkie linki `/l/{slug}` z licznikiem kliknięć, kody QR, skracanie w Bitly |
| `/utm/slowniki` | Serwisy Aura i kanoniczne wartości `utm_*` |
| `/utm/raport` | Skuteczność kampanii: kliknięcia (własne + Bitly), wejścia z analityki i leady |
| `/analityka` | Ruch na ośmiu serwisach Aura: odsłony, kanały, kampanie, Core Web Vitals (opis w `CLAUDE.md`) |
| `/google-ads` | **Google Ads** — tygodniowy raport kampanii UD_2026: alerty, KPI tydzień do tygodnia, trend do 26 tygodni, ustawienia, konwersje, słowa kluczowe, hasła, zmiany na koncie; archiwum tygodni i pobranie `.md` (opis niżej) |

## Uruchomienie

```bash
npm install
cp .env.example .env   # uzupełnij wartości
npm run dev
```

Zmienne środowiskowe — patrz `.env.example` (nazwy zgodne ze specyfikacją; bez kluczy w kodzie).
`SUPABASE_SERVICE_ROLE_KEY` i `RESEND_API_KEY` są używane wyłącznie po stronie serwera.
Poza `.env.example` kod czyta opcjonalne zmienne z wartościami domyślnymi: `QUEUE_BATCH_SIZE`
(partia kolejki, 20; na planie Workers Free ustaw 4, inaczej partia przekroczy limit
subrequestów), `SEND_DELAY_MS` (650 ms), `DAILY_SEND_LIMIT` (dobowy limit wysyłki z kolejki,
100000), `AUTO_SEND_DAILY_LIMIT` (dobowy limit automatu, 100), `AUTO_SEND_MAX_AGE_DAYS` (14).
Zmienne Turnstile z `.env.example` są obecnie nieużywane.

## Migracje Supabase

`supabase/migrations/20260708120000_aura_hub_email_module.sql` tworzy:

- tabele `email_categories`, `email_assets`, `email_category_assets`, `email_campaigns`,
  `email_messages`, `email_attachments` — wszystkie z RLS (polityki tylko dla adminów),
- funkcję `email_normalize_interest(text)` — normalizacja wolnego tekstu `ubezpieczenie`
  do kodów kanonicznych (`oc`, `konsultacja`, `tax`, `utrata_dochodu`, `zdrowie`,
  `grupowe`, `brak`, `inne`) z obsługą wariantów myślnika,
- funkcję `email_has_rodo_consent(text)` — **nieużywaną w kodzie HUB** i niezgodną
  z obowiązującą regułą: zgodę zwraca tylko dla `tak`/`true`/`1`/`yes`/`on`/`zgoda`, więc
  puste pole liczy jako brak zgody. Wysyłka i eksport stosują `hasRodoConsent` (patrz
  „RODO”); zapytanie SQL oparte na tej funkcji da inną bazę odbiorców niż HUB,
- widoki analityczne: `email_stats_signups_daily`, `email_duplicates_by_email`,
  `email_duplicates_by_nip`, `email_stats_interest`, `email_stats_sent_daily`,
- prywatny bucket Storage `email-assets` (ścieżki `library/{asset_id}/{filename}`),
- seed kategorii kanonicznych.

Kolejne migracje modułu e-mail — wszystkie wymagane, kod z nich korzysta:

- `20260709150000_category_attachment_mode.sql` — `email_categories.attachment_mode`
  (`attachments` | `links`),
- `20260811120000_email_categories_html_body.sql` — `email_categories.html_body`
  (treść z Edytora e-mail),
- `20260811130000_email_drafts.sql` — tabele `email_drafts`, `email_draft_assets` (RLS, tylko admini),
- `20260811140000_auto_send.sql` — `email_categories.auto_send`, `auto_send_since`; źródło
  `auto` w `email_messages.source`,
- `20260818200000_email_messages_claimed_at.sql` — `email_messages.claimed_at` (odzyskiwanie
  wiadomości zawieszonych w `sending`),
- `20260820150000_email_stats_backfill.sql` — `email_messages.stats_backfilled_at`
  (statystyki uzupełnione z API Resend).

Migrację modułu UTM opisuje sekcja „Moduł UTM”.

Migracje nie zmieniają struktury tabel CRM (`crm_companies`, `crm_history`, …), ale
`email_messages.company_id` ma klucz obcy do `crm_companies(id)` bez `on delete` — kontaktu,
do którego odwołuje się choć jeden wiersz `email_messages` (także `skipped`), nie da się
usunąć z CRM, dopóki ten wiersz istnieje. Zapisy danych HUB w CRM — patrz „Baza klientów”
na górze. Migracje dotyczą wyłącznie modułów HUB — **nie obejmują i nie zmieniają
autoryzacji Supabase** (patrz sekcja powyżej).

## Pipeline wysyłki masowej

1. Kampania (szkic) z kategorią i segmentem (`segment_json`).
2. Start → **materializacja** `email_messages`. Do `queued` trafia kontakt z poprawnym
   e-mailem, bez sprzeciwu RODO, bez wcześniejszego twardego odbicia ani skargi na spam
   (`loadBlockedEmails`) i **pierwszy raz w tej wysyłce po adresie** — ta sama osoba bywa
   w CRM na kilku kartach, a unikalny indeks `(campaign_id, company_id)` tego nie łapał.
   Reszta → `skipped` z powodem; snapshot załączników w `email_attachments`.
3. Worker cron (`workers/queue-cron`) **co minutę** woła `POST /api/cron/process-queue`
   (nagłówek `x-cron-secret`); endpoint wysyła partię maili (domyślnie 20, `QUEUE_BATCH_SIZE`)
   **pojedynczo** przez Resend
   (załączniki wykluczają batch), z throttlingiem `SEND_DELAY_MS` (domyślnie 650 ms)
   i retry z powrotem do kolejki (maks. 3 próby → `failed`). Kolejność: automat
   (świeże zapisy) → kampanie → wysyłki „do wszystkich”.
4. Zaplanowane kampanie (`scheduled_at`, czas warszawski) i automat uruchamia ten sam cron.
5. Partię można też przetworzyć ręcznie: „Przetwórz partię teraz” na stronie kampanii
   (tylko w trakcie wysyłki) albo „Przetwórz kolejkę” w Historii wysyłek. Oba robią to samo
   co jeden przebieg crona: biorą jedną partię (domyślnie 20) z **całej** kolejki w tej samej kolejności,
   nie tylko z tej kampanii — przycisk kampanii może więc wysłać automat albo inną kampanię.

> ### ⚠️ Bez crona nic nie wychodzi samo
>
> Kampanie, automat, wysyłki „do wszystkich” i start zaplanowanych kampanii działają
> **wyłącznie** przez Worker `aura-hub-queue-cron`. Do 2026-10-11 tego Workera nie było na
> koncie Cloudflare — wysyłka szła tylko wtedy, gdy ktoś klikał „Przetwórz partię”.
> Panel pokazuje teraz „Kolejka stoi”, gdy kolejka nie jest pusta, a od 10 minut nic
> z niej nie wyszło, albo gdy zaplanowanej kampanii minął termin ponad 10 minut temu,
> a nie wystartowała. Wdrożenie: sekcja „Deploy” niżej.

> ### Duplikaty i awarie
>
> **Kontrola tuż przed wysyłką** (`recipientHoldReason`): przy każdej wiadomości z kolejki
> HUB sprawdza, czy adres nie odbił wcześniej maila ani nie zgłosił spamu i czy nie dostał
> już tej kampanii (dla automatu: tej sekcji). Z kilku czekających kopii
> tego samego adresu wychodzi ta z najmniejszym id — także przy dwóch równoległych
> przebiegach. Automat nie wysyła powitań starszych niż `AUTO_SEND_MAX_AGE_DAYS` (14 dni).
> Taka wiadomość dostaje `skipped` z powodem zamiast wysyłki. Bramka przy kolejkowaniu nie
> wystarcza — kolejka potrafi czekać godzinami, a wiadomości zakolejkowane przed zmianą
> reguł też muszą przez nie przejść. Wiadomości bez kampanii ze źródłem `quick_send` —
> szybka wysyłka 1-do-1 **oraz** wysyłka „do wszystkich” (kod ich nie rozróżnia) — nie są
> blokowane historią wysłanych, tylko blokadą adresu i równoległą kopią. Przy szybkiej
> wysyłce to świadoma decyzja operatora, a kontrola działa dopiero przy ponowieniu
> z kolejki: pierwsza próba z `/send` omija ją w całości (także blokadę adresu).
> „Do wszystkich” odsiewa historię sekcji tylko przy kolejkowaniu. Zgody RODO kontrola tuż przed wysyłką nie sprawdza (patrz „RODO”).
>
> **Martwy link wypisu wstrzymuje wysyłkę.** Jeśli szablon Resend zawiera
> `{{{RESEND_UNSUBSCRIBE_URL}}}`, wiadomości z kolejki czekają (bez zużycia prób), aż szablon
> zostanie poprawiony na `{{{link_wypisu}}}` i opublikowany. Strona kampanii mówi to wprost.
> Kontrola wymaga klucza API, który może czytać szablony — przy kluczu „Sending access”
> jej nie ma i mail wychodzi z martwym linkiem (patrz niżej).
>
> Każde wywołanie Resend niesie `Idempotency-Key` = wiadomość + **runda** prób
> (`aura-hub/{id}/{runda}`, 3 próby na rundę). W obrębie rundy klucz się nie zmienia, więc
> ponowienie po błędzie sieci, 5xx albo awarii między wysyłką a zapisem statusu nie wyśle
> drugiego maila. Zawieszona w `sending` wiadomość wraca po 15 min z oddaną próbą; po 23 h
> (klucz żyje 24 h) dostaje `failed` z prośbą o sprawdzenie w Resend. „Ponów nieudane” nie
> zeruje licznika, tylko zaczyna nową rundę — z nowym kluczem, więc naprawdę wysyła.
> Odpowiedź 429 (limit na sekundę, dzienny albo miesięczny) nie zużywa próby i przerywa
> partię. Nieudany odczyt szablonu Resend (nadawca) nie spada po cichu na `RESEND_FROM` —
> wiadomość czeka na kolejną próbę. Wyjątek: klucz API bez prawa odczytu szablonów
> (401/403, „Sending access”). Wtedy HUB wysyła z nadawcą kampania → sekcja → `RESEND_FROM`
> (nadawcy zapisanego w szablonie nie widzi), **bez** kontroli martwego linku wypisu, i przez
> 5 min nie pyta ponownie o szablony. Strona kampanii o tym ostrzega. Naprawa: nadawca
> w sekcji albo klucz z „Full access”.

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
3. Utwórz szablony (Templates) i wpisz ich id/alias w `/categories` — chyba że sekcja ma
   treść z Edytora e-mail (`html_body`); wtedy szablon nie jest używany. W treści użyj
   zmiennych `{{firma}}`, `{{kontakt}}`, `{{miasto}}`, `{{nip}}`, w sekcjach z trybem
   „Linki do pobrania” `{{{pliki_html}}}` (lista plików — bez niej mail wychodzi bez
   plików, bez żadnego błędu) oraz `{{{link_wypisu}}}` jako linku wypisu (HUB wstawia tam
   `RESEND_UNSUBSCRIBE_URL`). Zmienną `link_wypisu` zadeklaruj w szablonie z wartością domyślną, np. `mailto:`
   na monitorowaną skrzynkę.

   > ⚠️ **`{{{RESEND_UNSUBSCRIBE_URL}}}` nie działa przy wysyłce z HUB.** Resend wypełnia ją
   > tylko w Broadcasts; HUB wysyła przez `POST /emails`, więc link wychodził jako `href=""`
   > (sprawdzone na newsletterze z 2026-10-11).

   **Nadawca:** kampania → sekcja (`/categories`) → nadawca zapisany w szablonie Resend →
   `RESEND_FROM`. Wcześniej `RESEND_FROM` wygrywał z szablonem, więc newsletter
   UtrataDochodu wychodził jako „Beauty❤️Polisa”. Krok z szablonem wymaga klucza API
   z prawem odczytu szablonów (*Full access*). Przy kluczu *Sending access* łańcuch to
   kampania → sekcja → `RESEND_FROM` — wtedy ustaw nadawcę w sekcji.
4. Webhook: endpoint `POST /api/webhooks/resend`, subskrybuj `email.delivered`,
   `email.opened`, `email.clicked`, `email.bounced`, `email.complained`, a także
   `email.suppressed` i `email.failed` — bez nich mail zablokowany przez Resend
   zostaje w HUB jako „wysłany”.
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
5. Maile wysłane, **zanim webhook subskrybował `email.opened`**, nie dostaną otwarć
   z webhooka. Uzupełnisz je przyciskiem „Uzupełnij statystyki z Resend” w Historii wysyłek
   (partie po 25 — klikaj, dopóki komunikat pokazuje „Zostało …”). API Resend podaje tylko
   ostatni stan, więc data otwarcia jest przybliżona, a wpis ma `stats_backfilled_at`.

Uwaga: open tracking bywa niedokładny (blokowanie obrazków, prefetch, Apple Mail Privacy
Protection, przycinanie w Gmailu) — kliknięcia to pewniejszy sygnał; dashboard opisuje
otwarcia jako orientacyjne.

## Moduł UTM

Zakładka `/utm` generuje linki do naszych serwisów z parametrami `utm_*`, żeby dało się
policzyć, skąd faktycznie przychodzą leady. Migracja
`supabase/migrations/20260903091944_utm_module.sql` tworzy:

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

### Trzy drogi na stronę, trzy liczniki

| Droga | Adres | Kto liczy |
|---|---|---|
| Własne przekierowanie | `hub.auraexpert.pl/l/{slug}` | HUB, tabela `utm_clicks`, bez limitu |
| Skrót Bitly | `bit.ly/…` (lub własna domena) | Bitly; do HUB trafiają przyciskiem „Statystyki Bitly” |
| Pełny adres z `utm_*` | `https://serwis.pl/?utm_source=…` | nikt nie liczy kliknięcia — liczy się dopiero **wejście**, w analityce |

Krótki link Bitly celuje **prosto w adres docelowy**, więc jego kliknięcia nie przechodzą
przez `/l/`. Bez synchronizacji raport pokazywałby dla takich linków zero.

> ### ⚠️ Zero kliknięć nie znaczy, że kampania nie działa
>
> Licznik `utm_clicks` zapisuje **wyłącznie** przejścia przez `/l/{slug}`. Jeśli w reklamie
> albo w poście wklejono pełny adres z parametrami `utm_*` — a tak dzieje się najczęściej,
> bo panele reklamowe chcą adresu docelowego — ruch idzie prosto na stronę i przekierownik
> nie ma czego policzyć.
>
> Dlatego `/utm/raport` ma kolumnę **Wejścia**, zasilaną z Analytics Engine (`loadCampaignEntries`
> w `src/lib/server/analytics.ts`). To jedyny licznik, który widzi ruch niezależnie od drogi,
> jaką ktoś przyszedł — ale tylko na serwisach mierzonych przez analitykę (`MEASURED_HOSTS`
> w `src/lib/analytics.ts`). `auraexpert.pl` jest w seedzie serwisów, a nie jest mierzony:
> kolumna Wejścia jest dla niego zawsze pusta, a kampania z pełnym adresem `utm_*` kierująca
> wyłącznie na niego ma zero i kliknięć, i wejść, nawet jeśli działa. Kampanie widoczne w ruchu, ale nieobecne w bibliotece linków, dopisują
> się do tabeli same — link do reklamy bywa sklejany z pominięciem generatora.
>
> Kolumna liczy **ostatnie 30 dni**, bo tyle bierzemy z Analytics Engine; kliknięcia są
> od początku istnienia linku. Dwa różne okna w jednej tabeli to świadomy kompromis,
> stąd okno wypisane w nagłówku kolumny.

Skracanie w Bitly jest zawsze świadomym kliknięciem, nigdy automatem — plan Starter ma
**50 linków na miesiąc**, a licznik zużycia widać nad listą linków. Bez `BITLY_TOKEN`
przycisk jest ukryty; krótki link można wtedy wkleić ręcznie w edycji linku, ale jego
kliknięć HUB nie pobierze („Statystyki Bitly” synchronizują tylko linki skrócone
przyciskiem) — trzeba je sprawdzać w panelu Bitly.

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

## Raport Google Ads

Skrypt Google Ads Scripts co poniedziałek ok. 6:00 wysyła raport kampanii UD_2026
(utratadochodu.pl) za poprzedni pełny tydzień na `POST /api/webhooks/ads-report`.
HUB nie czyta Google Sheets — kopia w arkuszu jest tylko zapasowa.

- **Autoryzacja:** `Authorization: Bearer <ADS_REPORT_TOKEN>`, porównanie odporne na pomiar
  czasu. Brak sekretu w środowisku → 503, zły albo brak tokenu → 401, treść > 1 MB → 413,
  zły JSON albo brak `period.end` / `kpi.current` / `kpi.previous` / `alerts` → 400 z listą
  błędów, sukces → `{"ok": true, "period_end": "…"}`.
- **Skrypt musi wysyłać `Content-Type: application/json`** (w UrlFetchApp
  `contentType: 'application/json'`). Domyślny typ formularza kończy się odpowiedzią 403
  z ochrony CSRF SvelteKita, zanim token zostanie sprawdzony.
- **Zapis:** tabela `ads_reports` (migracja `20261026120000_ads_reports.sql`), jeden wiersz
  na tydzień, klucz `period_end`. Ponowne wysłanie tygodnia nadpisuje wiersz. „Najnowszy”
  = największe `period_end`, więc ponowne wysłanie starego tygodnia go nie przestawia.
  RLS: odczyt tylko dla adminów, zapis wyłącznie przez webhook (service role).
- **Zakładka** `/google-ads` jest za bramką administratora; Markdown raportu idzie wyłącznie
  jako plik do pobrania (`/google-ads/pobierz/{period_end}`), nigdy jako HTML — wyszukiwane
  hasła to tekst wpisany przez dowolnego użytkownika Google. Ostrzeżenie „Skrypt nie przysłał
  raportu” pojawia się, gdy najnowszy raport odebrano ponad 8 dni temu.
- **Testy:** `npm test` (Vitest) — endpoint na magazynie w pamięci i render zakładki
  z `src/lib/ads/fixture.json`, przykładowego raportu zgodnego z kontraktem.

## Zasady wyglądu panelu

Panel jest narzędziem, w które ktoś patrzy codziennie po kilka godzin. Stąd kilka
reguł, które łatwo złamać przy dokładaniu kolejnego ekranu.

1. **Treść ma maksymalną szerokość** (`--content-max`, 1360 px, wyśrodkowana).
   Tabela rozciągnięta na całą szerokość monitora zmusza oko do wędrówki przez
   pustkę między kolumnami i dokładnie tak powstaje wrażenie „instrukcji obsługi".
   Akapity dodatkowo ograniczone do 68 znaków (`.page-subtitle`).
2. **Szerokości kolumn podawaj wprost** (`<colgroup>`). Bez tego przeglądarka
   rozdziela je wg treści i kolumna z datą odpływa na drugi koniec ekranu.
3. **Jeden wiersz, jedna rzecz główna.** Nazwa firmy w `.cell-main`, reszta
   (osoba, NIP, telefon) w `.cell-sub` — mniejsza i wyszarzona. Siedem kolumn
   o tej samej wadze czyta się jak tabela parametrów.
4. **Zieleń w tabeli znaczy „zadzwoń", nigdy „wpadło dzisiaj".** W Bazie Klientów
   (`/clients`) wiersz świeci na zielono (`.row-hot`) wyłącznie wtedy, gdy zapis
   jest świeży (ostatnie 7 dni, `NOWY_PRZEZ_DNI`) **i** klient prosi o konsultację.
   Dzisiejszy wpis bez konsultacji dostaje spokojny akcent (`.row-today`), starszy
   żadnego. Gdyby zieleń świeciła na każdym dzisiejszym wierszu, przestałaby
   cokolwiek znaczyć. Zapisy dzienne (`/signups`) tę regułę dziś łamią: `.row-hot`
   dostaje tam każda konsultacja bez względu na datę, a nagłówek dzisiejszego dnia
   (`.today-sep`) jest zielony.
5. **Kolor kategorii pochodzi z jednego miejsca** — `CODE_COLORS`
   w `src/lib/categories.ts`, wskazujące zmienne `--c-*` z `src/app.css`.
   Osiem kategorii ma osiem rozróżnialnych barw, osobno dla motywu jasnego
   i ciemnego. Przy dokładaniu kategorii sprawdź, czy nie powtarzasz odcienia.
6. **Wykres skaluje się do szerokości kontenera z zachowaniem proporcji**, więc
   o wysokości na ekranie decyduje stosunek `width` do `height` w `BarChart`,
   a nie sam `height`. Karta na całą szerokość potrzebuje większego `width`
   (pulpit podaje 1400), inaczej wykres rośnie proporcjonalnie i zjada pół ekranu.
7. **Długie nazwy nie mieszczą się pod pionowymi słupkami.** Rozkład kategorii
   rysujemy poziomo (`.hbars`) — każda nazwa ma własny wiersz.
8. **Liczby bez pudełek.** Metryki na górze strony (`.kpi-grid`) nie mają ramki,
   tła ani zaokrąglenia. Ramka wokół liczby dokłada trzy kreski i zero
   informacji; przy czterech metrykach to dwanaście kresek na drodze do czterech
   liczb. Liczba dostaje 2,5 rem i `tabular-nums`, podpis idzie nad nią, reszta
   pod spodem.
9. **Każda metryka z serią czasową dostaje sparkline** (`Sparkline.svelte`) tuż
   pod liczbą. Liczba mówi „ile", sparkline mówi „dokąd to idzie". To wykres bez
   osi, siatki i podpisów — nie służy do odczytywania wartości, tylko kształtu.
   Kolor metryki przeniósł się z paska nad kafelkiem na linię sparkline'u, więc
   nadal rozdziela metryki, ale przy okazji rysuje dane.
10. **Sparkline ma stały rozmiar w pikselach**, nie płynny. Rozciąganie w jednej
    osi zrobiłoby z kropki końcowej elipsę.
11. **Dopisek pod metryką dosuwamy do dołu** (`.kpi-sub`, `margin-top: auto`).
    Bez tego, gdy sąsiednia karta jest wyższa (np. ma dwuliniowy podpis), dopiski
    kończą się na różnych wysokościach i rząd robi się poszarpany.

## RODO (wymóg twardy)

- **Zgody RODO są zebrane dla całej bazy Klientów** (potwierdzone przez właściciela
  danych). Interpretacja zgody: `hasRodoConsent(crm_companies.rodo)` w
  `src/lib/categories.ts` — puste/nieuzupełnione pole `rodo` liczy się jako zgoda;
  wykluczany jest **wyłącznie wyraźny sprzeciw**: cała wartość pola (po `trim`, małymi
  literami) musi być jedną z `RODO_REFUSED` (`nie`, `false`, `0`, `no`, `off`, `brak`,
  `brak zgody`, `sprzeciw`). Inny tekst, np. „nie wyrażam zgody”, liczy się jako zgoda.
- Bramka RODO (`recipientGate` w `src/lib/server/sender.ts`) obowiązuje tak samo dla
  kampanii masowych, dla wysyłki „do wszystkich" wg kategorii (`/clients/kategorie`) i dla
  automatu. Kontakt ze sprzeciwem nie trafia do kolejki: w kampanii dostaje wiersz
  `skipped` z powodem, w „do wszystkich” jest tylko liczony jako pominięty, automat pomija
  go bez wiersza.
- Bramka działa **tylko przy kolejkowaniu**. Kontrola tuż przed wysyłką
  (`recipientHoldReason`) sprawdza blokadę i duplikat, ale nie zgodę — sprzeciw wpisany
  w CRM później nie zatrzyma wiadomości, która już czeka w kolejce.
- Surowa wartość pola `rodo` z chwili utworzenia wiadomości jest zapisywana w
  `email_messages.rodo_snapshot` (audyt) — niezależnie od interpretacji. Dla kampanii,
  „do wszystkich” i automatu to moment zakolejkowania, nie wysyłki.
- Szybka wysyłka 1-do-1 jest inicjowana ręcznie przez operatora; również zawiera link
  wypisu i jest logowana.

## Limity i pułapki

> ### ⚠️ PostgREST tnie odpowiedzi do 1000 wierszy (`db_max_rows`)
>
> Zapytanie z `.limit(20000)` **nie zwraca błędu** — dostaje status 200 i po cichu
> przyciętą odpowiedź (nagłówek `Content-Range: 0-999/*`). Przez to lista wysyłek w
> „Bazie Klientów" przestała się pokazywać, gdy `email_messages` przekroczyło 1000
> pasujących wierszy, a eksport SMS i dobór odbiorców kampanii po cichu pomijały
> resztę bazy.
>
> Pełne listy czytaj wyłącznie przez `fetchAllRows()` z `src/lib/server/supabase.ts`,
> które stronicuje po `.range()`. Zapytanie **musi** mieć jednoznaczne sortowanie
> (np. `.order('id')`), inaczej kolejne strony pogubią wiersze. Builder zapytania
> buduj od nowa w każdej stronie — ponowne użycie jednego obiektu doklejałoby
> `order`/`range` przy każdym przebiegu.



- Cała wiadomość ≤ 40 MB; Base64 dokłada ~33% → bezpieczny łączny rozmiar załączników
  ~28 MB (pilnowane przy uploadzie i przed wysyłką).
- Załączniki działają tylko przy wysyłce pojedynczej (nie batch) — stąd kolejka.
- Sposób dostarczenia plików z prywatnego bucketa zależy od trybu sekcji
  (`email_categories.attachment_mode`): `attachments` (domyślny) — pliki idą w mailu jako
  `content` (Base64), łącznie ≤ ~28 MB; `links` — mail bez załączników, w `{{{pliki_html}}}`
  lista linków do publicznego `/files/{asset_id}`, który bez logowania przekierowuje na
  signed URL ważny 10 min. Endpoint wydaje każdy plik z biblioteki po samym UUID, więc tryb
  `links` jest wyłącznie dla materiałów produktowych (OWU, ulotki), nie dla danych osobowych.
- Analityka i segmentacja liczą na kodach kanonicznych, nie na surowym `ubezpieczenie`.

## Deploy (Cloudflare)

1. Aplikacja: Cloudflare Pages z adapterem `@sveltejs/adapter-cloudflare`. Produkcję Pages
   buduje z gałęzi `main` — każdy push na `main` uruchamia build i wdrożenie. Ustaw zmienne
   środowiskowe z `.env.example` w projekcie Pages.
2. Cron: `cd workers/queue-cron && npx wrangler deploy`, ustaw `HUB_URL` w `wrangler.toml`
   i sekret `npx wrangler secret put QUEUE_CRON_SECRET` (ta sama wartość co w aplikacji).
   Sprawdzenie, że działa: `npx wrangler tail aura-hub-queue-cron` (co minutę wpis,
   bez `HTTP 401`) i znika ostrzeżenie „Kolejka stoi” w panelu.
   Sekret generuj losowo (`openssl rand -hex 32`) i nigdy nie wpisuj go do repozytorium.
3. Analityka: `cd workers/analytics-collector && npx wrangler deploy` (Worker
   `aura-analytics-collector`; trasy, KV `VISITOR_SALT` i znany błąd uprawnień Workers
   Routes — patrz `CLAUDE.md`).

> Oba Workery (`queue-cron`, `analytics-collector`) wdraża się ręcznie — push na `main` ich
> nie aktualizuje. Collector wbudowuje `src/lib/utm.ts` (`slugifyUtm`) i `src/lib/analytics.ts`
> (`MEASURED_HOSTS`, `VITALS`), więc po zmianie tych plików trzeba go wdrożyć ponownie.

> Uwaga do wdrożeń: przywracanie/aktualizacja produkcji dotyczy **wyłącznie kodu aplikacji**.
> Konfiguracja **autoryzacji i weryfikacji Supabase pozostaje nietknięta** (patrz sekcja
> „Autoryzacja i weryfikacja Supabase — NIE ZMIENIAĆ").
