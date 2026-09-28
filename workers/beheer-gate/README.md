# Beheer-gate ’t Pleintje (HTTP Basic Auth)

Worker serveert hub + fotogalerijen + Decap achter login.
Publieke site blijft: https://tpleintje.github.io/tpleintje/

## Eenmalig op Bruno’s Mac

1. Terminal, map openen:
   `cd ~/tpleintje/workers/beheer-gate`
2. Cloudflare inloggen:
   `npx wrangler login`
   → browser opent → Allow
3. Gebruikersnaam-secret (eenmalig):
   `npx wrangler secret put BASIC_USER`
   → typ: `tpleintje` → Enter
4. Wachtwoord-secret (= GitHub-wachtwoord account tpleintje; Kaat kent dit):
   `npx wrangler secret put BASIC_PASSWORD`
   → plak wachtwoord (niet in chat) → Enter
5. **Pas na go van Elon/Bruno:** deploy
   `npx wrangler deploy`
6. Live URL: `https://tpleintje-beheer.tpleintje.workers.dev`
7. Admin is van GitHub Pages gehaald (Eleventy passthrough uit); alleen Worker-URL + Basic Auth.

## Test

- Open Worker-URL → browser vraagt login → user `tpleintje` + wachtwoord
- Hub → Fotogalerijen / Activiteiten (relative links)
- Publieke site zonder login: https://tpleintje.github.io/tpleintje/

## Secrets opnieuw zetten (zonder trailing newline)

In `~/tpleintje/workers/beheer-gate`:

```bash
npx wrangler secret put BASIC_USER
# typ exact: tpleintje   (Enter; geen spaties)

npx wrangler secret put BASIC_PASSWORD
# plak GitHub-wachtwoord van account tpleintje, Enter
# géén `echo … | secret put` (dat zet vaak een \n mee)
```

Daarna hard refresh / privévenster op de Worker-URL.

## Google Photos-import (Fotogalerijen)

Knop **Importeer uit Google Photos** op de fotogalerijen-pagina (Nieuwe galerij + Bewerken).
Gebruikt de Google Photos **Picker API** (scope `photospicker.mediaitems.readonly`, Google Identity
Services token-flow in de browser, geen client secret). Gekozen foto's komen in dezelfde lijst als
lokaal gekozen foto's; de bestaande knop uploadt ze naar `images/sfeer/<map>/` en zet de galerij in
`src/_data/sfeerbeelden-albums.json`. Video's worden overgeslagen.

Worker-routes (achter dezelfde Basic Auth):

- `GET /gphotos/config` → `{ "clientId": … }` uit secret `GOOGLE_CLIENT_ID` (`null` = niet ingesteld →
  knop toont "Google Photos-import nog niet ingesteld").
- `POST /gphotos/fetch` `{ url, token }` → haalt één foto op (Google's `baseUrl` vereist een Bearer-token
  en geeft geen CORS-headers, dus de browser kan dat niet rechtstreeks). Enkel
  `https://lhN.googleusercontent.com/…`; token wordt niet gelogd of bewaard.

Eenmalig instellen:

1. console.cloud.google.com → project → **Photos Picker API** inschakelen.
2. OAuth-toestemmingsscherm: External, Testing, testgebruikers toevoegen, scope
   `…/auth/photospicker.mediaitems.readonly`.
3. OAuth-client-ID, type **Web application**, Authorized JavaScript origin:
   `https://tpleintje-beheer.tpleintje.workers.dev`
4. `npx wrangler secret put GOOGLE_CLIENT_ID` (plak de client-ID) → `npx wrangler deploy`.

Test (zonder Google-account): `node --test test/gphotos-import.test.mjs`

Let op: `public/nieuw-album-h4wknz/` is de versie die de Worker serveert; de kopie in
`/nieuw-album-h4wknz/` (repo-root) wordt identiek gehouden.
