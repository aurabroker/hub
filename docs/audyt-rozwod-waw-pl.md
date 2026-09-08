# Audyt rozwod.waw.pl — wydajność reklamowa i widoczność dla modeli

Ten katalog trzyma dwie rzeczy: **prompt audytowy** do wklejenia agentowi
z dostępem do sieci oraz **wzór linku UTM** do kampanii Google Ads.

rozwod.waw.pl jest jedynym serwisem Aura, na który leci ruch płatny, więc każda
złotówka przepalona na wolnej albo źle dopasowanej stronie docelowej jest
kosztem realnym, nie teoretycznym.

---

## Część 1 — prompt audytowy

Wklej poniższy blok agentowi, który potrafi otworzyć stronę i sprawdzić
dokumentację. Prompt jest samowystarczalny.

```
Jesteś audytorem strony docelowej kampanii Google Ads. Twoim jedynym celem
jest obniżenie kosztu pozyskania leada z rozwod.waw.pl i zwiększenie szansy,
że asystenci AI zacytują tę stronę, gdy ktoś pyta ich o rozwód w Warszawie.

## Kontekst

Serwis:        https://rozwod.waw.pl
Branża:        usługi prawne, rozwody, Warszawa
Model biznesu: lead z formularza i telefonu, nie sprzedaż online
Infrastruktura: Cloudflare, strona statyczna (żadnego PHP ani WordPressa)
Ruch płatny:   Google Ads, wyłącznie ten serwis w całej grupie
Analityka:     własna, po stronie serwera, bez ciasteczek

Czas odpowiedzi serwera zmierzony 2026-09: 55 ms w 75. percentylu,
181 ms w 95. To jest czas SAMEGO SERWERA. Nie mów mi, że strona jest
szybka, dopóki nie zmierzysz, co widzi człowiek w przeglądarce.

## Zasady bezwzględne

1. Żadnych wniosków z pamięci. Każdy próg, limit i nazwa wskaźnika ma być
   sprawdzony w aktualnym źródle i zacytowany z adresem. Progi Core Web
   Vitals bierz z web.dev, wytyczne jakości strony docelowej z pomocy
   Google Ads. Jeśli czegoś nie da się sprawdzić, napisz „nie zweryfikowano"
   zamiast zgadywać.
2. Otwórz stronę naprawdę. Zmierz, nie opisuj wrażeń. Podaj liczby.
3. Mierz osobno telefon i komputer. W tej branży większość kliknięć
   w reklamę to telefon, a wyniki potrafią różnić się dwukrotnie.
4. Każde znalezisko ma mieć oszacowany wpływ na pieniądze i koszt naprawy.
   Znalezisko bez tego jest ciekawostką, nie rekomendacją.
5. Nie proponuj przebudowy strony, dopóki nie wyczerpiesz zmian tanich.

## Zadanie A — czy strona przepala budżet

A1. Core Web Vitals z danych terenowych (CrUX) i z pomiaru laboratoryjnego.
    Dla LCP, INP i CLS podaj wartość, próg i werdykt. Osobno mobile,
    osobno desktop. Jeśli danych terenowych brak z powodu małego ruchu,
    powiedz to wprost — to jest informacja, nie porażka pomiaru.

A2. Rozbierz LCP na czynniki: czas do pierwszego bajtu, blokujące zasoby,
    moment pojawienia się największego elementu. Wskaż konkretny element,
    który jest LCP, i konkretny plik, który go opóźnia.

A3. Waga strony. Wypisz dziesięć najcięższych zasobów z rozmiarem
    i formatem. Zwróć uwagę na obrazy bez WebP lub AVIF, fonty ładowane
    z zewnątrz, skrypty firm trzecich i baner zgody, jeśli istnieje.

A4. Ścieżka do konwersji. Policz, ile kliknięć i ile przewinięć dzieli
    wejście od wysłania formularza. Sprawdź, czy numer telefonu jest
    klikalny na telefonie, ile pól ma formularz i czy któreś jest zbędne.
    Każde dodatkowe pole to spadek liczby zgłoszeń.

A5. Zgodność przekazu. Zestaw najważniejsze słowa kluczowe kampanii
    z nagłówkiem H1 i pierwszym akapitem. Człowiek, który kliknął reklamę
    o alimentach i widzi ogólną stronę kancelarii, wraca do wyników
    wyszukiwania, a kliknięcie jest opłacone.

A6. Sprawdź, czy adresy docelowe reklam faktycznie działają. Nasza
    analityka pokazała, że na mierzonych serwisach adresy /kontakt, /o-nas,
    /oferta i /team zwracają 404. Reklama kierująca na taki adres to
    czysta strata. Wypisz każdy nieistniejący adres, który znajdziesz
    w linkach wewnętrznych i w rozszerzeniach reklam.

A7. Zaufanie. Czy widać nazwę kancelarii, adres, NIP, numer wpisu na listę
    i twarz człowieka. W usługach prawnych brak tych elementów kosztuje
    konwersję niezależnie od szybkości.

## Zadanie B — czy modele widzą tę stronę

Coraz więcej osób pyta o rozwód asystenta AI, a nie wyszukiwarkę. To jest
kanał, którego nie da się kupić, więc trzeba w nim być obecnym treścią.

B1. Czy treść jest w HTML odesłanym przez serwer, czy dorysowywana
    JavaScriptem. Pobierz stronę bez wykonywania skryptów i sprawdź, ile
    treści zostaje. Modele zwykle nie uruchamiają JS — to, czego nie ma
    w surowym HTML, dla nich nie istnieje.

B2. robots.txt. Wypisz, które roboty AI są dopuszczone, a które
    zablokowane: GPTBot, ClaudeBot, PerplexityBot, Google-Extended,
    CCBot, Bytespider. Nie zakładaj, że blokada jest błędem — najpierw
    powiedz, co blokujemy i jaki to ma skutek, a decyzję zostaw właścicielowi.

B3. Dane strukturalne. Sprawdź obecność i poprawność schematów
    LegalService lub Attorney, LocalBusiness, FAQPage. Podaj, czego brakuje
    i jaki fragment kodu dopisać.

B4. Cytowalność. Modele cytują konkretne zdania z liczbami i datami.
    Znajdź pięć pytań, które ludzie realnie zadają o rozwód w Warszawie
    (ile kosztuje, ile trwa, co z dziećmi, co z mieszkaniem, czy trzeba
    do sądu) i sprawdź, czy strona odpowiada na nie wprost, jednym
    akapitem, który da się zacytować bez kontekstu. Jeśli nie, napisz
    brakujące akapity.

B5. Sygnały świeżości i autorstwa: data aktualizacji, imię i nazwisko
    autora, jego kwalifikacje. Sprawdź, czy są w HTML, nie tylko na obrazku.

B6. Sprawdź, czy istnieje plik llms.txt i czy ta konwencja jest wciąż
    aktualna. Jeśli tak, zaproponuj treść.

## Zadanie C — zweryfikuj wnioski naszymi danymi

W panelu HUB pod adresem /analityka, po wybraniu serwisu rozwod.waw.pl,
sprawdź: kanały ruchu, ruch z kampanii, adresy z błędem i mapę godzin.
Zestaw to ze swoimi ustaleniami. Jeśli twoje wnioski są sprzeczne
z danymi, dane wygrywają.

Uwaga: ruch płatny z Google Ads pokaże się w kanale „wyszukiwarki",
a nie „kampanie", dopóki do adresów docelowych nie zostaną dopisane
parametry utm_*. Google taguje kliknięcia identyfikatorem gclid,
którego świadomie nie zapisujemy.

## Format odpowiedzi

Najpierw jedno zdanie werdyktu: czy ta strona nadaje się dziś pod ruch
płatny.

Potem tabela znalezisk posortowana wg wpływu na pieniądze:

| Problem | Dowód (liczba) | Wpływ | Koszt naprawy | Priorytet |

Potem trzy rzeczy do zrobienia w tym tygodniu, każda z gotową instrukcją,
nie z ogólnikiem. Potem reszta.

Na końcu osobno wypisz to, czego nie udało ci się sprawdzić i dlaczego.
```

