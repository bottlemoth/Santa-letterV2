# 🎄 Santa Letter

Santa Letter to aplikacja webowa do wspólnych list prezentowych dla rodziny i znajomych. Użytkownicy tworzą grupy, publikują listy życzeń na różne okazje i **zaklepują** prezenty dla innych. Rezerwacje widzą wszyscy członkowie grup **poza właścicielem listy**, więc nikt nie kupi dwa razy tego samego, a niespodzianka zostaje niespodzianką.

Tryb **„Niespodzianka”** idzie dalej: właściciel listy podaje tylko wskazówki (zainteresowania, rozmiary, budżet, czego nie chce), a bliscy dodają **tajne pomysły**, których on nigdy nie zobaczy.

---

## Spis treści

1. [Funkcje](#funkcje)
2. [Wymagania systemowe](#wymagania-systemowe)
3. [Szybki start (Docker Compose)](#szybki-start-docker-compose)
4. [Konfiguracja `.env`](#konfiguracja-env)
5. [Polecenia Docker Compose](#polecenia-docker-compose)
6. [Wdrożenie na serwer (VPS)](#wdrożenie-na-serwer-vps) · [Uruchomienie bez Dockera](#uruchomienie-bez-dockera)
7. [Konta demonstracyjne](#konta-demonstracyjne)
8. [Testy](#testy)
9. [Struktura projektu](#struktura-projektu)
10. [Model danych](#model-danych)
11. [API](#api)
12. [Ochrona niespodzianki](#ochrona-niespodzianki)
13. [Bezpieczeństwo](#bezpieczeństwo)
14. [Kluczowe decyzje techniczne](#kluczowe-decyzje-techniczne)
15. [Ograniczenia MVP](#ograniczenia-mvp)

---

## Funkcje

- **Konta:** rejestracja (imię, e-mail, hasło), logowanie, wylogowanie, edycja profilu (zmiana e-maila lub hasła wymaga podania aktualnego hasła).
- **Grupy:** rodzinne lub znajomych, z nazwą i opisem; dołączanie **kodem lub linkiem** (`/#/join/KOD`); role *administrator* i *członek*. Administrator edytuje grupę, generuje nowy kod, usuwa członków i przekazuje własność. Administrator musi przekazać własność, zanim opuści grupę; ostatni członek, który ją opuszcza, usuwa grupę.
- **Listy prezentowe:** wiele list na różne okazje (Boże Narodzenie, urodziny, rocznica, własna okazja), z opisem, datą i statusem aktywna/archiwalna. Lista jest widoczna dla członków **wszystkich** grup właściciela.
- **Pozycje:** nazwa, link, zdjęcie (plik **lub** adres URL), uwagi, cena, waluta (domyślnie PLN), priorytet.
- **Zaklepywanie:** atomowe, globalne (jedna rezerwacja na pozycję niezależnie od liczby grup), z możliwością anulowania przez autora.
- **Tryb „Niespodzianka”:** profil wskazówek i tajne pomysły (automatycznie zaklepane przez autora, z prywatną uwagą widoczną tylko dla niego).
- **Powiadomienia w aplikacji:** dołączenie do grupy, usunięcie z grupy, przekazanie własności, nowa lista, zbliżająca się okazja (≤ 14 dni), usunięcie zaklepanej pozycji lub listy. Można oznaczyć pojedyncze powiadomienie albo wszystkie jako przeczytane.
- **Interfejs** w całości po polsku, responsywny, dostępny z klawiatury, w świątecznej, stonowanej kolorystyce.

## Wymagania systemowe

| Sposób uruchomienia | Wymagania |
|---|---|
| Docker (zalecany) | Docker Engine 24+ z Docker Compose v2 |
| Lokalnie | Node.js 20+ (testowane na 22), npm 10+, PostgreSQL 14+ (testowane na 16) |

## Szybki start (Docker Compose)

```bash
# 1. Konfiguracja: skopiuj plik i ustaw własne sekrety
cp .env.example .env
#    Wygeneruj SESSION_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#    i wpisz go do .env razem z silnym POSTGRES_PASSWORD

# 2. Zbuduj obrazy i uruchom stos (migracje wykonają się automatycznie)
docker compose up --build

# 3. (opcjonalnie, w drugim terminalu) załaduj dane demonstracyjne
docker compose exec app npm run seed
```

Aplikacja będzie dostępna pod adresem **http://localhost:3000** (port zmienisz przez `APP_PORT`).

Co się dzieje przy starcie:

1. `db` (PostgreSQL 16) startuje i zgłasza gotowość przez healthcheck `pg_isready`.
2. `app` czeka na stan `service_healthy` bazy (`depends_on.condition`).
3. Entrypoint aplikacji wykonuje `node-pg-migrate up`, a potem uruchamia serwer.
4. Healthcheck aplikacji (`GET /healthz`) sprawdza również połączenie z bazą.

> W hasłach w `.env` unikaj znaków `@ : / ? # %`, ponieważ `DATABASE_URL` jest składany z nich bez kodowania URL.

## Konfiguracja `.env`

| Zmienna | Opis | Domyślnie |
|---|---|---|
| `SESSION_SECRET` | Sekret podpisujący ciasteczko sesji (min. 32 znaki w produkcji) | **wymagane** |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Dane bazy (kontener `db` i aplikacja) | **wymagane** |
| `APP_PORT` | Port aplikacji na hoście | `3000` |
| `NODE_ENV` | Środowisko | `production` |
| `COOKIE_SECURE` | `true`, gdy aplikacja działa za HTTPS (flaga `Secure`, HSTS) | `false` |
| `TRUST_PROXY` | Liczba zaufanych proxy (np. `1` za nginx) | `0` |
| `MAX_UPLOAD_BYTES` | Limit rozmiaru zdjęcia | `5242880` (5 MB) |
| `DB_HOST_PORT` | Port PostgreSQL wystawiony na **127.0.0.1** hosta | `5433` |
| `DATABASE_URL` | Tylko przy uruchomieniu poza Dockerem | — |
| `TEST_DATABASE_URL` | Baza testowa (nazwa musi zawierać „test”) | — |

W Compose aplikacja łączy się z bazą przez nazwę usługi: `postgres://…@db:5432/…`. Plik `.env` jest w `.gitignore` i `.dockerignore`, a sekrety nie są wpisane na stałe w `compose.yaml` ani w `Dockerfile`. Składnia `${VAR:?…}` przerywa start, gdy brakuje wymaganej zmiennej.

## Polecenia Docker Compose

| Cel | Polecenie |
|---|---|
| Zbudowanie i uruchomienie | `docker compose up --build` (w tle: `-d`) |
| Status i healthchecki | `docker compose ps` |
| Logi | `docker compose logs -f app` (lub `db`, albo bez nazwy: wszystkie) |
| Zatrzymanie (dane zostają) | `docker compose stop` |
| Zatrzymanie i usunięcie kontenerów (dane zostają) | `docker compose down` |
| Ręczne migracje | `docker compose exec app npm run migrate` |
| Seedowanie danych demo | `docker compose exec app npm run seed` |
| Testy w kontenerze | `docker compose --profile test run --rm test` |
| Usunięcie kontenerów **i wszystkich danych** (baza + zdjęcia) | `docker compose down -v` ⚠️ nieodwracalne |
| Usunięcie także zbudowanych obrazów | `docker compose down -v --rmi local` |

**Trwałość danych:** baza danych żyje w named volume `pgdata`, a zdjęcia w volume `uploads`. `restart`, `stop`, `down` i `up --build` ich nie usuwają. Usuwa je dopiero `down -v`.

Testy w kontenerze używają osobnej bazy `<POSTGRES_DB>_test`. Skrypt `prepare-test-db.js` tworzy ją, jeśli nie istnieje, uruchamia na niej migracje i odmawia pracy na bazie, której nazwa nie zawiera „test”.

## Wdrożenie na serwer (VPS)

Produkcja to `compose.yaml` z nakładką `compose.prod.yaml`, która:
- dodaje **Caddy** z automatycznym HTTPS (Let's Encrypt) i przekierowaniem HTTP→HTTPS,
- **zamyka porty** aplikacji i bazy na hoście (`ports: !reset []`, wymaga Compose ≥ 2.24). Publiczne są tylko 80 i 443,
- wymusza `NODE_ENV=production`, `COOKIE_SECURE=true` i `TRUST_PROXY=1` niezależnie od `.env`,
- ogranicza rozmiar logów (3 × 10 MB na kontener).

Wymagania: domena z rekordem **A** wskazującym na IP serwera oraz otwarte porty 80 i 443.

```bash
git clone <repo> && cd <repo>
cp .env.example .env
nano .env          # nowe SESSION_SECRET i POSTGRES_PASSWORD (tylko litery i cyfry), DOMAIN=twoja.domena.pl
docker compose -f compose.yaml -f compose.prod.yaml up -d --build
docker compose -f compose.yaml -f compose.prod.yaml ps      # app/db bez portów, caddy na 80/443
```

Aktualizacja: `git pull`, a potem ponownie `docker compose -f compose.yaml -f compose.prod.yaml up -d --build`.

> Na produkcji **nie** uruchamiaj `npm run seed` (konta demo mają znane hasło) i **nigdy** `docker compose down -v` (usuwa bazę i zdjęcia).

## Uruchomienie bez Dockera

```bash
npm install
cp .env.example .env        # ustaw DATABASE_URL i TEST_DATABASE_URL na swój PostgreSQL
# Sama baza z Compose: docker compose up -d db  (dostępna na 127.0.0.1:5433)
npm run migrate
npm run seed                # opcjonalnie
npm start                   # lub: npm run dev (auto-restart)
```

Przy lokalnym serwerze ustaw `NODE_ENV=development` w `.env` (wymóg długości `SESSION_SECRET` dotyczy tylko produkcji).

## Konta demonstracyjne

Po `npm run seed` (lub `docker compose exec app npm run seed`) dostępne są konta, wszystkie z hasłem **`Mikolaj2024!`**:

| E-mail | Kto | Co warto sprawdzić |
|---|---|---|
| `anna@example.com` | Anna, admin „Rodziny Kowalskich” | Jej lista „Święta 2026”: **nie widzi**, że Piotr zaklepał czytnik |
| `piotr@example.com` | Piotr | Widzi swoją rezerwację na liście Anny; ma listę urodzinową (okazja za 10 dni) |
| `kasia@example.com` | Kasia, admin „Znajomych z pracy” | Widzi rezerwację Piotra; jej lista-niespodzianka **nie pokazuje** pomysłu Tomka |
| `tomek@example.com` | Tomek | Widzi wskazówki Kasi i swój tajny pomysł (młynek do kawy) |

Kody zaproszeń: `RODZINA1` (Rodzina Kowalskich: Anna, Piotr, Kasia) oraz `PRACA234` (Znajomi z pracy: Kasia, Tomek, Anna). Seed jest idempotentny, więc każde uruchomienie odtwarza dane demo od nowa.

> Konta demo służą wyłącznie do lokalnej prezentacji. Nie seeduj ich w środowisku publicznym.

## Testy

```bash
npm test                                        # lokalnie (wymaga TEST_DATABASE_URL)
docker compose --profile test run --rm test     # w kontenerze
```

Używamy wbudowanego `node:test` i `supertest`. Testy działają na prawdziwym PostgreSQL, a tabele są czyszczone przed każdym testem. Pokrycie:

| Plik | Zakres |
|---|---|
| `auth.test.js` | rejestracja, walidacja po polsku, unikalność e-maila, hash bcrypt, logowanie, wylogowanie, session fixation, flagi ciasteczek, CSRF, rate limiting, nagłówki bezpieczeństwa, edycja profilu |
| `groups.test.js` | tworzenie grupy, dołączanie kodem, ponowne dołączenie, nieprawidłowy kod, kontrola dostępu (404 dla obcych, 403 dla członków bez uprawnień), nowy kod, usuwanie członka, przekazanie własności, opuszczanie, wiele grup |
| `lists.test.js` | listy i pozycje, normalizacja, walidacja URL (`javascript:`), kontrola własności, upload (poprawny PNG, podrobiony plik, za duży plik, dostęp do plików), tryb niespodzianki, powiadomienia, przypomnienia o okazjach |
| `reservations.test.js` | zaklepanie, brak zaklepania własnego prezentu, brak podwójnej rezerwacji, **6 równoległych żądań → dokładnie 1 sukces**, anulowanie przez autora, widoczność dla innych, globalność między grupami, listy archiwalne |
| `privacy.test.js` | **brak wycieku do właściciela**: migawka wszystkich odpowiedzi właściciela przed i po rezerwacji oraz dodaniu tajnego pomysłu jest identyczna; brak kluczy `reserv*`/`idea*`; stałe odpowiedzi na bezpośrednie próby; brak zmian znaczników czasu; identyczne odpowiedzi przy usuwaniu; brak powiadomień |
| `ideas.test.js` | profil niespodzianki, tworzenie, edycja i usuwanie pomysłów, prywatna uwaga tylko dla autora, ukrycie przed właścicielem (odpowiedzi jak dla nieistniejącego zasobu), ochrona przed odczytem cudzych danych i podszywaniem się przez parametry |

Wynik: **66 testów, 66 zaliczonych**.

## Struktura projektu

```
├── compose.yaml               # app + db (+ test w profilu "test")
├── Dockerfile                 # wieloetapowy: deps → test → runtime (non-root)
├── docker/
│   ├── entrypoint.sh          # migracje → start serwera
│   └── db-init/               # tworzenie bazy testowej przy inicjalizacji wolumenu
├── migrations/                # node-pg-migrate (SQL)
├── src/
│   ├── server.js              # start + graceful shutdown
│   ├── app.js                 # fabryka Express: helmet, sesje, CSRF, routing
│   ├── config.js  db.js
│   ├── middleware/            # auth, csrf, errors, upload
│   ├── validation/schemas.js  # zod: walidacja + normalizacja, komunikaty PL
│   ├── services/
│   │   ├── access.js          # centralna kontrola dostępu (wspólna grupa)
│   │   ├── serializers.js     # JEDYNE miejsce budowy JSON-a (allowlist pól)
│   │   ├── lists.js           # rozdzielne zapytania: właściciel / gość
│   │   └── notifications.js   # powiadomienia z ochroną właściciela
│   ├── routes/                # auth, groups, lists, items(+rezerwacje), ideas, notifications
│   └── scripts/               # seed.js, prepare-test-db.js
├── public/                    # frontend: HTML + CSS + vanilla JS (ES modules)
│   ├── js/app.js              # router (hash), nawigacja
│   ├── js/api.js  dom.js  ui.js  state.js
│   └── js/views/              # widoki: auth, dashboard, groups, lists, listView, notifications, profile
└── tests/                     # node:test + supertest
```

## Model danych

| Tabela | Opis | Kluczowe ograniczenia |
|---|---|---|
| `users` | konta | `UNIQUE(email)`, `CHECK(email = lower(email))` |
| `groups` | grupy i kod zaproszenia | `UNIQUE(invite_code)` |
| `group_members` | członkostwa i role | `PK(group_id, user_id)`, częściowy `UNIQUE(group_id) WHERE role='admin'` (dokładnie jeden admin) |
| `gift_lists` | listy (`mode`: standard/surprise, `status`) | FK → users, indeksy po właścicielu i dacie |
| `gift_items` | pozycje | FK → lists `ON DELETE CASCADE`, `CHECK(price >= 0)` |
| `surprise_profiles` | wskazówki trybu niespodzianki (1:1) | PK = list_id |
| `secret_ideas` | tajne pomysły (autor = zaklepujący) | FK → lists, users |
| `reservations` | rezerwacje | **`UNIQUE(item_id)`**: atomowa ochrona przed podwójną rezerwacją |
| `notifications` | powiadomienia | indeksy (user, data), częściowy unikalny `dedupe_key` |
| `session` | sesje serwera (connect-pg-simple) | indeks po `expire` |

Każda tabela ma znaczniki czasu (`created_at`, oraz `updated_at` tam, gdzie dane są edytowane).

## API

Wszystkie endpointy mają prefiks `/api`. Operacje zmieniające dane wymagają nagłówka `X-CSRF-Token`, którego wartość zwraca `GET /api/csrf` oraz odpowiedzi logowania i rejestracji.

| Metoda i ścieżka | Opis |
|---|---|
| `GET /csrf` | token CSRF |
| `POST /auth/register` · `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` | konto i sesja |
| `PATCH /me` | edycja profilu |
| `GET/POST /groups` · `GET/PATCH/DELETE /groups/:id` | grupy |
| `POST /groups/join` · `POST /groups/:id/invite-code` · `POST /groups/:id/transfer` · `POST /groups/:id/leave` · `DELETE /groups/:id/members/:userId` | członkostwo |
| `GET /dashboard` · `GET /lists/mine` · `GET /users/:id/lists` | przeglądy |
| `POST /lists` · `GET/PATCH/DELETE /lists/:id` · `PUT /lists/:id/surprise` | listy |
| `POST /lists/:id/items` · `PATCH/DELETE /items/:id` | pozycje (JSON lub multipart z polem `image`) |
| `POST/DELETE /items/:id/reservation` | zaklepanie i anulowanie |
| `GET/POST /lists/:id/ideas` · `PATCH/DELETE /ideas/:id` | tajne pomysły |
| `GET /notifications` · `GET /notifications/unread-count` · `POST /notifications/:id/read` · `POST /notifications/read-all` | powiadomienia |
| `GET /healthz` (bez prefiksu) | healthcheck aplikacji i bazy |

## Ochrona niespodzianki

Jest to najważniejsze wymaganie bezpieczeństwa, więc nie opiera się na ukrywaniu czegokolwiek w CSS ani w JS. **Dane o rezerwacjach w ogóle nie opuszczają serwera, jeśli odbiorcą jest właściciel listy.**

1. **Rozdzielne ścieżki zapytań** (`src/services/lists.js`). Dla właściciela zapytania nie dotykają tabel `reservations` ani `secret_ideas`, bo nie ma w nich `JOIN`-ów. Dane, których się nie pobrało, nie mogą wyciec.
2. **Serializacja z listy dozwolonych pól** (`src/services/serializers.js`). Widok właściciela nie ma klucza `reservation` ani `ideas`, nawet z wartością `null`, więc kształt odpowiedzi jest identyczny bez względu na stan rezerwacji. Nigdy nie zwracamy całych wierszy z bazy.
3. **Brak kanałów bocznych.** Rezerwacja to osobna tabela, więc nie zmienia `updated_at` pozycji ani listy. Liczniki (`itemCount`) liczą tylko pozycje. Usunięcie pozycji zawsze zwraca `204` bez treści.
4. **Stałe odpowiedzi na próby bezpośrednie.** Gdy właściciel wywołuje `POST` lub `DELETE /items/:id/reservation`, dostaje zawsze ten sam `403` ze stałym komunikatem. Sprawdzenie właściciela następuje **przed** jakimkolwiek odczytem stanu rezerwacji. Endpointy tajnych pomysłów zwracają właścicielowi `404` identyczne jak dla nieistniejącego zasobu.
5. **Odpowiedzi po edycji** (`PATCH` listy, pozycji, profilu) budowane są ścieżką właściciela.
6. **Powiadomienia.** Funkcja `notify()` przyjmuje `protectFromUserId` i bezwarunkowo odfiltrowuje właściciela listy. Zdarzenia rezerwacji i pomysłów nie generują żadnych powiadomień dla właściciela. Informację o usunięciu zaklepanej pozycji dostaje tylko rezerwujący.
7. **Testy** (`tests/privacy.test.js`) robią migawkę **każdej** odpowiedzi dostępnej dla właściciela przed i po rezerwacji oraz dodaniu tajnego pomysłu i porównują je struktura w strukturę. Sprawdzają też brak kluczy `reserv*`/`idea*` i danych rezerwującego.

Dashboard zawiera sekcję `myClaims`, ale są to wyłącznie rezerwacje dokonane **przez** zalogowanego użytkownika. Właściciel nie może zaklepać własnego prezentu, więc nie ma tam nic o jego listach.

## Bezpieczeństwo

- **Walidacja i normalizacja** każdego wejścia na backendzie (zod): przycinanie, e-maile małymi literami, kwoty z przecinkiem, limity długości. URL-e muszą zaczynać się od `http(s)`, a adresy zdjęć od `https`.
- **SQL injection:** wyłącznie zapytania parametryzowane (`pg`), a ID z URL-a są walidowane jako dodatnie liczby całkowite.
- **XSS:** frontend buduje DOM przez `createElement` i `textContent`, nigdzie nie używa `innerHTML` dla danych. `href`/`src` przechodzą przez allowlistę protokołów. Ścisłe **CSP** (`script-src 'self'`, bez `unsafe-inline`).
- **CSRF:** token synchronizujący w sesji, porównywany w stałym czasie (`timingSafeEqual`), plus `SameSite=Lax`.
- **Sesje** po stronie serwera (PostgreSQL). Ciasteczko `HttpOnly`, `SameSite=Lax`, `Secure` przy HTTPS. Regeneracja ID sesji i tokenu CSRF po zalogowaniu.
- **Hasła:** bcrypt (koszt 12). Ten sam komunikat i podobny czas odpowiedzi dla nieistniejącego konta i złego hasła.
- **Rate limiting:** 10 nieudanych prób logowania lub rejestracji na 15 min; 30 prób dołączenia kodem.
- **Kontrola dostępu na poziomie zasobu:** każda decyzja opiera się na `req.session.userId` i relacjach w bazie, nigdy na identyfikatorach z żądania. Zasoby niedostępne zwracają `404` (nie zdradzamy istnienia), a widoczne, ale cudze, zwracają `403`.
- **Upload:** pamięć z limitem rozmiaru, weryfikacja **sygnatury binarnej** (JPEG/PNG/WEBP/GIF, bez SVG), nazwa i MIME od klienta ignorowane, losowa nazwa UUID, zapis z flagą `wx`. Pliki są serwowane tylko zalogowanym, z `nosniff` i `CSP: sandbox`.
- **Nagłówki** (helmet): CSP, `X-Frame-Options`, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `nosniff`, HSTS przy HTTPS. Nagłówek `X-Powered-By` wyłączony. Odpowiedzi API mają `Cache-Control: no-store`.
- **Kontener:** użytkownik `node` (bez roota), `tini` jako init, baza wystawiona tylko na `127.0.0.1`.
- **Brak sekretów w repozytorium**, dostępny plik `.env.example`.

## Kluczowe decyzje techniczne

- **Bez ORM.** Czysty SQL przez `pg` daje pełną kontrolę nad tym, *które tabele są dotykane* dla właściciela listy, a to fundament ochrony niespodzianki.
- **Atomowość rezerwacji przez bazę:** `INSERT … ON CONFLICT (item_id) DO NOTHING RETURNING id` na ograniczeniu `UNIQUE`. Nie ma tu wyścigu „sprawdź, potem zapisz”, a działa to także przy wielu instancjach aplikacji.
- **SPA z routingiem w hashu** w vanilla JS (ES modules), bez bundlera i bez kroku budowania frontendu.
- **Zod 4** z polską lokalizacją i własnymi komunikatami pól. **node-pg-migrate** do migracji, **multer** do uploadu, **bcryptjs** (czysty JS, bez kompilacji natywnej w Alpine).
- **Testy integracyjne na prawdziwym PostgreSQL** zamiast mocków, bo ochronę danych trzeba sprawdzać na rzeczywistych zapytaniach.
- **Powiadomienia o zbliżających się okazjach** generowane leniwie przy odczycie (deduplikowane), bez osobnego procesu cron.
- **Wieloetapowy Dockerfile:** obraz runtime zawiera tylko zależności produkcyjne, a osobny etap `test` ma narzędzia testowe.

## Ograniczenia MVP

- Brak wysyłki e-maili, resetu hasła i weryfikacji adresu e-mail.
- Limiter prób logowania trzyma stan w pamięci procesu. Przy wielu instancjach należałoby użyć wspólnego magazynu, np. Redis.
- Przypomnienia o okazjach pojawiają się, gdy użytkownik otworzy aplikację; nie są wysyłane w tle.
- Zdjęcia nie są przetwarzane (np. skalowane ani pozbawiane metadanych EXIF). Przy zdjęciu z adresu URL przeglądarka pobiera je z serwera zewnętrznego (z `no-referrer`).
- Po usunięciu kogoś z grupy jego wcześniejsze rezerwacje pozostają aktywne.
- Trybu listy (zwykła/niespodzianka) nie można zmienić po utworzeniu.
- Audyt zależności zgłasza ostrzeżenia o średniej wadze w `glob`/`minimatch`, używanych wyłącznie przez CLI migracji na zaufanych plikach z repozytorium.
- Flaga `Secure` ciasteczka wymaga HTTPS (`COOKIE_SECURE=true`). Lokalnie, po HTTP, jest domyślnie wyłączona.
