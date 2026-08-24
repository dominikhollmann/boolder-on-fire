#!/usr/bin/env node
// Pulls the current closure zones from the "Forêt de Fontainebleau - zones interdites"
// uMap map and writes a slim data/fire-closures.geojson for js/map.js.
//
// The uMap API used here was verified by reading the actual server source
// (https://github.com/umap-project/umap, files umap/urls.py + umap/models.py +
// umap/static/umap/js/modules/data/layer.js), not by guessing:
//   1. GET /{locale}/map/{mapId}/geojson/
//        -> JSON. `.properties.datalayers` is a tree (each node can have a nested
//           `layers` array) of datalayer metadata objects, each with a UUID `id`.
//           (umap/views.py: MapViewGeoJSON -> MapView.get_datalayers() -> layers_tree())
//   2. GET /{locale}/datalayer/{mapId}/{datalayerUuid}/
//        -> the datalayer's actual GeoJSON FeatureCollection, served as-is
//           (umap/views.py: DataLayerView, content-type application/geo+json)
//
// The map is organized as 5 topic groups, each with an "open" and a "closed" sub-layer
// (inspected via a one-off debug run against the live map, see git history):
//   Fonds de carte   -> Périmètre de la forêt domaniale (not a closure, just the forest
//                        boundary) / Zones interdites de fréquentation
//   Parkings         -> Parkings accessibles / Parkings fermés
//   Routes départementales -> Route ouverte à la circulation / Route barrée (lines, not
//                        polygons — excluded by the geometry filter below regardless)
//   Escalade         -> Zone d'escalade accessible / Zone d'escalade non accessible
//   Bivouacs         -> Bivouac accessible / Bivouacs fermés
// uMap itself colors every "closed" sub-layer Red or OrangeRed and every "open"/reference
// one Blue/DarkBlue — CLOSED_COLORS below relies on that existing editorial convention
// instead of matching on layer names, so it keeps working if the French labels change.
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
const CLOSED_COLORS = new Set(["Red", "OrangeRed"]);

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
// collect only the "closed" sub-layers, keeping each one's name for the popup fallback.
function collectClosureLayers(nodes, layers = []) {
  for (const node of nodes ?? []) {
    if (node.id && CLOSED_COLORS.has(node.properties?.color)) {
      layers.push({ id: node.id, name: node.properties?.name ?? null });
    }
    if (Array.isArray(node.layers)) collectClosureLayers(node.layers, layers);
  }
  return layers;
}

async function fetchClosureLayers() {
  const mapSettings = await fetchJson(`${MAP_ORIGIN}/${MAP_LOCALE}/map/${MAP_ID}/geojson/`);
  const layers = collectClosureLayers(mapSettings.properties?.datalayers);
  if (layers.length === 0) {
    throw new Error(
      `Map ${MAP_ID} has no "closed" (Red/OrangeRed) datalayers — the map's structure may ` +
        `have changed. Raw properties.datalayers: ${JSON.stringify(mapSettings.properties?.datalayers)}`,
    );
  }
  return layers;
}

// Returns [{ name, collection }] — collection is the layer's raw FeatureCollection.
async function fetchFeatureCollections() {
  if (DATALAYER_URL_OVERRIDES.length > 0) {
    return Promise.all(
      DATALAYER_URL_OVERRIDES.map(async (url) => ({ name: null, collection: await fetchJson(url) })),
    );
  }

  const layers = await fetchClosureLayers();
  return Promise.all(
    layers.map(async (layer) => ({
      name: layer.name,
      collection: await fetchJson(`${MAP_ORIGIN}/${MAP_LOCALE}/datalayer/${MAP_ID}/${layer.id}/`),
    })),
  );
}

// Keep only what js/map.js actually renders — drop uMap's internal styling/editor
// metadata. Individual closure polygons rarely carry their own name/description in this
// map, so fall back to the enclosing layer's name (e.g. "Zone d'escalade non accessible").
function normalizeFeature(feature, layerName) {
  const props = feature.properties ?? {};
  return {
    type: "Feature",
    properties: {
      name: props.name ?? props.Name ?? layerName,
      description: props.description ?? props.Description ?? null,
    },
    geometry: feature.geometry,
  };
}

async function main() {
  const layers = await fetchFeatureCollections();

  const features = layers.flatMap(({ name, collection }) =>
    (collection.features ?? [])
      .filter((f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"))
      .map((f) => normalizeFeature(f, name)),
  );

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
