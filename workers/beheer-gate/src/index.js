const PROTECTED_PREFIXES = [
  "/hub-df5d0dd9",
  "/nieuw-album-h4wknz",
  "/beheer-7q3k9x2m",
  "/gphotos",
];

function isProtected(pathname) {
  if (pathname === "/" || pathname === "/index.html") return true;
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

const REALM = 'Basic realm="Beheer t Pleintje"';
const DECAP_PREFIX = "/beheer-7q3k9x2m";

function unauthorized() {
  return new Response("Login vereist voor beheer t Pleintje.", {
    status: 401,
    headers: {
      "WWW-Authenticate": REALM,
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

/** Parse Authorization: Basic … as UTF-8 user:password (no trailing CR/LF from secrets). */
function parseBasicAuth(header) {
  if (!header || !header.startsWith("Basic ")) return null;
  const b64 = header.slice(6).trim();
  if (!b64) return null;
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const decoded = new TextDecoder("utf-8").decode(bytes);
    const i = decoded.indexOf(":");
    if (i < 0) return null;
    return { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
  } catch {
    return null;
  }
}

function cleanSecret(value) {
  if (value == null) return "";
  // Secrets often get a trailing newline from `echo | wrangler secret put`.
  return String(value).replace(/^\uFEFF/, "").replace(/[\r\n]+$/g, "").trim();
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < aa.length; i++) out |= aa[i] ^ bb[i];
  return out === 0;
}

const LOGOUT_HTML = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Uitgelogd — Beheer 't Pleintje</title>
<style>
body{font-family:'Segoe UI',Arial,sans-serif;color:#333;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.6}
h1{color:#c45e78;font-size:1.6rem}
a{color:#c45e78}
</style>
</head>
<body>
<h1>Je bent uitgelogd</h1>
<p>Je bent afgemeld bij het beheer van 't Pleintje. Sluit dit venster, of log opnieuw in.</p>
<p><a href="/">Opnieuw inloggen</a></p>
<script>try{localStorage.removeItem("decap-cms-user");}catch(e){}</script>
</body>
</html>`;

/** Altijd 401 (ook met geldige login) met dezelfde realm, zodat de browser de Basic Auth-cache wist. */
function logoutResponse() {
  return new Response(LOGOUT_HTML, {
    status: 401,
    headers: {
      "WWW-Authenticate": REALM,
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

class LogoutButton {
  constructor(bottom) {
    this.bottom = bottom;
  }
  element(el) {
    // Decap heeft rechtsboven eigen knoppen; daar zetten we de knop rechtsonder.
    const pos = this.bottom ? "bottom:12px" : "top:12px";
    el.append(
      `<a href="/logout" id="tp-logout" style="position:fixed;${pos};right:12px;z-index:2147483647;` +
        "background:#c45e78;color:#fff;padding:6px 12px;border-radius:6px;font:600 14px/1.2 'Segoe UI',Arial,sans-serif;" +
        'text-decoration:none;box-shadow:0 1px 4px rgba(0,0,0,.25)">Uitloggen</a>',
      { html: true },
    );
  }
}

/** Beheerpagina's nooit cachen + logout-knop injecteren in HTML. */
function finalize(response, pathname) {
  const res = new Response(response.body, response);
  res.headers.set("Cache-Control", "no-store");
  const type = res.headers.get("Content-Type") || "";
  if (res.status !== 200 || !type.includes("text/html")) return res;
  const isDecap = pathname === DECAP_PREFIX || pathname.startsWith(DECAP_PREFIX + "/");
  return new HTMLRewriter().on("body", new LogoutButton(isDecap)).transform(res);
}

// ── Google Photos Picker-import (achter dezelfde Basic Auth) ──
// GET  /gphotos/config → { clientId } uit secret GOOGLE_CLIENT_ID (null als niet ingesteld)
// POST /gphotos/fetch  → { url, token } : haalt één foto op bij Google (baseUrl vereist
//      een Bearer-token en Google stuurt geen CORS-headers mee). Enkel lhN.googleusercontent.com.
//      Het token wordt alleen doorgestuurd naar Google, nooit gelogd of bewaard.
const GPHOTOS_HOST = /^lh\d+\.googleusercontent\.com$/;
const GPHOTOS_MAX_BYTES = 40 * 1024 * 1024;

function jsonResponse(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign(
      { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      extra,
    ),
  });
}

/** Geeft een URL-object terug als het een toegelaten Google Photos-afbeeldings-URL is, anders null. */
function allowedGooglePhotosUrl(raw) {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "443") return null;
  if (!GPHOTOS_HOST.test(u.hostname.toLowerCase())) return null;
  return u;
}

function gphotosConfig(env) {
  const clientId = cleanSecret(env.GOOGLE_CLIENT_ID);
  return jsonResponse({ clientId: clientId || null });
}

async function gphotosFetch(request, url) {
  if (request.method !== "POST") return jsonResponse({ error: "Enkel POST." }, 405, { Allow: "POST" });
  // JSON verplicht: een cross-site formulier kan dit niet zonder CORS-preflight (die we niet toestaan).
  const type = request.headers.get("Content-Type") || "";
  if (!type.toLowerCase().startsWith("application/json")) {
    return jsonResponse({ error: "Content-Type moet application/json zijn." }, 415);
  }
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return jsonResponse({ error: "Verkeerde herkomst." }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Ongeldige JSON." }, 400);
  }
  let target = allowedGooglePhotosUrl(body && body.url);
  if (!target) return jsonResponse({ error: "Enkel Google Photos-afbeeldingen (https://lhN.googleusercontent.com/…) zijn toegelaten." }, 400);
  const token = typeof (body && body.token) === "string" ? body.token.trim() : "";
  if (!token || token.length > 4096 || /[^\x21-\x7e]/.test(token)) {
    return jsonResponse({ error: "Google-token ontbreekt of is ongeldig." }, 400);
  }

  let upstream;
  for (let hop = 0; hop < 4; hop++) {
    upstream = await fetch(target.toString(), {
      headers: { Authorization: "Bearer " + token, Accept: "image/jpeg,image/png;q=0.9,image/*;q=0.8" },
      redirect: "manual",
    });
    const loc = upstream.status >= 300 && upstream.status < 400 ? upstream.headers.get("Location") : null;
    if (!loc) break;
    let next = null;
    try {
      next = allowedGooglePhotosUrl(new URL(loc, target).toString());
    } catch {
      next = null;
    }
    if (!next) return jsonResponse({ error: "Google stuurde door naar een niet-toegelaten adres." }, 502);
    target = next;
    upstream = null;
  }
  if (!upstream) return jsonResponse({ error: "Te veel doorverwijzingen." }, 502);
  if (!upstream.ok) {
    return jsonResponse({ error: "Google gaf een fout terug (" + upstream.status + ").", upstreamStatus: upstream.status }, 502);
  }
  const ctype = (upstream.headers.get("Content-Type") || "").toLowerCase();
  if (!ctype.startsWith("image/")) return jsonResponse({ error: "Google stuurde geen afbeelding terug." }, 502);
  const len = Number(upstream.headers.get("Content-Length") || 0);
  if (len > GPHOTOS_MAX_BYTES) return jsonResponse({ error: "Foto is te groot." }, 413);

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": ctype,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Altijd 401, ook met geldige login, zodat de browser de Basic Auth-cache wist.
    if (url.pathname === "/logout" || url.pathname === "/logout/") {
      return logoutResponse();
    }
    if (!isProtected(url.pathname)) {
      return new Response("Niet gevonden", { status: 404 });
    }

    const user = cleanSecret(env.BASIC_USER) || "tpleintje";
    const password = cleanSecret(env.BASIC_PASSWORD);
    if (!password) {
      return new Response("Beheer-gate misconfigured (no password secret).", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const creds = parseBasicAuth(request.headers.get("Authorization"));
    if (!creds || !timingSafeEqual(creds.user, user) || !timingSafeEqual(creds.pass, password)) {
      return unauthorized();
    }

    if (url.pathname === "/gphotos/config") return gphotosConfig(env);
    if (url.pathname === "/gphotos/fetch") return gphotosFetch(request, url);
    if (url.pathname === "/gphotos" || url.pathname.startsWith("/gphotos/")) {
      return new Response("Niet gevonden", { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    return finalize(await env.ASSETS.fetch(request), url.pathname);
  },
};
