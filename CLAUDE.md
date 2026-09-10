# Własna analityka webowa

> Ten plik opisuje **moduł analityki** Aura HUB. Reszta projektu (wysyłka e-maili,
> baza klientów, moduł UTM) jest opisana w `README.md`.

Zbieramy statystyki ruchu po stronie serwera, przechowujemy w Cloudflare
Analytics Engine i pokazujemy we własnym panelu wewnątrz HUB.

Powód: zewnętrzny skrypt analityczny spowalnia stronę, jest wycinany przez
blokery (więc liczby są zaniżone o nieznaną wartość), wysyła dane osób trzecich
i wymusza baner zgody. Pomiar po stronie serwera nie ma tych wad.

## Architektura

```
przeglądarka → Cloudflare → [collector Worker] → origin
     ↑ /__vitals.js               ↓ (waitUntil)
     ↓ /__vitals            Analytics Engine
                                   ↓
                      HUB /analityka (SvelteKit) ← SQL API
                                   ↓
                            D1 (archiwum dzienne)
```

- **collector Worker** (`workers/analytics-collector/`) — na trasach mierzonych
  hostów, zapisuje zdarzenia
- **panel** — trasa `/analityka` w aplikacji HUB, za istniejącą bramką
  administratora (`public.is_platform_admin()`), odpytuje SQL API po stronie serwera
- **D1** — dzienne podsumowania, bo Analytics Engine trzyma dane 3 miesiące

### Dlaczego panel w HUB, a nie osobny Worker za Cloudflare Access

HUB ma już działającą bramkę administratora, layout i nawigację. Trasa w HUB
oznacza jeden adres, jedno logowanie i zero konfiguracji Zero Trust. Cena:
awaria HUB zabiera też panel analityki. Uznaliśmy to za akceptowalne, bo panel
jest narzędziem roboczym, a nie usługą dla klientów.

## Schemat danych

Dataset: `web_events`. Jeden schemat dla wszystkich typów zdarzeń.
Mapowanie w kodzie: stała `FIELDS` na górze `workers/analytics-collector/index.ts`.

| Pole | Zawartość | Uwagi |
|---|---|---|
| `index1` | host | jedyny indeks, niska liczność |
| `blob1` | host | bez prefiksu `www.` |
| `blob2` | ścieżka | bez query stringu, identyfikatory zamienione na `:id`, max 256 znaków |
| `blob3` | typ zdarzenia | `pageview` \| `vital` \| nazwa zdarzenia własnego |
| `blob4` | kraj | z `request.cf.country` |
| `blob5` | host referrera | sam host, nigdy pełny adres. Puste = wejście bezpośrednie |
| `blob6` | klasa urządzenia | `mobile` \| `tablet` \| `desktop` \| `bot` |
| `blob7` | rodzina przeglądarki | `chrome`, `safari`, `firefox`, `other` |
| `blob8` | skrót odwiedzającego | wariant B, patrz niżej |
| `blob9` | szczegół | kod odpowiedzi dla `pageview`, nazwa wskaźnika dla `vital` |
| `blob10` | `utm_source` | znormalizowany, puste gdy brak |
| `blob11` | `utm_medium` | znormalizowany |
| `blob12` | `utm_campaign` | znormalizowany |
| `blob13` | `utm_content` | znormalizowany |
| `blob14` | `utm_term` | znormalizowany |
| `double1` | wartość | czas odpowiedzi w ms albo wartość Web Vital |

**Kolejność pól jest kontraktem.** SQL API zwraca `blob1`, `blob2` bez nazw,
więc zmiana kolejności po cichu wywraca wszystkie zapytania i panel.
Jeśli trzeba coś dodać, dokładamy na końcu. Nigdy w środku.

## Mierzone hosty

