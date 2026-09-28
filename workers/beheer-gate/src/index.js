const PROTECTED_PREFIXES = [
  "/hub-df5d0dd9",
  "/nieuw-album-h4wknz",
  "/beheer-7q3k9x2m",
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

    return finalize(await env.ASSETS.fetch(request), url.pathname);
  },
};
