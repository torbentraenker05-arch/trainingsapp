# Trainingsbuch

Trainings-App als PWA für iPhone und PC, ohne App Store.

- **Kalender**: Einheiten eintragen, abhaken, Serien
- **Plan**: Assistent (Ziel, Zeitraum, Zeitfenster, feste Termine, Bausteine, Zonen) und Algorithmus mit Periodisierung, max. +10 % pro Woche, Entlastungswochen und Reihenfolge-Regeln. Optionale Übergabe an Claude per Copy & Paste.
- **Statistik**: Kilometer, Belastung (TRIMP, 7 vs. 28 Tage), Plan-Erfüllung, Bestwerte
- **Profil**: Zonen, eigene Sportarten, Strava (nur lesen, Webhook), CSV-Import, Backup

## Aufbau

| Teil | Wo |
|---|---|
| Frontend (statisch, Vanilla JS) | `index.html`, `css/`, `js/` – gehostet auf GitHub Pages |
| Datenbank, Login | Supabase (Projekt `todpltoqjiozzdelower`), Schema in `supabase/migrations/` |
| Strava-Anbindung | Edge Functions in `supabase/functions/` (`strava`, `strava-callback`, `strava-webhook`) |
| Plan-Algorithmus | `js/planner.js` |

Offline: Änderungen landen zuerst lokal und werden synchronisiert, sobald wieder Netz da ist (`js/store.js`).

## Änderungen ausrollen

- Frontend: committen und pushen, GitHub Pages veröffentlicht automatisch. Bei Änderungen an Dateien `VERSION` in `sw.js` erhöhen.
- Edge Functions / Schema: über Supabase (CLI oder Dashboard) deployen.