| Host | Strefa |
|---|---|
| utratadochodu.pl | utratadochodu.pl |
| auraconsulting.pl | auraconsulting.pl |
| cyber.auraconsulting.pl | auraconsulting.pl |
| zarzad.auraconsulting.pl | auraconsulting.pl |
| beautypolisa.eu | beautypolisa.eu |
| rozwod.waw.pl | rozwod.waw.pl |
| grupowe.pro | grupowe.pro |
| gwarancje.pro | gwarancje.pro |

`hub.auraexpert.pl` celowo **nie jest** mierzony — to panel wewnętrzny i jego
ruch zaśmiecałby statystyki klientów.

Ta lista jest **wpisana na sztywno** w collectorze (`MEASURED_HOSTS`). Ruch na
adres spoza listy leci do originu normalnie, ale nie jest zapisywany. Powód:
skanery odpytują zmyślone subdomeny (widzieliśmy
`910nefpaernhcrd2.auraconsulting.pl`), a host jest naszym jedynym indeksem
i ma mieć niską liczność.

**Dodanie nowego serwisu wymaga trzech rzeczy:** wpisu w `MEASURED_HOSTS`,
trasy w `wrangler.jsonc` i trasy w panelu Cloudflare. Sama trasa nie wystarczy —
to świadomy koszt tej osłony.

## Kampanie UTM w analityce

Collector zapisuje pięć parametrów `utm_*` ze strony wejścia, w polach
`blob10`–`blob14`. To jedyny wyjątek od zasady o query stringach i jest wąski
z premedytacją: czytamy wartości spod pięciu znanych nazw, nigdy całego query
stringu. `gclid` i `fbclid` pomijamy, bo to identyfikatory reklamowe.

Wartości normalizuje **ta sama funkcja**, której używa generator linków —
collector importuje `slugifyUtm` z `src/lib/utm.ts`, zamiast trzymać własną
kopię. Bliźniak SQL (`public.utm_slugify`) pozostaje jeden; trzecia niezależna
implementacja byłaby trzecią okazją do rozjechania się.

### Trzy liczniki, trzy różne rzeczy

| Licznik | Co mierzy | Gdzie |
|---|---|---|
| `utm_clicks` | kliknięcie krótkiego linku `/l/{slug}` | Supabase |
| Bitly | kliknięcie skrótu bit.ly | API Bitly |
| `web_events` z `utm_*` | wejście, które **doszło** na stronę | Analytics Engine |

Różnica między kliknięciem a wejściem jest sama w sobie informacją: mówi, ilu
ludzi odpada między kliknięciem a załadowaniem strony.

Wszystkie trzy stoją obok siebie w `/utm/raport`. Powód jest praktyczny: kampania
z pełnym adresem `utm_*` w reklamie (zamiast krótkiego linku) ma zero kliknięć
i bez kolumny wejść wygląda w raporcie na martwą, choć w analityce widać jej ruch.
Zero kliknięć znaczy „nikt nie przeszedł przez nasz przekierownik", nigdy
„nikt nie wszedł na stronę".

### Ograniczenie

Parametry `utm_*` są wyłącznie w pierwszym żądaniu. Bez ciasteczka nie
przeniesiemy ich na kolejne podstrony, więc mierzymy **strony wejścia
z kampanii**, a nie całą ścieżkę odwiedzającego.

## Core Web Vitals

Jedyny element analityki działający po stronie użytkownika. Powód jest twardy:
czas do największego elementu, skakanie treści i opóźnienie reakcji na
kliknięcie istnieją wyłącznie w przeglądarce. Serwer ich nie widzi, choćby
odpowiadał w 5 ms — i dokładnie tak wygląda dziś `rozwod.waw.pl`.

| Element | Gdzie |
|---|---|
| Skrypt mierzący | `workers/analytics-collector/vitals-client.ts`, serwowany pod `/__vitals.js` |
| Endpoint zgłoszeń | `POST /__vitals`, obsługiwany przez collectora, bez dotykania originu |
| Progi i nazwy wskaźników | stała `VITALS` w `src/lib/analytics.ts`, wspólna z panelem |
| Zapis | `blob3 = 'vital'`, nazwa wskaźnika w `blob9`, wartość w `double1` |

