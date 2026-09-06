const PROTECTED_PREFIXES = [
  "/hub-df5d0dd9",
  "/nieuw-album-h4wknz",
  "/beheer-7q3k9x2m",
];

function isProtected(pathname) {
  if (pathname === "/" || pathname === "/index.html") return true;
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function unauthorized() {
  return new Response("Login vereist voor beheer t Pleintje.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Beheer t Pleintje"',
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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

    return env.ASSETS.fetch(request);
  },
};
