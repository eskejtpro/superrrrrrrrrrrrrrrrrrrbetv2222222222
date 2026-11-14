# SUPERBETSSS LIVE Monitor

Lokalny panel WWW w Pythonie do obserwacyjnej analizy aktualnie widocznych meczów e-piłki nożnej live. Nie składa zakładów, nie tworzy kuponów i nie odczytuje danych konta.

Po uruchomieniu panel jest dostępny pod `http://127.0.0.1:8765`.

Uruchomienie: `python app.py` albo dwukrotnie kliknij `Uruchom panel.bat`.

Pełne przygotowanie środowiska opisuje [SETUP.md](SETUP.md). Dokumentacja techniczna i prompt przekazania projektu do Google AI Studio znajdują się w [docs/GOOGLE_AI_STUDIO_HANDOFF.md](docs/GOOGLE_AI_STUDIO_HANDOFF.md) oraz [docs/GOOGLE_AI_STUDIO_PROMPT.md](docs/GOOGLE_AI_STUDIO_PROMPT.md).

## Zakres monitoringu LIVE

Panel pokazuje wyłącznie mecze, dla których rozszerzenie Chrome rozpoznało numer połowy (1 lub 2) oraz zegar spotkania. Widok i API odświeżają się co 20 sekund. Mecze są sortowane od najkrótszego szacowanego czasu do końca. Po utracie sygnału z Chrome starsze mecze są ukrywane jako nieaktualne, ale historia pozostaje w lokalnej bazie SQLite.

**Ważne ograniczenie:** rozszerzenie odczytuje mecze dostępne w aktualnie załadowanym DOM strony Superbet. Jeżeli serwis ładuje dalsze spotkania dopiero po przewinięciu, zmianie zakładki lub doładowaniu listy, aplikacja nie może zagwarantować ich wykrycia, dopóki nie pojawią się w DOM. Licznik w panelu oznacza liczbę rozpoznanych meczów, a nie potwierdzoną liczbę wszystkich spotkań na serwerach Superbet.

## Podświetlanie drużyny prowadzącej pod koniec meczu

Panel może wyróżniać drużynę prowadzącą, jeśli jednocześnie:
- różnica wyniku osiąga skonfigurowane minimum (domyślnie 3 gole),
- szacowany czas do końca meczu mieści się w skonfigurowanym oknie (domyślnie 90 sekund).

Ustawienia są dostępne w ⚙ Ustawienia panelu. Można wyłączyć funkcję, zmienić minimalną przewagę (1–10 goli) oraz okno końcowe (15–600 sekund). Wyróżnienie jest prezentacyjne i nie stanowi prognozy wyniku. Dokładność zależy od poprawności formatu, połowy i zegara odczytanych ze źródła.

## Testy

Uruchom z katalogu projektu: `python -m unittest discover -s tests -v`.
