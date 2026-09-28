/*
 * Google Photos Picker-import voor de fotogalerijen-pagina.
 * Pure logica (geen DOM): sessie maken, pollen, gekozen items oplijsten en downloaden
 * via de proxy van de beheer-Worker (/gphotos/fetch). fetch/sleep zijn injecteerbaar
 * zodat dit zonder echte Google-account getest kan worden (zie test/gphotos-import.test.mjs).
 * Docs: https://developers.google.com/photos/picker
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TpGPhotos = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var API = "https://photospicker.googleapis.com/v1";
  var SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";
  // Zelfde maximale breedte als optimize-images.js (1600 px); hoogte ruim zodat staande foto's
  // ook 1600 px breed blijven (Google schaalt binnen w×h met behoud van verhoudingen).
  var GROOTTE = "=w1600-h3200";
  var EXT_PER_TYPE = { "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

  function GFout(bericht, status) {
    var e = new Error(bericht);
    e.name = "GFout";
    e.status = status;
    return e;
  }

  /** "3.5s" → 3500 (ms). Onbekend formaat → standaard. */
  function parseDuur(s, standaard) {
    var m = /^\s*(\d+(?:\.\d+)?)s\s*$/.exec(String(s == null ? "" : s));
    return m ? Math.round(parseFloat(m[1]) * 1000) : standaard;
  }

  async function roep(fetchFn, token, method, pad, body) {
    var headers = { Authorization: "Bearer " + token };
    var opties = { method: method, headers: headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      opties.body = JSON.stringify(body);
    }
    var res = await fetchFn(API + pad, opties);
    if (!res.ok) {
      var detail = "";
      try { var j = await res.json(); detail = (j && j.error && j.error.message) || ""; } catch (e) {}
      throw GFout("Google Photos gaf een fout terug (" + res.status + ")." + (detail ? " " + detail : ""), res.status);
    }
    if (res.status === 204) return null;
    var tekst = await res.text();
    return tekst ? JSON.parse(tekst) : {};
  }

  function maakSessie(fetchFn, token) {
    return roep(fetchFn, token, "POST", "/sessions", {});
  }

  function verwijderSessie(fetchFn, token, id) {
    if (!id) return Promise.resolve();
    return roep(fetchFn, token, "DELETE", "/sessions/" + encodeURIComponent(id)).then(function () {}, function () {});
  }

  /**
   * Pollt sessions.get tot mediaItemsSet, volgens pollingConfig (pollInterval / timeoutIn).
   * opties: { sleep(ms), now(), geannuleerd(), onPoll(sessie) }
   */
  async function wachtOpKeuze(fetchFn, token, sessie, opties) {
    opties = opties || {};
    var sleep = opties.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var now = opties.now || Date.now;
    var pc = sessie.pollingConfig || {};
    var interval = Math.max(1000, parseDuur(pc.pollInterval, 5000));
    var deadline = now() + parseDuur(pc.timeoutIn, 20 * 60 * 1000);
    var id = sessie.id;
    while (true) {
      if (opties.geannuleerd && opties.geannuleerd()) throw GFout("Geannuleerd.", "geannuleerd");
      await sleep(interval);
      if (opties.geannuleerd && opties.geannuleerd()) throw GFout("Geannuleerd.", "geannuleerd");
      var s = await roep(fetchFn, token, "GET", "/sessions/" + encodeURIComponent(id));
      if (opties.onPoll) opties.onPoll(s);
      if (s && s.mediaItemsSet) return s;
      if (s && s.pollingConfig) {
        interval = Math.max(1000, parseDuur(s.pollingConfig.pollInterval, interval));
        var t = parseDuur(s.pollingConfig.timeoutIn, null);
        if (t !== null) deadline = now() + t;
      }
      if (now() >= deadline) throw GFout("Er werden geen foto's gekozen (tijd verstreken). Probeer opnieuw.", "timeout");
    }
  }

  /** Alle gekozen items (paginatie via nextPageToken). */
  async function lijstItems(fetchFn, token, sessieId) {
    var items = [];
    var pageToken = "";
    for (var pagina = 0; pagina < 50; pagina++) {
      var pad = "/mediaItems?sessionId=" + encodeURIComponent(sessieId) + "&pageSize=100" +
        (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
      var res = await roep(fetchFn, token, "GET", pad);
      if (res && Array.isArray(res.mediaItems)) items = items.concat(res.mediaItems);
      pageToken = (res && res.nextPageToken) || "";
      if (!pageToken) return items;
    }
    return items;
  }

  /** Splitst in foto's en overgeslagen (video's e.d.). */
  function splitsFotos(items) {
    var fotos = [], overgeslagen = 0;
    (items || []).forEach(function (it) {
      var mf = (it && it.mediaFile) || {};
      var mime = String(mf.mimeType || "");
      var isFoto = it && (it.type === "PHOTO" || ((!it.type || it.type === "TYPE_UNSPECIFIED") && mime.indexOf("image/") === 0));
      if (isFoto && mf.baseUrl) fotos.push(it); else overgeslagen++;
    });
    return { fotos: fotos, overgeslagen: overgeslagen };
  }

  /** Google-bestandsnaam met extensie volgens het echte (gedownloade) type. Sanitize/dedupe gebeurt in de upload-pipeline. */
  function bestandsnaamVoor(item, contentType) {
    var naam = String((item && item.mediaFile && item.mediaFile.filename) || "").split(/[\\/]/).pop();
    var punt = naam.lastIndexOf(".");
    var basis = (punt > 0 ? naam.slice(0, punt) : naam) || "google-foto";
    var type = String(contentType || "").split(";")[0].trim().toLowerCase();
    return basis + (EXT_PER_TYPE[type] || ".jpg");
  }

  /** Eén foto ophalen via de Worker-proxy. Geeft { naam, blob }. */
  async function downloadFoto(fetchFn, proxyUrl, token, item) {
    var res = await fetchFn(proxyUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: item.mediaFile.baseUrl + GROOTTE, token: token })
    });
    if (!res.ok) {
      var j = null;
      try { j = await res.json(); } catch (e) {}
      throw GFout((j && j.error) || ("Foto ophalen mislukt (" + res.status + ")."), (j && j.upstreamStatus) || res.status);
    }
    var blob = await res.blob();
    var type = blob.type || res.headers.get("Content-Type") || "image/jpeg";
    return { naam: bestandsnaamVoor(item, type), blob: blob, type: type.split(";")[0] };
  }

  /** Downloadt alle foto's (max. `gelijktijdig` tegelijk), volgorde blijft behouden. */
  async function downloadAlles(fetchFn, proxyUrl, token, fotos, opties) {
    opties = opties || {};
    var gelijktijdig = opties.gelijktijdig || 3;
    var resultaat = new Array(fotos.length);
    var fouten = [];
    var klaar = 0, volgende = 0;
    async function werker() {
      while (volgende < fotos.length) {
        var i = volgende++;
        try {
          resultaat[i] = await downloadFoto(fetchFn, proxyUrl, token, fotos[i]);
        } catch (e) {
          if (e && (e.status === 401 || e.status === 403)) throw e; // token verlopen: stoppen
          fouten.push({ item: fotos[i], fout: e });
        }
        klaar++;
        if (opties.onVoortgang) opties.onVoortgang(klaar, fotos.length);
      }
    }
    var werkers = [];
    for (var w = 0; w < Math.min(gelijktijdig, fotos.length); w++) werkers.push(werker());
    await Promise.all(werkers);
    return { bestanden: resultaat.filter(Boolean), fouten: fouten };
  }

  return {
    SCOPE: SCOPE,
    GROOTTE: GROOTTE,
    parseDuur: parseDuur,
    maakSessie: maakSessie,
    verwijderSessie: verwijderSessie,
    wachtOpKeuze: wachtOpKeuze,
    lijstItems: lijstItems,
    splitsFotos: splitsFotos,
    bestandsnaamVoor: bestandsnaamVoor,
    downloadFoto: downloadFoto,
    downloadAlles: downloadAlles
  };
});
