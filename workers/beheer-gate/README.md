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