Mierzymy pięć wskaźników: `LCP`, `INP`, `CLS`, `FCP`, `TTFB`. Zgłoszenie idzie
raz na odsłonę, przez `navigator.sendBeacon` w momencie zniknięcia karty.

### Skrypt trafia na strony sam

Collector dokłada `<script src="/__vitals.js" defer>` przed `</head>` każdej
odpowiedzi HTML na mierzonym hoście, przez `HTMLRewriter`. To **jedyne**
miejsce, w którym Worker zmienia odpowiedź originu — wcześniej wracała
nietknięta. Alternatywą było dopisanie znacznika ręcznie w ośmiu serwisach
i pilnowanie, żeby nie wypadł przy kolejnym przebudowaniu któregoś z nich.

Skrypt jest z tej samej domeny, więc polityka `script-src 'self'` go przepuszcza.
Serwis z CSP wymagającą `nonce` zablokuje skrypt — zniknie wtedy pomiar
wskaźników na tym serwisie, ale nie strona.

### Obrona publicznego endpointu

`/__vitals` jest wejściem publicznym, więc sprawdzamy po kolei: metodę (tylko
POST), nagłówek `Origin` (musi być `https://` na tym samym mierzonym hoście —
`sendBeacon` z obcej domeny i tak wyśle żądanie, tylko odpowiedzi nie
przeczyta), rozmiar ciała (2 kB), liczbę wskaźników w zgłoszeniu, nazwy
z zamkniętej listy i zakresy wartości (`VITALS[…].max`).

Limit częstotliwości to licznik w pamięci izolatu: 30 zgłoszeń na minutę na
skrót odwiedzającego. Izolatów jest wiele i każdy liczy osobno, więc realny
limit jest wielokrotnością tej liczby. **To zapora na przypadkową pętlę
i pojedynczego amatora, nie na rozproszony zalew** — na tamto jest Rate
Limiting w panelu Cloudflare.

### Dwa świadome przybliżenia

1. **INP liczymy jako najdłuższą interakcję**, a nie wysoki percentyl
   wszystkich. Przy stronach ofertowych z kilkoma kliknięciami na odsłonę obie
   liczby są tą samą liczbą; przy dziesiątkach interakcji nasza jest
   pesymistyczna, czyli myli się w bezpieczną stronę.
2. **Progi oceny zmieniają się.** Google wymienił FID na INP w 2024. Wartości
   w `VITALS` mają datę wpisania i nie były zweryfikowane w źródle przy
   ostatniej edycji — przed decyzją opartą na kolorze kafelka sprawdź je na
   web.dev.

## Co pokazuje panel

Układ jest ułożony wg tego, jak często się w coś patrzy, a nie wg tego, co
łatwo policzyć.

