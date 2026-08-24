// Loads data/fire-closures.geojson (kept current by scripts/sync-closures.mjs via the
// sync-closures GitHub Action) and re-fetches it periodically so a tab left open stays
// up to date without a page reload.

const DATA_URL = "data/fire-closures.geojson";
const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * @param {(featureCollection: GeoJSON.FeatureCollection, lastSynced: string | null) => void} onUpdate
 *   Called once with the initial data, then again every time a poll finds a change.
 */
export function watchClosures(onUpdate) {
  let lastRaw = null;

  async function load() {
    let data;
    try {
      const res = await fetch(`${DATA_URL}?_=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      console.error("boolder-on-fire: could not load fire-closures.geojson", err);
      return;
    }

    const raw = JSON.stringify(data);
    if (raw === lastRaw) return; // no change, skip re-render
    lastRaw = raw;

    const lastSynced = data.properties?.lastSynced ?? null;
    onUpdate(data, lastSynced);
  }

  load();
  setInterval(load, POLL_INTERVAL_MS);
}
