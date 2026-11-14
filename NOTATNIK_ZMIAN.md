# Notatnik zmian projektu — SUPERBETSSS LIVE Monitor

Ten plik jest stałym dziennikiem zmian projektu. Każda kolejna modyfikacja aplikacji powinna być dopisywana w tym pliku na górze listy (od najnowszych do najstarszych).

---

## [2026-11-14 10:18] — Panel powiadomień przeglądarkowych i alerty w tle (potencjalna przewaga 3+ goli)
- **Utworzone / zmodyfikowane pliki**: `web/sw.js`, `server.ts`, `web/index.html`, `web/app.js`, `web/styles.css`, `NOTATNIK_ZMIAN.md`
- **Backend (`server.ts`)**:
  - Rozszerzono `Settings`, `DEFAULT_SETTINGS` oraz walidację `PUT /api/settings` o ustawienia alertów przeglądarkowych: `notify_enabled`, `notify_potential`, `notify_primary`, `notify_high_scoring`, `notify_close_finish`, `notify_sound`, `notify_cooldown_seconds`.
- **Service Worker & praca w tle (`web/sw.js`, `web/app.js`)**:
  - Dodano Service Worker (`web/sw.js`) obsługujący powiadomienia systemowe (`showNotification`) oraz przejście bezpośrednio do wybranego meczu po kliknięciu alertu (`notificationclick` → `SELECT_MATCH`).
  - Przeniesiono pętlę odświeżania (`/api/live` co 20 s) i ewaluacji co 1 s do Web Workera (`Blob`), dzięki czemu przeglądarka nie wstrzymuje odświeżania i sprawdzania alertów po zminimalizowaniu lub przełączeniu karty.
- **Interfejs (`web/index.html`, `web/styles.css`, `web/app.js`)**:
  - Dodano panel **Powiadomienia przeglądarkowe** (`#notifyPanel`) oraz szybki przycisk statusu w nagłówku (`#notifyToggleChip`).
  - Umożliwiono wybór wyzwalaczy (domyślnie włączone **Potencjalna przewaga 3+ goli** oraz **Potwierdzona przewaga 3+ goli**), sygnału dźwiękowego Web Audio, odstępu powtórzeń per mecz (`30 s`, `60 s`, `120 s`, `300 s` lub `Raz na mecz`) i testowego alertu (`Wyślij test`).
  - Dodano listę wysłanych alertów z przejściem do szczegółów meczu oraz powiadomienia toast w rogu ekranu jako fallback.

---

## [2026-11-14 10:15] — Przewidywanie przewagi 3+ (z 2 goli), tryby podświetleń i własne kolory
- **Zmodyfikowane pliki**: `server.ts`, `web/index.html`, `web/app.js`, `web/styles.css`, `NOTATNIK_ZMIAN.md`
- **Backend (`server.ts`)**:
  - Rozszerzono `Settings` i `DEFAULT_SETTINGS` o konfigurację 4 poziomów podświetleń i ich kolorów (`#RRGGBB`) oraz opcję barwienia całych wierszy/kart (`highlight_row_tint`):
    1. **Potwierdzona duża przewaga** (`highlight_enabled`, `highlight_goal_difference`, `highlight_remaining_seconds`, `highlight_color`),
    2. **Zanoszące się na 3+ goli** przy obecnej przewadze 2 bramek (`potential_enabled`, `potential_goal_difference`, `potential_remaining_seconds`, `potential_min_total_goals`, `potential_color`),
    3. **Wysokie tempo bramkowe / rozstrzelany mecz** (`high_scoring_enabled`, `high_scoring_min_goals`, `high_scoring_color`),
    4. **Końcówka na styku** przy różnicy 0–1 gola (`close_finish_enabled`, `close_finish_remaining_seconds`, `close_finish_color`).
  - Dodano walidację wszystkich nowych parametrów i kolorów hex w `PUT /api/settings`.
  - Dodano wykrywanie ostatniego strzelca (`lastScorerSide(matchKey)` → `last_scorer_side`) w `GET /api/live` na podstawie historii odczytów do oceny momentum lidera.
  - Dodano mecz testowy `demo-8` (`Lech_eFC — Legia_eFC`, 2. połowa, przewaga 2 goli z ostatnim golem lidera) prezentujący kategorię „zanoszących się na 3+”.
