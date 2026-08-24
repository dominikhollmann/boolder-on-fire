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
//                        boundary) / Zones interdites de fréquentation (Polygon)
//   Parkings         -> Parkings accessibles / Parkings fermés (Point)
//   Routes départementales -> Route ouverte à la circulation / Route barrée (lines, not
//                        polygon/point — excluded by the geometry filter below regardless)
//   Escalade         -> Zone d'escalade accessible / Zone d'escalade non accessible (Point
//                        — the actually climbing-relevant one, e.g. closed circuit numbers
//                        like "91.1" or sector names like "Cul de Chien")
//   Bivouacs         -> Bivouac accessible / Bivouacs fermés (Point)
// uMap itself colors every "closed" sub-layer Red or OrangeRed and every "open"/reference
// one Blue/DarkBlue — CLOSED_COLORS below relies on that existing editorial convention
// instead of matching on layer names, so it keeps working if the French labels change.
//
// Every closed layer becomes its own category (slugified from its uMap layer name) so
// js/map.js can render an independent on/off toggle per category — this stays correct
// automatically if uMap adds, removes, or renames a closed layer, no hardcoded list to
// maintain. KNOWN_CATEGORY_LABELS below only supplies a nicer English label for the
// categories we know about today; anything else falls back to the layer's own (French)
// name rather than a generic "other" bucket, so it still gets its own toggle and isn't
// silently merged with unrelated closures.
//
// If uMap changes this API, DATALAYER_URL_OVERRIDES below is the escape hatch: paste
// known-good datalayer GeoJSON URLs (found via browser devtools > Network, filtering for
// "datalayer") to bypass discovery entirely.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MAP_ORIGIN = "https://umap.openstreetmap.fr";
const MAP_LOCALE = "en";
const MAP_ID = 1443097;
const MAP_URL = `${MAP_ORIGIN}/${MAP_LOCALE}/map/foret-de-fontainebleau-zones-interdites_${MAP_ID}`;
const CLOSED_COLORS = new Set(["Red", "OrangeRed"]);
const KNOWN_CATEGORY_LABELS = {
  "Zones interdites de fréquentation": "Closed area",
  "Parkings fermés": "Parking closed",
  "Zone d'escalade non accessible": "Climbing zone closed",
  "Bivouacs fermés": "Bivouac closed",
};

const DATALAYER_URL_OVERRIDES = [];

function slugify(value) {
  return (value ?? "other")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Returns { slug, label } for a closed layer's name — slug is the stable machine key used
// for js/map.js's per-category filters/toggles/localStorage; label is what's shown in the UI.
function categoryFor(layerName) {
  return {
    slug: slugify(layerName),
    label: KNOWN_CATEGORY_LABELS[layerName] ?? layerName ?? "Closure",
  };
}

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

const RENDERABLE_GEOMETRY_TYPES = new Set(["Polygon", "MultiPolygon", "Point"]);

// Keep only what js/map.js actually renders — drop uMap's internal styling/editor
// metadata. Individual closure features rarely carry their own name/description in this
// map's area layer, so fall back to the enclosing layer's name (e.g. "Zone d'escalade non
// accessible"); point layers (parking, climbing, bivouac) do carry real names.
function normalizeFeature(feature, layerName, category) {
  const props = feature.properties ?? {};
  return {
    type: "Feature",
    properties: {
      name: props.name ?? props.Name ?? layerName,
      description: props.description ?? props.Description ?? null,
      category: category.slug,
      categoryLabel: category.label,
    },
    geometry: feature.geometry,
  };
}

async function main() {
  const layers = await fetchFeatureCollections();

  const features = layers.flatMap(({ name, collection }) => {
    const category = categoryFor(name);
    return (collection.features ?? [])
      .filter((f) => f.geometry && RENDERABLE_GEOMETRY_TYPES.has(f.geometry.type))
      .map((f) => normalizeFeature(f, name, category));
  });

  if (features.length === 0) {
    throw new Error("Fetched uMap data but found zero renderable (polygon/point) features — refusing to overwrite existing data.");
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
  console.log(`Wrote ${features.length} closure feature(s) to ${path.relative(process.cwd(), OUTPUT_PATH)}`);
}

main().catch((err) => {
  console.error("sync-closures failed:", err.message);
  process.exitCode = 1;
});
