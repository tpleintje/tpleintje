// Test van de Picker-logica met nagebootste Google-antwoorden (geen echte Google-account nodig).
// Draaien (vanuit workers/beheer-gate): node --test test/gphotos-import.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const GP = require("../public/nieuw-album-h4wknz/gphotos-import.js");
const API = "https://photospicker.googleapis.com/v1";

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

/** Mock-fetch: routes = [{ match(url, opts) → bool, reply(url, opts) → Response }] ; logt alle calls. */
function mockFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    const r = routes.find((x) => x.match(url, opts));
    if (!r) throw new Error("Onverwachte fetch: " + (opts.method || "GET") + " " + url);
    return r.reply(url, opts);
  };
  fn.calls = calls;
  return fn;
}

test("parseDuur", () => {
  assert.equal(GP.parseDuur("3.5s", 1), 3500);
  assert.equal(GP.parseDuur("0s", 1), 0);
  assert.equal(GP.parseDuur("1800s", 1), 1800000);
  assert.equal(GP.parseDuur("abc", 42), 42);
  assert.equal(GP.parseDuur(undefined, 7), 7);
});

test("maakSessie: POST /sessions met Bearer-token", async () => {
  const f = mockFetch([{ match: (u, o) => u === API + "/sessions" && o.method === "POST",
    reply: () => jsonRes({ id: "S1", pickerUri: "https://photos.google.com/picker/S1", pollingConfig: { pollInterval: "2s", timeoutIn: "600s" } }) }]);
  const s = await GP.maakSessie(f, "tok");
  assert.equal(s.id, "S1");
  assert.equal(f.calls[0].opts.headers.Authorization, "Bearer tok");
  assert.equal(f.calls[0].opts.body, "{}");
});

test("wachtOpKeuze: respecteert pollInterval en stopt bij mediaItemsSet", async () => {
  let n = 0;
  const f = mockFetch([{ match: (u, o) => u === API + "/sessions/S1" && o.method === "GET",
    reply: () => { n++; return jsonRes(n < 3 ? { id: "S1", mediaItemsSet: false, pollingConfig: { pollInterval: n === 1 ? "4s" : "2.5s", timeoutIn: "600s" } } : { id: "S1", mediaItemsSet: true }); } }]);
  const slaap = [];
  let t = 0;
  const s = await GP.wachtOpKeuze(f, "tok", { id: "S1", pollingConfig: { pollInterval: "3s", timeoutIn: "600s" } },
    { sleep: async (ms) => { slaap.push(ms); t += ms; }, now: () => t });
  assert.equal(s.mediaItemsSet, true);
  assert.deepEqual(slaap, [3000, 4000, 2500]);
});

test("wachtOpKeuze: timeout (timeoutIn 0s)", async () => {
  const f = mockFetch([{ match: () => true, reply: () => jsonRes({ id: "S1", mediaItemsSet: false, pollingConfig: { pollInterval: "1s", timeoutIn: "0s" } }) }]);
  let t = 0;
  await assert.rejects(
    GP.wachtOpKeuze(f, "tok", { id: "S1", pollingConfig: { pollInterval: "1s", timeoutIn: "60s" } }, { sleep: async (ms) => { t += ms; }, now: () => t }),
    (e) => e.status === "timeout");
});

test("wachtOpKeuze: annuleren", async () => {
  const f = mockFetch([]);
  await assert.rejects(GP.wachtOpKeuze(f, "tok", { id: "S1" }, { sleep: async () => {}, geannuleerd: () => true }), (e) => e.status === "geannuleerd");
  assert.equal(f.calls.length, 0);
});

test("lijstItems: paginatie via nextPageToken", async () => {
  const f = mockFetch([{ match: (u) => u.startsWith(API + "/mediaItems?"), reply: (u) => {
    const q = new URL(u).searchParams;
    assert.equal(q.get("sessionId"), "S1");
    assert.equal(q.get("pageSize"), "100");
    if (!q.get("pageToken")) return jsonRes({ mediaItems: [{ id: "a" }, { id: "b" }], nextPageToken: "P2" });
    if (q.get("pageToken") === "P2") return jsonRes({ mediaItems: [{ id: "c" }], nextPageToken: "P3" });
    return jsonRes({});
  } }]);
  const items = await GP.lijstItems(f, "tok", "S1");
  assert.deepEqual(items.map((i) => i.id), ["a", "b", "c"]);
  assert.equal(f.calls.length, 3);
});