- **Frontend (`web/index.html`, `web/app.js`, `web/styles.css`)**:
  - Dodano silnik prognozujący `computePrediction(match)` wyliczający tempo bramek/min, przewidywaną sumę goli, prognozowaną różnicę na koniec oraz momentum ostatniego gola — prezentowany w sekcji `PRZEWIDYWANIE I TEMPO` w panelu szczegółów.
  - Dodano filtr `#highlightFilter` oraz klikalną legendę `#highlightLegend` pokazującą liczbę aktywnych meczów dla każdej włączonej reguły w wybranym przez użytkownika kolorze.
  - Rozbudowano okno ustawień (`#settingsDialog`) o progi wszystkich 4 reguł, selektory kolorów (`<input type="color">`) z szybkimi próbkami barw, przełącznik barwienia całych wierszy/kart oraz przycisk `Przywróć domyślne`.

---

## [2026-11-14 10:03] — Zegar panelu, czas strony Superbet i odliczanie do odświeżenia meczów
- **Zmodyfikowane pliki**: `server.ts`, `web/index.html`, `web/app.js`, `web/styles.css`, `NOTATNIK_ZMIAN.md`
- **Backend (`server.ts`)**:
  - Dodano obsługę opcjonalnych pól `superbetTime` oraz `superbetClockText` w `POST /snapshot` i wyliczanie przesunięcia czasu źródła (`superbetTimeOffsetMs`).
  - Rozszerzono odpowiedź `GET /api/live` o pola `superbet_time`, `superbet_time_label` i `superbet_snapshot_at`.
- **Frontend (`web/index.html`, `web/app.js`, `web/styles.css`)**:
  - W sekcji `.hero-meta` (nad przyciskami sterowania) dodano blok `.hero-times` wyświetlający na bieżąco co sekundę:
    - **Aktualna godzina** (`#currentClock`, czas lokalny przeglądarki),
    - **Czas strony Superbet** (`#superbetClock`, czas `Europe/Warsaw` z uwzględnieniem przesunięcia z migawki lub etykiety ze strony Superbet),
    - **Odświeżenie meczów za** (`#nextRefreshCountdown`, odliczanie `20 s → 1 s` do kolejnego pobrania danych, resetowane także przy ręcznym odświeżeniu),
    - **Ostatni odczyt panelu** (`#lastUpdate`).

---

## [2026-11-14 10:00] — Utworzenie stałego notatnika zmian
- **Plik**: `NOTATNIK_ZMIAN.md`
- **Zmiana**: Utworzono stały dziennik zmian w katalogu głównym projektu, zbierający pełną historię wykonanych prac od momentu pobrania repozytorium.

---

## [2026-11-14 09:57] — Czas rozpoczęcia, przewidywany koniec oraz doliczony czas i przerwy
- **Zmodyfikowane pliki**: `server.ts`, `web/index.html`, `web/app.js`, `web/styles.css`
- **Backend (`server.ts`)**:
  - Rozszerzono `NormalizedMatch` o pola: `started_at`, `estimated_end_at`, `added_time_seconds`, `break_seconds`, `added_time_note`, `in_break`, `in_added_time`.
  - Rozszerzono `normalizeMatch(...)` o obsługę opcjonalnych pól wejściowych (`addedTimeSeconds` / `addedTime` / `extraSeconds`, `breakSeconds` / `halftimeBreakSeconds`, `addedTimeNote`, `startedAt`) oraz wyliczanie `started_at`, `estimated_end_at` i całkowitego `remaining_seconds` z uwzględnieniem przerw i doliczonego czasu.
  - Zaktualizowano `projectMatchAt(...)` o 4-fazową symulację w czasie rzeczywistym: `1. połowa → Przerwa → 2. połowa → Doliczony czas`.
  - Dodano przykładowe wartości doliczonego czasu i przerw do 7 meczów testowych `DEMO`.
  - Rozszerzono eksport `GET /api/export.csv` o kolumny `added_time_seconds`, `break_seconds`, `started_at`, `estimated_end_at`.
- **Frontend (`web/index.html`, `web/app.js`, `web/styles.css`)**:
  - Zastąpiono kolumnę `Liga` w tabeli kolumną `Start / koniec` (godzina rozpoczęcia i przewidywanego zakończenia).
  - Dodano oznaczenia doliczonego czasu i przerw (`.extra-tag`) w tabeli, widoku kart oraz w kafelku `Najbliżej końca`.
  - Rozszerzono panel `Szczegóły meczu` o pola: `Rozpoczęcie`, `Przew. koniec`, `Doliczony czas`, `Przerwy` oraz podsumowanie pod analizą automatyczną (`#detailExtraNote`).
  - Zsynchronizowano przeliczanie fazy meczu w `liveMatch(...)` względem `remaining_seconds`.

