const CATEGORIEEN = {
  film:            { emoji: "🎬", label: "Film" },
  voorstelling:    { emoji: "🎭", label: "Voorstelling" },
  infosessie:      { emoji: "🩺", label: "Infosessie" },
  uitstap:         { emoji: "🚴", label: "Uitstap" },
  buurtactiviteit: { emoji: "🥞", label: "Buurtactiviteit" },
  buurtactie:      { emoji: "🌿", label: "Buurtactie" },
  buurtfeest:      { emoji: "🪑", label: "Buurtfeest" },
  tentoonstelling: { emoji: "💃", label: "Tentoonstelling" }
};

const WEEKDAGEN = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december"];
const MAANDEN_KORT = ["jan", "feb", "mrt", "apr", "mei", "jun",
  "jul", "aug", "sep", "okt", "nov", "dec"];

// YAML-datums worden als UTC-middernacht geparsed; lees in UTC om dag-verschuiving te vermijden.
function d(date) { return new Date(date); }

function hoofdletter(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function einde(ev) {
  return ev.data.einddatum ? new Date(ev.data.einddatum) : new Date(ev.data.datum);
}

const { EleventyHtmlBasePlugin } = require("@11ty/eleventy");

module.exports = function (eleventyConfig) {
  // Herschrijft absolute links (/css, /images, /over ...) met het pathPrefix,
  // zodat ze kloppen wanneer de site op een subpad draait (GitHub Pages).
  eleventyConfig.addPlugin(EleventyHtmlBasePlugin);

  eleventyConfig.addPassthroughCopy("images");
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy("beheer-7q3k9x2m");

  eleventyConfig.addGlobalData("categorieen", CATEGORIEEN);
  // Huidig jaar bij elke build (voor de footer-copyright).
  eleventyConfig.addGlobalData("huidigJaar", () => new Date().getFullYear());

  // ── Datum-filters (Nederlands) ──
  eleventyConfig.addFilter("weekdag", (date) => WEEKDAGEN[d(date).getUTCDay()]);
  eleventyConfig.addFilter("dag", (date) => d(date).getUTCDate());
  eleventyConfig.addFilter("maandKort", (date) => MAANDEN_KORT[d(date).getUTCMonth()]);
  eleventyConfig.addFilter("datumLang", (date) => {
    const x = d(date);
    return `${x.getUTCDate()} ${MAANDEN[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
  });

  // Volledige weergave incl. weekdag, met bereik-ondersteuning (bv. "6 & 7 juni")
  eleventyConfig.addFilter("datumGroot", (datum, einddatum) => {
    const a = d(datum);
    if (einddatum) {
      const b = d(einddatum);
      if (a.getUTCMonth() === b.getUTCMonth()) {
        return `${hoofdletter(WEEKDAGEN[a.getUTCDay()])} ${a.getUTCDate()} & ${WEEKDAGEN[b.getUTCDay()]} ${b.getUTCDate()} ${MAANDEN[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
      }
      return `${hoofdletter(WEEKDAGEN[a.getUTCDay()])} ${a.getUTCDate()} ${MAANDEN[a.getUTCMonth()]} – ${WEEKDAGEN[b.getUTCDay()]} ${b.getUTCDate()} ${MAANDEN[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
    }
    return `${hoofdletter(WEEKDAGEN[a.getUTCDay()])} ${a.getUTCDate()} ${MAANDEN[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
  });

  // Dagweergave op de kalender-tegel: "17" of "6–7"
  eleventyConfig.addFilter("dagTegel", (datum, einddatum) => {
    const a = d(datum);
    if (einddatum) {
      const b = d(einddatum);
      if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()}–${b.getUTCDate()}`;
    }
    return `${a.getUTCDate()}`;
  });

  // ── Collecties ──
  // Eén dag speling zodat een event op de dag zelf nog "komend" is.
  const vandaag = () => { const t = new Date(); t.setUTCHours(0, 0, 0, 0); return t; };

  eleventyConfig.addCollection("komende", (api) =>
    api.getFilteredByTag("event")
      .filter((ev) => einde(ev) >= vandaag())
      .sort((a, b) => new Date(a.data.datum) - new Date(b.data.datum))
  );

  eleventyConfig.addCollection("voorbije", (api) =>
    api.getFilteredByTag("event")
      .filter((ev) => einde(ev) < vandaag())
      .sort((a, b) => new Date(b.data.datum) - new Date(a.data.datum))
  );

  // Activiteit die met een foto bovenaan de startpagina uitgelicht wordt (CMS-vinkje).
  eleventyConfig.addCollection("uitgelicht", (api) =>
    api.getFilteredByTag("event")
      .filter((ev) => ev.data.uitgelicht && einde(ev) >= vandaag())
      .sort((a, b) => new Date(a.data.datum) - new Date(b.data.datum))
  );

  return {
    // Netlify serveert vanaf de wortel; GitHub Pages vanaf /tpleintje/.
    // Netlify zet altijd NETLIFY=true in de build-omgeving.
    pathPrefix: process.env.NETLIFY ? "/" : "/tpleintje/",
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk"
  };
};
