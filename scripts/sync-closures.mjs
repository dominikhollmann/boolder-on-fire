#!/usr/bin/env node
// Pulls the current wildfire closure zones from the "Forêt de Fontainebleau - zones
// interdites" uMap map and writes a slim data/fire-closures.geojson for js/map.js.
//
// IMPORTANT — read this before debugging a failed sync:
// This script's network access to umap.openstreetmap.fr was never verified against the
// live site: the sandbox this was written in blocks that domain entirely (confirmed via
// curl -> EGRESS_BLOCKED). GitHub Actions runners are NOT behind that block, so this is
// expected to actually run there — but the exact extraction strategy below is a
// best-effort implementation based on how uMap typically hydrates a map page, not a
// verified integration. If every strategy fails, the script exits non-zero with a clear
// message instead of silently leaving stale data in place. To fix a failing sync:
//   1. Open the map URL below in a browser, open devtools > Network, reload, and filter
//      for "datalayer" or ".geojson" — find the actual request(s) the page makes to load
//      the red-zone polygons.
//   2. Either add that URL pattern as a new strategy below, or hardcode the discovered
//      datalayer URL(s) into DATALAYER_URL_OVERRIDES.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MAP_URL = "https://umap.openstreetmap.fr/de/map/foret-de-fontainebleau-zones-interdites_1443097";
const MAP_ORIGIN = "https://umap.openstreetmap.fr";

// If the auto-discovery below ever breaks, paste known-good datalayer GeoJSON URLs here
// (found via the browser devtools steps in the comment above) to bypass discovery entirely.
const DATALAYER_URL_OVERRIDES = [];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "..", "data", "fire-closures.geojson");

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "boolder-on-fire-sync/1.0 (https://github.com/dominikhollmann/boolder-on-fire)" },
  });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.text();
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

// Recursively search a parsed JSON value for uMap "datalayer" entries: objects that
// either embed their geometry inline ({ geojson: { type: "FeatureCollection", ... } })
// or point at it via a URL field (commonly named "url" or "geojson" as a string).
function findDatalayerRefs(value, refs = []) {
  if (Array.isArray(value)) {
    for (const item of value) findDatalayerRefs(item, refs);
  } else if (value && typeof value === "object") {
    if (value.type === "FeatureCollection" && Array.isArray(value.features)) {
      refs.push({ inline: value });
    } else if (typeof value.geojson === "string" && /\.geojson(\?|$)/.test(value.geojson)) {
      refs.push({ url: value.geojson });
    } else if (typeof value.url === "string" && /datalayer|\.geojson/.test(value.url)) {
      refs.push({ url: value.url });
    } else {
      for (const key of Object.keys(value)) findDatalayerRefs(value[key], refs);
    }
  }
  return refs;
}

// Strategy 1: uMap server-renders the map's full config (including datalayers) into the
// page as an embedded JSON blob so the initial view doesn't need extra requests. Look for
// any <script type="application/json" ...>{...}</script> tag and mine it for datalayer refs.
async function discoverViaEmbeddedJson() {
  const html = await fetchText(MAP_URL);
  const blobs = [...html.matchAll(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  const refs = [];
  for (const [, raw] of blobs) {
    try {
      findDatalayerRefs(JSON.parse(raw), refs);
    } catch {
      // not valid JSON (or not the blob we're looking for) — skip
    }
  }
  return refs;
}

// Strategy 2: some uMap versions expose a per-map "download all data" endpoint.
async function discoverViaDownloadEndpoint() {
  const mapIdMatch = MAP_URL.match(/_(\d+)$/);
  if (!mapIdMatch) return [];
  const mapId = mapIdMatch[1];
  return [{ url: `${MAP_ORIGIN}/de/map/${mapId}/download/` }];
}

// Strategy 3: whatever the page actually references — regex-scan the raw HTML (not just
// parsed JSON blobs, so this also catches URLs embedded in inline <script> JS, data-*
// attributes, etc.) for anything that looks like a datalayer/geojson URL. This is the
// most format-agnostic strategy and doubles as a diagnostic: candidateUrls is attached to
// the returned refs list so a failure still reports exactly what was found on the page.
async function discoverViaRawHtmlScan() {
  const html = await fetchText(MAP_URL);
  const matches = new Set();
  const re = /["'](\/[^\s"'<>]*?(?:datalayer[^\s"'<>]*|\.geojson[^\s"'<>]*))["']/gi;
  let m;
  while ((m = re.exec(html))) matches.add(m[1]);

  const refs = [...matches].map((url) => ({ url }));
  refs.candidateUrls = [...matches]; // surfaced in the error message if this strategy fails too
  return refs;
}

function describeCandidates(refs) {
  if (!refs.candidateUrls) return "";
  return ` (candidate URLs seen on page: ${refs.candidateUrls.join(", ") || "none"})`;
}

async function resolveFeatureCollections() {
  if (DATALAYER_URL_OVERRIDES.length > 0) {
    return Promise.all(DATALAYER_URL_OVERRIDES.map((url) => fetchJson(url)));
  }

  const strategies = [discoverViaEmbeddedJson, discoverViaDownloadEndpoint, discoverViaRawHtmlScan];
  const errors = [];

  for (const strategy of strategies) {
    let refs;
    try {
      refs = await strategy();
    } catch (err) {
      errors.push(`${strategy.name}: ${err.message}`);
      continue;
    }
    if (refs.length === 0) {
      errors.push(`${strategy.name}: found no datalayer references`);
      continue;
    }

    try {
      const collections = await Promise.all(
        refs.map((ref) => (ref.inline ? ref.inline : fetchJson(new URL(ref.url, MAP_ORIGIN).href))),
      );
      const withFeatures = collections.filter(
        (c) => c && c.type === "FeatureCollection" && Array.isArray(c.features) && c.features.length > 0,
      );
      if (withFeatures.length > 0) return withFeatures;
      errors.push(`${strategy.name}: resolved datalayers but none contained features${describeCandidates(refs)}`);
    } catch (err) {
      errors.push(`${strategy.name}: ${err.message}${describeCandidates(refs)}`);
    }
  }

  throw new Error(
    `Could not resolve any fire-closure GeoJSON from ${MAP_URL}. Tried:\n  - ${errors.join("\n  - ")}\n` +
      `See the header comment in this file for how to fix this.`,
  );
}

// Keep only what js/map.js actually renders — drop uMap's internal styling/editor metadata.
function normalizeFeature(feature) {
  const props = feature.properties ?? {};
  return {
    type: "Feature",
    properties: {
      name: props.name ?? props.Name ?? null,
      description: props.description ?? props.Description ?? null,
    },
    geometry: feature.geometry,
  };
}

async function main() {
  const collections = await resolveFeatureCollections();

  const features = collections
    .flatMap((c) => c.features)
    .filter((f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"))
    .map(normalizeFeature);

  if (features.length === 0) {
    throw new Error("Resolved data from uMap but found zero polygon features — refusing to overwrite existing data.");
  }

  const output = {
    type: "FeatureCollection",
    properties: {
      lastSynced: new Date().toISOString(),
      source: MAP_URL,
    },
    features,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(`Wrote ${features.length} closure zone(s) to ${path.relative(process.cwd(), OUTPUT_PATH)}`);
}

main().catch((err) => {
  console.error("sync-closures failed:", err.message);
  process.exitCode = 1;
});