---

## Część 2 — link z UTM do Google Ads

### Co wpisać

Nie doklejaj parametrów do każdej reklamy osobno. Użyj pola **Sufiks
finalnego adresu URL** (Final URL suffix) na poziomie kampanii. Wtedy działa
dla wszystkich reklam i nie psuje samego adresu docelowego. Bez znaku
zapytania na początku:

```
utm_source=google&utm_medium=cpc&utm_campaign=rozwod-warszawa&utm_content=grupa-alimenty&utm_term={keyword}
```

Pełny adres, gdybyś jednak wolał wpisać go wprost w reklamie:

```
https://rozwod.waw.pl/?utm_source=google&utm_medium=cpc&utm_campaign=rozwod-warszawa&utm_content=grupa-alimenty&utm_term={keyword}
```

### Dlaczego dokładnie te wartości

| Parametr | Wartość | Skąd |
|---|---|---|
| `utm_source` | `google` | kanoniczna wartość ze słownika `utm_presets` |
| `utm_medium` | `cpc` | kanoniczna wartość ze słownika `utm_presets` |
| `utm_campaign` | nazwa kampanii, np. `rozwod-warszawa` | wpisujesz ręcznie, jedna na kampanię |
| `utm_content` | nazwa grupy reklam, np. `grupa-alimenty` | wpisujesz ręcznie, jedna na grupę |
| `utm_term` | `{keyword}` | ValueTrack, Google podstawia słowo kluczowe |

`utm_campaign` i `utm_content` wpisuj słowami, nie identyfikatorami. Google
udostępnia `{campaignid}` i `{adgroupid}`, ale w panelu zobaczysz wtedy ciągi
cyfr, z których nic nie wynika.

### Czego nie ruszać

**Automatyczne tagowanie (auto-tagging) zostaw włączone.** Parametr `gclid`
jest potrzebny do importu konwersji w Google Ads. My go nie zapisujemy, bo to
identyfikator pojedynczego kliknięcia konkretnej osoby, ale on nadal działa po
stronie Google i nie koliduje z `utm_*`.

### Jak to wygląda po naszej stronie

Collector normalizuje wartości tą samą funkcją co generator linków w HUB:
polskie znaki na ASCII, małe litery, znaki specjalne na myślnik, maksymalnie
64 znaki. Słowo kluczowe `Rozwód Warszawa cena` zapisze się więc jako
`rozwod-warszawa-cena`.

Efekt zobaczysz w dwóch miejscach:

- `/analityka` → sekcja **Ruch z kampanii**: ile wejść faktycznie doszło
  na stronę, w rozbiciu na kampanię i grupę reklam,
- `/analityka` → **Kanały ruchu**: ruch płatny przestanie się zlewać
  z organicznym z Google i trafi do kategorii „Kampanie".

### Sprawdzenie po wdrożeniu

Otwórz raz pełny adres z tabeli powyżej, podmieniając `{keyword}` na dowolne
słowo. Po kilku minutach wejście musi być widoczne w sekcji Ruch z kampanii.
Jeśli go nie ma, parametry nie dolatują i nie ma sensu czekać na dane
z prawdziwych kliknięć.
