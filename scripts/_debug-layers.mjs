#!/usr/bin/env node
// One-off diagnostic: inspect every "closed" (Red/OrangeRed) sub-layer directly to see
// its actual feature count and geometry types. Not part of the real sync pipeline.
const MAP_ORIGIN = "https://umap.openstreetmap.fr";
const MAP_LOCALE = "de";
const MAP_ID = 1443097;
const CLOSED_COLORS = new Set(["Red", "OrangeRed"]);

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "boolder-on-fire-debug/1.0" } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

function collectClosureLayers(nodes, layers = []) {
  for (const node of nodes ?? []) {
    if (node.id && CLOSED_COLORS.has(node.properties?.color)) {
      layers.push({ id: node.id, name: node.properties?.name ?? null });
    }
    if (Array.isArray(node.layers)) collectClosureLayers(node.layers, layers);
  }
  return layers;
}

async function main() {
  const mapSettings = await fetchJson(`${MAP_ORIGIN}/${MAP_LOCALE}/map/${MAP_ID}/geojson/`);
  const layers = collectClosureLayers(mapSettings.properties?.datalayers);

  for (const layer of layers) {
    const collection = await fetchJson(`${MAP_ORIGIN}/${MAP_LOCALE}/datalayer/${MAP_ID}/${layer.id}/`);
    const features = collection.features ?? [];
    const geomTypes = {};
    for (const f of features) {
      const t = f.geometry?.type ?? "null";
      geomTypes[t] = (geomTypes[t] ?? 0) + 1;
    }
    console.log(`${layer.name} (${layer.id}): ${features.length} features, geometry types:`, geomTypes);
    for (const f of features.slice(0, 3)) {
      console.log("  sample properties:", JSON.stringify(f.properties));
    }
  }
}

main().catch((err) => {
  console.error("debug failed:", err.message);
  process.exitCode = 1;
});