| Sekcja | Odpowiada na pytanie |
|---|---|
| Cztery kafelki | Ilu ludzi, ile odsłon, jak szybko, ile automatów |
| Wykres odsłon | Czy ruch rośnie i kiedy były skoki |
| Najczęściej odwiedzane strony | Co ludzie faktycznie czytają |
| Kanały ruchu | Skąd przychodzą: wyszukiwarki, social, asystenci AI, kampanie, polecenia, wejścia bezpośrednie |
| Serwisy | Który z ośmiu serwisów żyje (tylko przy filtrze „wszystkie") |
| Kiedy Cię czytają | Mapa dzień tygodnia × godzina — kiedy publikować i wysyłać |
| Szybkość w przeglądarce | Core Web Vitals i podstrony, które ciągną wynik w dół |
| Ruch z kampanii | Wejścia z parametrami `utm_*` |
| Adresy z błędem | Zepsute linki na własnych stronach, bez skanerów |

Kraje, urządzenia, przeglądarki i surowe adresy odsyłające są w zwiniętej
sekcji na dole. Są rzadko potrzebne, a rozpychały widok.

**Kanały wylicza `trafficChannel`** w `src/lib/analytics.ts`, po stronie
serwera, a nie w SQL. To jest decyzja biznesowa (ChatGPT to asystent, nie
kampania), więc ma być w jednym miejscu i dać się przetestować.

## Trzy pułapki, które psują liczby

### 1. Próbkowanie

Przy większym ruchu Analytics Engine zapisuje próbkę zdarzeń, nie wszystkie.
Każdy wiersz ma pole `_sample_interval` mówiące, ile realnych zdarzeń
reprezentuje.

```sql
-- ŹLE, zaniżone i bezużyteczne
SELECT count() FROM web_events

-- DOBRZE
SELECT SUM(_sample_interval) AS odslony FROM web_events
```

Dotyczy też średnich i percentyli. Percentyl liczymy funkcją
`quantileExactWeighted(q)(kolumna, _sample_interval)` — inaczej pojedyncze
rzadkie zdarzenie ma taką samą wagę jak tysiąc częstych.

### 2. Strefa czasowa

Timestampy są w UTC, panel pokazuje `Europe/Warsaw`. Wieczorem to różnica
dnia, nie tylko godziny. Do tego zmiana czasu dwa razy w roku.
Nie da się tego załatwić stałym przesunięciem o godzinę.

Rozwiązanie jest w samym SQL: `toStartOfInterval` i `formatDateTime` przyjmują
nazwę strefy jako ostatni argument.

```sql
toStartOfInterval(timestamp, INTERVAL '1' DAY, 'Europe/Warsaw') AS dzien
```

### 3. Liczność ścieżek

Bez normalizacji `/zamowienie/48213` i `/zamowienie/48214` to dwie różne
pozycje. Po tygodniu lista top stron ma dziesiątki tysięcy wpisów i nie mówi
nic. Segmenty wyglądające na identyfikatory zamieniamy na `:id` przy zapisie
(`looksLikeId()` w collectorze).

## Zasady prywatności

1. **Zero ciasteczek.** Bez wyjątków.
2. **Surowy IP nigdy nie jest zapisywany.** Może być użyty wyłącznie jako
   wejście do skrótu, w pamięci, bez trafiania do bazy.
3. **Query stringi nie są zapisywane** — z jednym wąskim wyjątkiem na parametry
   `utm_*` (patrz „Kampanie UTM w analityce"). Poza nimi query string jest
   wyrzucany w całości: trafiają tam tokeny resetu hasła, identyfikatory sesji
   i dane osobowe wklejone przez pomyłkę. `gclid` i `fbclid` **nie** są zapisywane.
4. **Referrer skracany do samego hosta.** Pełny adres strony, z której ktoś
   przyszedł, potrafi zawierać zapytanie wyszukiwarki albo identyfikator.
5. **User-Agent nie jest zapisywany w całości.** Tylko klasa urządzenia
   i rodzina przeglądarki. Pełny ciąg to element odcisku przeglądarki.

### Liczenie unikalnych odwiedzin

**Wybrany wariant:** **B** — skrót z IP, User-Agenta, hosta i daty, z solą
rotowaną co dobę.
**Decyzja podjęta przez:** właściciela projektu (biuro@utratadochodu.com)
**dnia:** 2026-09-07.

**Uzasadnienie:** wariant A (same odsłony) odbiera najważniejszą liczbę
biznesową, czyli ilu ludzi faktycznie było na stronie. Wariant C (sól co
godzinę) zawyża dzienne liczby, bo ta sama osoba wracająca po przerwie liczy
się ponownie. Wariant B daje użyteczną metrykę przy identyfikatorze, który
przestaje cokolwiek znaczyć po dobie. HUB stosuje już ten sam wzorzec w module
UTM (`utm_clicks.ip_hash`), przy czym tam sól jest stała — wariant B jest więc
ostrożniejszy niż rozwiązanie już działające w projekcie.

**Jak to działa:** `SHA-256(IP + User-Agent + host + data + sól)`, skrócone do
16 bajtów. Sól losowana raz na dobę warszawską, trzymana w KV `VISITOR_SALT`
z wygaśnięciem po 48 godzinach. Wczorajszych skrótów nie da się zestawić
z dzisiejszymi — także nam.

**Świadomy koszt:** unikalni nie łączą się między dniami, więc nie policzymy
osób powracających w dłuższym okresie. Suma unikalnych dziennych jest wyższa
niż rzeczywista liczba osób w tygodniu.

**Zastrzeżenie:** wariant B tworzy identyfikator pseudonimowy. To, czy w świetle
RODO wymaga zgody, jest kwestią interpretacji i nie ma tu jednoznacznej
odpowiedzi. Decyzję podjął człowiek, nie agent.

## Zasady techniczne

1. **Pomiar nigdy nie blokuje użytkownika.** Zapis idzie przez
   `ctx.waitUntil()`, w try/catch, który przełyka błędy (logując je do
   `wrangler tail`). Awaria analityki nie ma prawa zepsuć strony.
2. **Token API tylko jako sekret po stronie serwera.** Nigdy w kodzie klienta,
   nigdy w repozytorium. Zapytania SQL wykonuje wyłącznie serwer.
3. **Panel za bramką administratora HUB.** Nie budujemy własnego logowania
   i nie ruszamy warstwy autoryzacji Supabase (patrz `README.md`).
4. **Zero zależności z CDN w panelu.** Mamy restrykcyjną politykę CSP
   i nie robimy dla panelu wyjątków. Wykresy jako inline SVG.
5. **Wyniki zapytań cache'owane 60 sekund** przez Cache API.
6. **Skanery oznaczamy jako boty, nie pomijamy.** Serwisy odpowiadają kodem 200
   na `/.env` czy `/phpinfo.php`, a skanery podszywają się pod Chrome, więc ani
   kod odpowiedzi, ani User-Agent ich nie odsieje. Robi to `PROBE_PATTERN`
   w collectorze. Udział automatów pozostaje **zaniżony** — bez płatnego Bot
   Management nie da się tego domknąć.

   Ten sam filtr istnieje **drugi raz** po stronie zapytania panelu
   (`PROBE_PATH_PATTERNS` w `src/lib/analytics.ts`). To nie jest przypadek:
   Analytics Engine tylko dopisuje, więc wiersze zapisane przed wdrożeniem
   filtra mają klasę `desktop` i bez tego siedziałyby w top stronach przez
   całe trzy miesiące retencji.

   Wśród wzorców jest `.php` oraz `wp-includes`, bo **żaden z mierzonych
   serwisów nie serwuje PHP** — w danych te rozszerzenia pojawiły się wyłącznie
   w adresach typu `/adminfuns.php`. Gdyby któryś serwis stanął kiedyś na
   WordPressie, oba wzorce trzeba usunąć z obu miejsc.
7. **Endpoint `/__vitals` to wejście publiczne.** Waliduj Origin, zakresy
   wartości i częstotliwość zgłoszeń.
8. **Zadanie cron musi być idempotentne** i nie może nadpisywać danych
   pustym wynikiem. Pusty wynik to prawdopodobnie błąd zapytania.

## Stan wdrożenia

| Element | Status | Data | Uwagi |
|---|---|---|---|
| collector Worker | wdrożony | 2026-09-10 | `aura-analytics-collector`, workers.dev wyłączony |
| trasy na mierzonych hostach | działają | | 14 wpisów wpisanych ręcznie; ruch widać ze wszystkich ośmiu hostów |
| przestrzeń KV `VISITOR_SALT` | utworzona | 2026-09-07 | `e3d7ef83448e4a5288b3cddedd31af6e` |
| panel `/analityka` w HUB | wdrożony | 2026-09-10 | Pages buduje z `main`; wymaga `CF_ACCOUNT_ID` i `ANALYTICS_TOKEN` |
| Web Vitals | działa | 2026-09-10 | pierwsze zgłoszenia z przeglądarek potwierdzone w danych |
| archiwum D1 | do zrobienia | | sesja 3 |

## Dane konta

```
Account ID:   1f52c869d091ebf55a2d1789dad4842d
Dataset:      web_events
Retencja AE:  3 miesiące (zweryfikowane w dokumentacji 2026-09-07)
Sekret:       ANALYTICS_TOKEN (uprawnienie Account Analytics: Read)
```

### Zweryfikowane limity Analytics Engine

Stan dokumentacji na 2026-09-07. Te wartości się zmieniają — sprawdzaj,
nie ufaj pamięci.

| Limit | Wartość |
|---|---|
| Blobów na punkt danych | 20 |
| Doubles na punkt danych | 20 |
| Indeksów na punkt danych | 1 |
| Łączny rozmiar blobów | 16 kB |
| Maksymalny rozmiar indeksu | 96 bajtów |
| Punktów danych na wywołanie Workera | 250 |
| Retencja | 3 miesiące |

Nasz schemat używa 14 blobów, 1 double i 1 indeksu — mieści się z zapasem.

## Przydatne komendy

```bash
# Zapytanie do Analytics Engine
curl -s "https://api.cloudflare.com/client/v4/accounts/1f52c869d091ebf55a2d1789dad4842d/analytics_engine/sql" \
  -H "Authorization: Bearer TOKEN" \
  -d "SELECT blob2 AS sciezka, SUM(_sample_interval) AS odslony
      FROM web_events
      WHERE timestamp > now() - INTERVAL '1' DAY AND blob3 = 'pageview'
      GROUP BY sciezka ORDER BY odslony DESC LIMIT 20"

# Wdrożenie collectora (po zmianach w kodzie)
cd workers/analytics-collector && npx wrangler deploy
#
# UWAGA: wrangler kończy się błędem `Authentication error [code: 10000]` na
# `/zones/…/workers/routes`, bo token konta nie ma uprawnienia Workers Routes.
# To jest błąd uzgadniania tras, nie wdrożenia — skrypt jest już wtedy wgrany
# i działa na trasach wpisanych ręcznie. Sprawdzenie, co faktycznie jest na żywo:
#   curl -s ".../workers/scripts/aura-analytics-collector/deployments"
#   curl -s ".../workers/scripts/aura-analytics-collector/content/v2"

# Logi na żywo
npx wrangler tail aura-analytics-collector

# Archiwum (sesja 3)
npx wrangler d1 execute analytics-archive --remote \
  --command "SELECT * FROM daily_summary ORDER BY date DESC LIMIT 10"
```

## Ruch płatny na rozwod.waw.pl

To jedyny serwis w grupie, na który leci ruch z Google Ads, więc jako jedyny
zamienia wolne ładowanie wprost na przepalony budżet.

Prompt audytowy (wydajność reklamowa + widoczność dla modeli) oraz wzór linku
z parametrami `utm_*` do wklejenia w kampanii: `docs/audyt-rozwod-waw-pl.md`.

**Bez dopisania `utm_*` do adresów docelowych ruch płatny z Google jest
nie do odróżnienia od organicznego** — Google taguje kliknięcia parametrem
`gclid`, którego świadomie nie zapisujemy, więc w panelu obie ścieżki lądują
w kanale „wyszukiwarki".

## Czego to nie zastąpi

Analityka po stronie serwera nie widzi tego, co dzieje się w przeglądarce
bez przeładowania strony: przewijania, kliknięć, zdarzeń w aplikacji SPA.
Nawigacja w aplikacji jednostronicowej wymaga jawnego zgłoszenia zdarzenia
z kodu frontu.

Core Web Vitals też są mierzone wyłącznie w przeglądarce, stąd osobny
skrypt kliencki (`/__vitals.js`, patrz „Core Web Vitals"). To jedyny element
działający po stronie użytkownika.

Wykrywanie botów opiera się u nas na wzorcach User-Agenta, bo
`request.cf.botManagement` wymaga płatnego Bot Management, a nasze strefy są
na planie Free. Kod czyta wynik Bot Management, jeśli kiedyś się pojawi.