test("lijstItems: fout van Google (FAILED_PRECONDITION) geeft duidelijke fout", async () => {
  const f = mockFetch([{ match: () => true, reply: () => jsonRes({ error: { code: 400, message: "Session not ready", status: "FAILED_PRECONDITION" } }, 400) }]);
  await assert.rejects(GP.lijstItems(f, "tok", "S1"), (e) => e.status === 400 && /Session not ready/.test(e.message));
});

test("splitsFotos: video's overslaan", () => {
  const r = GP.splitsFotos([
    { id: "1", type: "PHOTO", mediaFile: { baseUrl: "https://lh3.googleusercontent.com/a", mimeType: "image/jpeg", filename: "IMG_1.jpg" } },
    { id: "2", type: "VIDEO", mediaFile: { baseUrl: "https://lh3.googleusercontent.com/b", mimeType: "video/mp4", filename: "VID.mp4" } },
    { id: "3", type: "TYPE_UNSPECIFIED", mediaFile: { baseUrl: "https://lh3.googleusercontent.com/c", mimeType: "image/heic", filename: "IMG_3.HEIC" } },
    { id: "4", type: "PHOTO", mediaFile: {} }
  ]);
  assert.deepEqual(r.fotos.map((f) => f.id), ["1", "3"]);
  assert.equal(r.overgeslagen, 2);
});

test("bestandsnaamVoor: extensie volgens gedownload type", () => {
  const it = (n) => ({ mediaFile: { filename: n } });
  assert.equal(GP.bestandsnaamVoor(it("IMG_1234.HEIC"), "image/jpeg"), "IMG_1234.jpg");
  assert.equal(GP.bestandsnaamVoor(it("scan.png"), "image/png"), "scan.png");
  assert.equal(GP.bestandsnaamVoor(it("x.jpg"), "image/webp"), "x.webp");
  assert.equal(GP.bestandsnaamVoor(it(""), "image/jpeg; charset=binary"), "google-foto.jpg");
  assert.equal(GP.bestandsnaamVoor(it("../../etc/passwd"), "image/jpeg"), "passwd.jpg");
});

test("downloadAlles: via proxy, met size-suffix, volgorde behouden, fouten apart", async () => {
  const fotos = ["a", "b", "c", "d"].map((x) => ({ id: x, type: "PHOTO", mediaFile: { baseUrl: "https://lh3.googleusercontent.com/" + x, filename: x.toUpperCase() + ".HEIC" } }));
  const f = mockFetch([{ match: (u, o) => u === "/gphotos/fetch" && o.method === "POST", reply: async (u, o) => {
    const body = JSON.parse(o.body);
    assert.equal(body.token, "tok");
    assert.ok(body.url.endsWith(GP.GROOTTE));
    assert.equal(o.headers["Content-Type"], "application/json");
    assert.equal(o.headers.Authorization, undefined, "Authorization-header is voor Basic Auth; token gaat in de body");
    if (body.url.includes("/c=")) return jsonRes({ error: "Google gaf een fout terug (404).", upstreamStatus: 404 }, 502);
    await new Promise((r) => setTimeout(r, body.url.includes("/a=") ? 20 : 1));
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "Content-Type": "image/jpeg" } });
  } }]);
  const voortgang = [];
  const r = await GP.downloadAlles(f, "/gphotos/fetch", "tok", fotos, { onVoortgang: (k, t) => voortgang.push(k + "/" + t) });
  assert.deepEqual(r.bestanden.map((b) => b.naam), ["A.jpg", "B.jpg", "D.jpg"]);
  assert.equal(r.fouten.length, 1);
  assert.equal(r.fouten[0].item.id, "c");
  assert.equal(voortgang.length, 4);
  assert.equal(voortgang.at(-1), "4/4");
});

test("downloadAlles: 401 van Google stopt de import", async () => {
  const fotos = [{ id: "a", type: "PHOTO", mediaFile: { baseUrl: "https://lh3.googleusercontent.com/a", filename: "a.jpg" } }];
  const f = mockFetch([{ match: () => true, reply: () => jsonRes({ error: "Google gaf een fout terug (401).", upstreamStatus: 401 }, 502) }]);
  await assert.rejects(GP.downloadAlles(f, "/gphotos/fetch", "tok", fotos), (e) => e.status === 401);
});

test("verwijderSessie: DELETE, fouten worden ingeslikt", async () => {
  const f = mockFetch([{ match: (u, o) => u === API + "/sessions/S1" && o.method === "DELETE", reply: () => new Response(null, { status: 500 }) }]);
  await GP.verwijderSessie(f, "tok", "S1");
  assert.equal(f.calls.length, 1);
});