---

## [2026-11-14 09:53] — Bieżące odliczanie czasu do końca rozgrywek (live co sekundę)
- **Zmodyfikowane pliki**: `server.ts`, `web/app.js`
- **Backend (`server.ts`)**:
  - Dodano `formatClockLabel(...)` i `projectMatchAt(...)`, które na bieżąco aktualizują `half`, `half_label`, `clock_seconds`, `clock_label` oraz `remaining_seconds` zgodnie z upływem czasu od `observed_at`.
  - Dodano pole `server_time` do odpowiedzi `GET /api/live`.
  - Dla trybu `DEMO` włączono płynne zapętlanie cyklu meczu po dojściu do `0:00`.
- **Frontend (`web/app.js`)**:
  - Dodano sekundowy timer (`tickTimer` co `1000 ms`) aktualizujący w czasie rzeczywistym odliczanie `Do końca`, zegar i połowę meczu, kafelek `Najbliżej końca`, wiek źródła, podświetlenie lidera oraz szczegóły wybranego meczu (z synchronizacją co 20 s przez `/api/live`).

---

## [2026-11-14 09:49] — Dodanie testowych aktualnych meczów z każdego rodzaju (tryb DEMO)
- **Zmodyfikowane pliki**: `server.ts`, `web/index.html`, `web/app.js`
- **Zakres zmian**:
  - Dodano funkcję `seedDemoMatches()` tworzącą 7 meczów testowych `[DEMO]` wraz z historią odczytów:
    1. `Gracz Alpha` vs `Gracz Beta` (2×5 min, 2. połowa, aktywny, podświetlenie lidera gospodarzy ≥3 gole w końcówce),
    2. `Real_eSport` vs `City_Pro` (2×4 min, 2. połowa, aktywny, podświetlenie lidera gości ≥3 gole w końcówce),
    3. `Kowalski_PL` vs `Nowak_FIFA` (2×6 min, 2. połowa, `oferta wstrzymana`, remis w końcówce),
    4. `Arsenal_eFC` vs `Inter_eFC` (2×8 min, 2. połowa, aktywny, przewaga 1 gola),
    5. `PSG_eSports` vs `Bayern_eSports` (2×5 min, 1. połowa, aktywny),
    6. `FC Vortex` vs `Apex United` (2×10 min, 1. połowa, `oferta wstrzymana`, remis),
    7. `Team_X` vs `Team_Y` (2. połowa, nierozpoznany format → `szacunek` na końcu listy).
  - Dodano endpointy `POST /api/demo/load` oraz `POST /api/demo/clear` i przycisk `Załaduj testowe` / `Wyczyść testowe` w interfejsie z wyraźnym oznaczeniem `Dane testowe (DEMO)`.
  - Nadejście prawdziwego `POST /snapshot` z Chrome automatycznie wyłącza tryb DEMO i przełącza panel na dane LIVE.

---

## [2026-11-14 09:46] — Migracja repozytorium SUPERBETSSS do Node.js / Express
- **Źródło**: `https://github.com/eskejtpro/SUPERBETSSS`
- **Utworzone / zmodyfikowane pliki**: `server.ts`, `web/index.html`, `web/app.js`, `web/styles.css`, `package.json`, `metadata.json`, `index.html`, `README.md` (usunięto `bun.lock`)
- **Zakres zmian**:
  - Zmigrowano backend z Pythona (`app.py`) do TypeScript / Express (`server.ts`) działającego na `0.0.0.0:3000` (`npm run dev` → `tsx server.ts`, `npm start` → `node server.ts`).
  - Zachowano wszystkie endpointy API: `POST /snapshot`, `GET /api/live`, `GET /api/health`, `GET /api/history`, `GET /api/settings`, `PUT /api/settings`, `GET /api/export.json`, `GET /api/export.csv`.
  - Zastąpiono lokalny SQLite i zapis plików ustawień przechowywaniem w pamięci operacyjnej (`Map` / `Array`) zgodnym ze środowiskiem kontenerowym.
  - Przeniesiono oryginalny frontend statyczny `web/` bez zmian wizualnych; zastąpiono `window.alert` w `web/app.js` nieblokującym komunikatem statusu i logiem w konsoli.
  - Zaktualizowano `metadata.json` oraz tagi `<title>` / `<meta>` w `index.html`.
