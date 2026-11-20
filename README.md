# army.mikesokol.ch – Plattform für das Kader

Statische Seite (GitHub Pages) mit Supabase für Login und Datenbank. Kein Build-Schritt.

| Was | Datei |
|---|---|
| Datenbank, Rechte, Regeln | `supabase/schema.sql`, Erweiterungen `supabase/00N_….sql` |
| Tests der Rechte (`npm i @electric-sql/pglite@0.2.17`, dann `node supabase/test.mjs`) | `supabase/test.mjs` |
| Supabase-Adresse und öffentlicher Schlüssel | `config.js` |
| Oberfläche | `index.html`, `app.js`, `style.css` |
| Wappen je Dienst (Liste `WAPPEN` in app.js) | `wappen/` |
| supabase-js 2.45.4 (lokal, kein fremder Server) | `vendor/` |

## Einrichten (einmal)
1. supabase.com: neues Projekt, Region **Zürich** (falls angeboten, sonst Frankfurt).
2. SQL Editor: `supabase/schema.sql` einfügen, Run.
   Danach ebenso `supabase/002_rapporte.sql` (Rapporte, Abmachungen, Wappen) und `supabase/003_palf.sql` (LIK, PALF). Weitere Dateien `00N_….sql` immer in der Reihenfolge.
3. SQL Editor, separat (Adresse nie ins Repository):
   `insert into public.mitglieder (email, funktion) values ('<deine militär-adresse, klein>', 'Kdt');`
4. Authentication → Sign In / Providers: **Confirm email EIN**, minimale Passwortlänge 8, **Anonymous sign-ins AUS**.
5. Authentication → URL Configuration: Site URL und Redirect URL `https://army.mikesokol.ch`.
6. Authentication → Emails → SMTP: eigenen Mailversand eintragen (z. B. Hostpoint-Postfach). Ohne eigenes SMTP sendet Supabase nur an die eigenen Projekt-Mitglieder.
7. Settings → API: Project URL und `anon`-Schlüssel in `config.js` eintragen.

Regeln: Zugang nur auf Einladung (Tabelle `mitglieder`). Keine Befehle, keine klassifizierten Inhalte, keine Personaldaten erfassen.
Frühere Infoseiten: Git-Verlauf, Commit «Neue Seiten Checklisten und Rapporte».
