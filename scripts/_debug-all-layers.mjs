#!/usr/bin/env node
// One-off diagnostic: inspect EVERY sub-layer (not just Red/OrangeRed ones) to see its
// color, geometry types, and feature count. Not part of the real sync pipeline.
const MAP_ORIGIN = "https://umap.openstreetmap.fr";
const MAP_LOCALE = "en";
const MAP_ID = 1443097;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "boolder-on-fire-debug/1.0" } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

function collectAllLayers(nodes, layers = []) {
  for (const node of nodes ?? []) {
    if (node.id) layers.push({ id: node.id, name: node.properties?.name ?? null, color: node.properties?.color ?? null });
    if (Array.isArray(node.layers)) collectAllLayers(node.layers, layers);
  }
  return layers;
}

async function main() {
  const mapSettings = await fetchJson(`${MAP_ORIGIN}/${MAP_LOCALE}/map/${MAP_ID}/geojson/`);
  const layers = collectAllLayers(mapSettings.properties?.datalayers);
  console.log(`Found ${layers.length} total sub-layers`);

  for (const layer of layers) {
    const collection = await fetchJson(`${MAP_ORIGIN}/${MAP_LOCALE}/datalayer/${MAP_ID}/${layer.id}/`);
    const features = collection.features ?? [];
    const geomTypes = {};
    for (const f of features) {
      const t = f.geometry?.type ?? "null";
      geomTypes[t] = (geomTypes[t] ?? 0) + 1;
    }
    console.log(`- "${layer.name}" | color=${layer.color} | ${features.length} features | geometry:`, geomTypes);
  }
}

main().catch((err) => {
  console.error("debug failed:", err.message);
  process.exitCode = 1;
});
