#!/usr/bin/env node
// One-off diagnostic: check whether the uMap map declares a data license and who owns it.
const MAP_ORIGIN = "https://umap.openstreetmap.fr";
const MAP_LOCALE = "en";
const MAP_ID = 1443097;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "boolder-on-fire-license-check/1.0" } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const mapSettings = await fetchJson(`${MAP_ORIGIN}/${MAP_LOCALE}/map/${MAP_ID}/geojson/`);
  const props = mapSettings.properties ?? {};
  console.log("licence field:", JSON.stringify(props.licence ?? null));
  console.log("permissions field:", JSON.stringify(props.permissions ?? null));
  console.log("editStatus / edit_status:", props.editStatus, props.edit_status);
  console.log("shareStatus / share_status:", props.shareStatus, props.share_status);
  console.log("name:", props.name);
  console.log("description present:", typeof props.description === "string", (props.description ?? "").slice(0, 300));
  console.log("author/user field:", JSON.stringify(props.user ?? null));
  console.log("full properties keys:", Object.keys(props));
}

main().catch((err) => {
  console.error("license check failed:", err.message);
  process.exitCode = 1;
});
