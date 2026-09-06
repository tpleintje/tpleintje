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
      "WWW-Authenticate": "Basic realm=\"Beheer t Pleintje\", charset=\"UTF-8\"",
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function checkBasicAuth(request, user, password) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice(6));
    const i = decoded.indexOf(":");
    if (i < 0) return false;
    return decoded.slice(0, i) === user && decoded.slice(i + 1) === password;
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!isProtected(url.pathname)) {
      return new Response("Niet gevonden", { status: 404 });
    }
    const user = env.BASIC_USER || "tpleintje";
    const password = env.BASIC_PASSWORD;
    if (!password) {
      return new Response("Beheer-gate misconfigured (no password secret).", { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    if (!checkBasicAuth(request, user, password)) return unauthorized();
    return env.ASSETS.fetch(request);
  },
};
