/**
 * Skrypt Core Web Vitals wstrzykiwany na mierzone strony.
 *
 * To jedyny element analityki Aura działający po stronie użytkownika. Powód
 * jest twardy: czas do największego elementu, skakanie treści i opóźnienie
 * reakcji na kliknięcie istnieją wyłącznie w przeglądarce. Serwer ich nie widzi
 * i nigdy nie zobaczy, choćby odpowiadał w 5 ms.
 *
 * Trzymamy go jako tekst, a nie jako moduł, bo ten kod nie wykonuje się
 * w Workerze — Worker go tylko serwuje pod `/__vitals.js`. Tekst zamiast
 * `Function.prototype.toString()` z prawdziwej funkcji jest świadomy: bundler
 * Workera przepisuje ciała funkcji przy budowaniu, więc to, co poszłoby do
 * przeglądarki, zależałoby od wersji esbuilda. Tekst idzie zawsze taki, jaki
 * jest tutaj napisany.
 *
 * Zasady, które ten skrypt musi trzymać:
 *  1. Nigdy nie psuje strony. Całość w try/catch, żaden błąd nie wychodzi
 *     na zewnątrz, brak API w starszej przeglądarce kończy pomiar po cichu.
 *  2. Nie zapisuje query stringu. Wysyła `location.pathname`, nigdy `href` —
 *     inaczej tokeny resetu hasła jechałyby do analityki.
 *  3. Jedno zgłoszenie na odsłonę, wysyłane, gdy karta znika. Bez pollingu,
 *     bez ciasteczek, bez identyfikatora nadawanego w przeglądarce.
 */

/** Ile milisekund musi trwać interakcja, żeby przeglądarka ją zgłosiła. */
const EVENT_THRESHOLD = 40;

export const VITALS_SCRIPT = `(function () {
  'use strict';
  try {
    if (!window.PerformanceObserver || !navigator.sendBeacon) return;

    var metrics = {};
    var sent = false;

    function record(name, value) {
      if (typeof value !== 'number' || !isFinite(value) || value < 0) return;
      // LCP i INP rosną w trakcie życia strony; zostaje ostatnia (największa)
      // wartość, bo to ona opisuje, co człowiek faktycznie zobaczył i przeżył.
      metrics[name] = value;
    }

    function observe(type, handler, options) {
      try {
        var po = new PerformanceObserver(function (list) {
          var entries = list.getEntries();
          for (var i = 0; i < entries.length; i++) handler(entries[i]);
        });
        po.observe(Object.assign({ type: type, buffered: true }, options || {}));
        return po;
      } catch (e) {
        // Przeglądarka nie zna tego typu wpisu — nie mierzymy go i tyle.
        return null;
      }
    }

    // --- Pierwszy bajt i pierwsza treść -------------------------------------
    var nav = performance.getEntriesByType('navigation')[0];
    if (nav) record('TTFB', nav.responseStart);

    observe('paint', function (entry) {
      if (entry.name === 'first-contentful-paint') record('FCP', entry.startTime);
    });

    // --- Największy element -------------------------------------------------
    observe('largest-contentful-paint', function (entry) {
      record('LCP', entry.startTime);
    });

    // --- Skakanie treści ----------------------------------------------------
    // CLS to nie suma wszystkich przesunięć, tylko największe okno sesji:
    // przesunięcia dzielone przerwą dłuższą niż sekunda albo trwające ponad
    // pięć sekund zaczynają nowe okno. Suma zawyżałaby wynik długich stron.
    var cls = 0;
    var windowValue = 0;
    var windowFirst = 0;
    var windowLast = 0;

    observe('layout-shift', function (entry) {
      if (entry.hadRecentInput) return;
      if (windowValue && entry.startTime - windowLast < 1000 && entry.startTime - windowFirst < 5000) {
        windowValue += entry.value;
      } else {
        windowValue = entry.value;
        windowFirst = entry.startTime;
      }
      windowLast = entry.startTime;
      if (windowValue > cls) {
        cls = windowValue;
        record('CLS', cls);
      }
    });

    // --- Reakcja na kliknięcie ---------------------------------------------
    // To przybliżenie INP: bierzemy najdłuższą interakcję zamiast wysokiego
    // percentyla wszystkich. Dla stron ofertowych z kilkoma kliknięciami na
    // odsłonę obie liczby są tą samą liczbą; przy dziesiątkach interakcji
    // nasza jest pesymistyczna, czyli myli się w bezpieczną stronę.
    var worstInteraction = 0;
    observe(
      'event',
      function (entry) {
        if (!entry.interactionId) return;
        if (entry.duration > worstInteraction) {
          worstInteraction = entry.duration;
          record('INP', worstInteraction);
        }
      },
      { durationThreshold: ${EVENT_THRESHOLD} }
    );

    // --- Wysyłka ------------------------------------------------------------
    function send() {
      if (sent) return;
      var names = Object.keys(metrics);
      if (names.length === 0) return;
      sent = true;

      var payload = { p: location.pathname, m: [] };
      for (var i = 0; i < names.length; i++) {
        // Zaokrąglenie: milisekundy do liczby całkowitej, CLS do trzech miejsc.
        var value = metrics[names[i]];
        payload.m.push([names[i], names[i] === 'CLS' ? Math.round(value * 1000) / 1000 : Math.round(value)]);
      }

      try {
        // text/plain czyni z tego żądanie proste — bez preflightu, który i tak
        // nie miałby na co odpowiedzieć, bo endpoint świadomie nie ma CORS.
        navigator.sendBeacon('/__vitals', new Blob([JSON.stringify(payload)], { type: 'text/plain' }));
      } catch (e) {
        /* Nieudana wysyłka pomiaru to nie jest problem użytkownika. */
      }
    }

    // Karta znika: przełączenie karty, zamknięcie, przejście w tło na telefonie.
    // 'visibilitychange' łapie wszystkie te przypadki, a 'pagehide' domyka
    // Safari, które potrafi wyjść z bfcache bez zdarzenia widoczności.
    addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') send();
    });
    addEventListener('pagehide', send);
  } catch (e) {
    /* Analityka nie ma prawa zepsuć strony. Żaden błąd stąd nie wychodzi. */
  }
})();
`;
