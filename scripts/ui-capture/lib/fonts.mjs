// Offline font check (plan T4 / §9b C5). Real loading, never fonts.check():
// for every bundled family / weight / style, document.fonts.load() must
// return the matching FontFace and that face must be "loaded"; every font
// response must come from the page's own origin and succeed; no font request
// may leave the origin.

/* global document -- functions passed to page.evaluate run in the page */

/** The faces index.html used to fetch from Google Fonts, now bundled. */
export const REQUIRED_FACES = [
  ...[300, 400, 500, 600, 700].map((weight) => ({ family: "IBM Plex Sans", weight, style: "normal" })),
  { family: "IBM Plex Sans", weight: 400, style: "italic" },
  ...[400, 500, 600].map((weight) => ({ family: "JetBrains Mono", weight, style: "normal" })),
];

const FONT_URL = /\.(woff2?|ttf|otf)(\?|$)|fonts\.(googleapis|gstatic)\.com/;

/**
 * Watch a page's font traffic. Call before navigation; `external` lists font
 * requests to any other origin, `responses` every font response.
 */
export function watchFontTraffic(page, origin) {
  const traffic = { external: [], responses: [], failed: [] };
  page.on("request", (request) => {
    const url = request.url();
    if (FONT_URL.test(url) && new URL(url).origin !== origin) traffic.external.push(url);
  });
  page.on("response", (response) => {
    const url = response.url();
    if (/\.(woff2?|ttf|otf)(\?|$)/.test(url)) traffic.responses.push({ url, status: response.status(), ok: response.ok() });
  });
  page.on("requestfailed", (request) => {
    if (FONT_URL.test(request.url())) traffic.failed.push(request.url());
  });
  return traffic;
}

/** Load every required face in the page and report each one's state. */
export async function loadRequiredFaces(page, faces = REQUIRED_FACES) {
  return page.evaluate(async (required) => {
    const strip = (family) => family.replace(/^["']|["']$/g, "");
    const results = [];
    for (const face of required) {
      const descriptor = `${face.style} ${face.weight} 16px "${face.family}"`;
      let returned = [];
      let error = null;
      try {
        // Latin sample: selects the latin unicode-range subset. WebKit can
        // leave the promise pending for an undecodable file, so bound it.
        returned = await Promise.race([
          document.fonts.load(descriptor, "Ag"),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout after 5s")), 5000)),
        ]);
      } catch (e) {
        error = String(e?.message ?? e);
      }
      const matches = (f) => strip(f.family) === face.family && String(f.weight) === String(face.weight) && f.style === face.style;
      const matching = [...document.fonts].filter(matches);
      const latin = matching.filter((f) => f.unicodeRange === "U+0-10FFFF" || /U\+0000-00FF|U\+0-FF/i.test(f.unicodeRange));
      results.push({
        ...face,
        error,
        returned: returned.filter(matches).map((f) => f.status),
        latinStatus: latin.map((f) => f.status),
        matchingFaces: matching.length,
      });
    }
    return results;
  }, faces);
}

/** Problems of one offline font check (empty = every face really loaded locally). */
export function fontProblems({ faces, traffic }) {
  const problems = [];
  for (const face of faces) {
    const name = `${face.family} ${face.weight} ${face.style}`;
    if (face.error) problems.push(`${name}: document.fonts.load rejected (${face.error})`);
    if (face.matchingFaces === 0) problems.push(`${name}: no @font-face`);
    if (!face.returned.length || face.returned.some((s) => s !== "loaded")) {
      problems.push(`${name}: document.fonts.load returned ${JSON.stringify(face.returned)}`);
    }
    if (!face.latinStatus.length || face.latinStatus.some((s) => s !== "loaded")) {
      problems.push(`${name}: latin FontFace status ${JSON.stringify(face.latinStatus)}`);
    }
  }
  for (const url of traffic.external) problems.push(`external font request ${url}`);
  for (const response of traffic.responses.filter((r) => !r.ok)) problems.push(`font response ${response.status} ${response.url}`);
  for (const url of traffic.failed) problems.push(`font request failed ${url}`);
  if (traffic.responses.length === 0) problems.push("no local font response");
  return problems;
}
