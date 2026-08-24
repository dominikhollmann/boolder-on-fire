#!/usr/bin/env node
// Pulls the current wildfire closure zones from the "Forêt de Fontainebleau - zones
// interdites" uMap map and writes a slim data/fire-closures.geojson for js/map.js.
//
// The uMap API used here was verified by reading the actual server source
// (https://github.com/umap-project/umap, files umap/urls.py + umap/models.py +
// umap/static/umap/js/modules/data/layer.js), not by guessing — an earlier version of
// this script tried three speculative strategies against the live site and all three
// failed (see git history), because uMap's map page is a client-rendered SPA: the
// datalayer URLs are built in JS from a URL template + numeric map id + per-layer UUID,
// never present as a literal URL string anywhere in the HTML.
//
// The real shape, confirmed from source:
//   1. GET /{locale}/map/{mapId}/geojson/
//        -> JSON. `.properties.datalayers` is a tree (each node can have a nested
//           `layers` array) of datalayer metadata objects, each with a UUID `id`.
//           (umap/views.py: MapViewGeoJSON -> MapView.get_datalayers() -> layers_tree())
//   2. GET /{locale}/datalayer/{mapId}/{datalayerUuid}/
//        -> the datalayer's actual GeoJSON FeatureCollection, served as-is
//           (umap/views.py: DataLayerView, content-type application/geo+json)
//
// If uMap changes this API, DATALAYER_URL_OVERRIDES below is the escape hatch: paste
// known-good datalayer GeoJSON URLs (found via browser devtools > Network, filtering for
// "datalayer") to bypass discovery entirely.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MAP_ORIGIN = "https://umap.openstreetmap.fr";
const MAP_LOCALE = "de";
const MAP_ID = 1443097;
const MAP_URL = `${MAP_ORIGIN}/de/map/foret-de-fontainebleau-zones-interdites_${MAP_ID}`;

const DATALAYER_URL_OVERRIDES = [];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "..", "data", "fire-closures.geojson");

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "boolder-on-fire-sync/1.0 (https://github.com/dominikhollmann/boolder-on-fire)" },
  });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

// Walk the datalayers tree (root nodes + each node's optional nested `layers` array) and
// collect every datalayer UUID.
function collectDatalayerIds(nodes, ids = []) {
  for (const node of nodes ?? []) {
    if (node.id) ids.push(node.id);
    if (Array.isArray(node.layers)) collectDatalayerIds(node.layers, ids);
  }
  return ids;
}

async function fetchDatalayerIds() {
  const mapSettings = await fetchJson(`${MAP_ORIGIN}/${MAP_LOCALE}/map/${MAP_ID}/geojson/`);
  const ids = collectDatalayerIds(mapSettings.properties?.datalayers);
  if (ids.length === 0) {
    throw new Error(
      `Map ${MAP_ID} has no datalayers (or the response shape changed) — ` +
        `raw properties.datalayers: ${JSON.stringify(mapSettings.properties?.datalayers)}`,
    );
  }
  return ids;
}

async function fetchFeatureCollections() {
  if (DATALAYER_URL_OVERRIDES.length > 0) {
    return Promise.all(DATALAYER_URL_OVERRIDES.map((url) => fetchJson(url)));
  }

  const ids = await fetchDatalayerIds();
  return Promise.all(ids.map((id) => fetchJson(`${MAP_ORIGIN}/${MAP_LOCALE}/datalayer/${MAP_ID}/${id}/`)));
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
  const collections = await fetchFeatureCollections();

  const features = collections
    .flatMap((c) => c.features ?? [])
    .filter((f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"))
    .map(normalizeFeature);

  if (features.length === 0) {
    throw new Error("Fetched uMap data but found zero polygon features — refusing to overwrite existing data.");
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
