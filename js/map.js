// Standalone Mapbox GL map: Boolder's public Fontainebleau boulder map (same style +
// vector tileset as https://github.com/boolder-org/boolder-rails, MIT licensed) plus a
// closures overlay showing the current Fontainebleau closures in red.
//
// Closures are split into one independently toggleable category per closed uMap layer
// (see scripts/sync-closures.mjs — categories are derived from the data itself, not
// hardcoded here, so a new uMap category shows up automatically). Each category gets its
// own fill/outline/lines/points layers sharing one "fire-closures" source, following the same
// pattern boolder-rails already uses for its optional "contribute" / "circuit7a"
// overlays: geojson layers inserted just before the style's "areas" layer, so boulder
// points stay on top. See upstream-patch/ for the ready-to-send patch that ports the
// core layer (not this per-category toggle UI) into the real boolder-rails app.

import { watchClosures } from "./closures.js";

const STYLE = "mapbox://styles/nmondollot/cl95n147u003k15qry7pvfmq2";
const FONTAINEBLEAU_BOUNDS = [
  [2.4806787, 48.2868427],
  [2.7698927, 48.473906],
];
const PROBLEMS_SOURCE = "mapbox://nmondollot.4xsv235p";
const PROBLEMS_SOURCE_LAYER = "problems-ayes3a";
const CLOSURE_COLOR = "#e2231a";
const CLOSURES_SOURCE_URL =
  "https://umap.openstreetmap.fr/en/map/foret-de-fontainebleau-zones-interdites_1443097";

const TOKEN_KEY = "boolder_on_fire_mapbox_token";
const VISIBILITY_KEY = "boolder_on_fire_category_visibility";

function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // localStorage unavailable (private mode, etc.)
  }
}

function storeToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // best-effort only — map still works for this page load without persistence
  }
}

function initTokenGate() {
  const overlay = document.getElementById("token-overlay");
  const existing = getStoredToken();

  if (existing) {
    overlay.classList.add("hidden");
    return Promise.resolve(existing);
  }

  overlay.classList.remove("hidden");
  const input = document.getElementById("token-input");
  const submit = document.getElementById("token-submit");

  return new Promise((resolve) => {
    function submitToken() {
      const token = input.value.trim();
      if (!token) return;
      storeToken(token);
      overlay.classList.add("hidden");
      resolve(token);
    }

    submit.addEventListener("click", submitToken);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitToken();
    });
  });
}

function addBoulderLayers(map) {
  map.addSource("problems", {
    type: "vector",
    url: PROBLEMS_SOURCE,
    promoteId: "id",
  });

  map.addLayer({
    id: "problems",
    type: "circle",
    source: "problems",
    "source-layer": PROBLEMS_SOURCE_LAYER,
    minzoom: 13,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 2, 18, 4, 22, 8],
      "circle-color": "#FFCC02",
      "circle-opacity": ["interpolate", ["linear"], ["zoom"], 12.5, 0, 13, 1],
    },
    filter: ["match", ["geometry-type"], ["Point"], true, false],
  });
}

// --- Per-category closure layers, toggles, and persisted visibility ---------------

function getStoredVisibility() {
  try {
    return JSON.parse(localStorage.getItem(VISIBILITY_KEY)) ?? {};
  } catch {
    return {};
  }
}

function storeVisibility(state) {
  try {
    localStorage.setItem(VISIBILITY_KEY, JSON.stringify(state));
  } catch {
    // best-effort only — toggle still works for this page load without persistence
  }
}

function layerIdsFor(category) {
  return [
    `fire-closures-${category}-fill`,
    `fire-closures-${category}-outline`,
    `fire-closures-${category}-lines`,
    `fire-closures-${category}-points`,
  ];
}

function applyVisibility(map, category, visible) {
  const visibility = visible ? "visible" : "none";
  for (const id of layerIdsFor(category)) {
    map.setLayoutProperty(id, "visibility", visibility);
  }
}

function attachClosurePopup(map, layerId) {
  map.on("mouseenter", layerId, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", layerId, () => {
    map.getCanvas().style.cursor = "";
  });
  map.on("click", layerId, (e) => {
    const props = e.features[0].properties;
    const label = props.categoryLabel || "Closure";
    const name = props.name || label;
    const description = props.description ? `<p>${props.description}</p>` : "";

    new mapboxgl.Popup({ closeButton: false, offset: [0, -4] })
      .setLngLat(e.lngLat)
      .setHTML(
        `<strong>${name}</strong><p>${label}</p>${description}` +
          `<p><a href="${CLOSURES_SOURCE_URL}" target="_blank" rel="noopener">Source: uMap</a></p>`,
      )
      .addTo(map);
  });
}

// Area fill/outline has no click popup — only lines and point markers do, so a zone
// polygon under a point marker (or a closed road running through one) doesn't produce two
// overlapping popups on click.
function addCategoryLayers(map, category, beforeId) {
  const forCategory = ["==", ["get", "category"], category];
  const isArea = ["all", forCategory, ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false]];
  const isLine = ["all", forCategory, ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false]];
  const isPoint = ["all", forCategory, ["==", ["geometry-type"], "Point"]];

  map.addLayer(
    {
      id: `fire-closures-${category}-fill`,
      type: "fill",
      source: "fire-closures",
      filter: isArea,
      paint: { "fill-color": CLOSURE_COLOR, "fill-opacity": 0.35 },
    },
    beforeId,
  );

  map.addLayer(
    {
      id: `fire-closures-${category}-outline`,
      type: "line",
      source: "fire-closures",
      filter: isArea,
      paint: { "line-color": CLOSURE_COLOR, "line-width": 2 },
    },
    beforeId,
  );

  const linesLayerId = `fire-closures-${category}-lines`;
  map.addLayer(
    {
      id: linesLayerId,
      type: "line",
      source: "fire-closures",
      filter: isLine,
      paint: { "line-color": CLOSURE_COLOR, "line-width": 4 },
    },
    beforeId,
  );

  const pointsLayerId = `fire-closures-${category}-points`;
  map.addLayer(
    {
      id: pointsLayerId,
      type: "circle",
      source: "fire-closures",
      filter: isPoint,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 8],
        "circle-color": CLOSURE_COLOR,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#fff",
      },
    },
    beforeId,
  );

  attachClosurePopup(map, linesLayerId);
  attachClosurePopup(map, pointsLayerId);
}

function getTogglePanel() {
  let panel = document.querySelector(".closures-panel");
  if (panel) return panel;

  panel = document.createElement("div");
  panel.className = "closures-panel";
  panel.innerHTML = `<div class="closures-panel-title">Closures</div>`;
  document.body.appendChild(panel);
  return panel;
}

function addToggleRow(panel, category, label, visible, onChange) {
  const row = document.createElement("label");
  row.className = "category-row";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = visible;
  checkbox.addEventListener("change", () => onChange(checkbox.checked));

  row.appendChild(checkbox);
  row.appendChild(document.createTextNode(label));
  panel.appendChild(row);
}

// Lazily creates a category's layers + toggle row the first time it's seen in synced
// data, so newly-appearing uMap categories (or, on first load, all of today's
// categories) get their own control without any hardcoded category list.
function ensureCategory(map, knownCategories, category, label, beforeId) {
  if (knownCategories.has(category)) return;
  knownCategories.add(category);

  addCategoryLayers(map, category, beforeId);

  const visible = getStoredVisibility()[category] ?? true;
  applyVisibility(map, category, visible);

  addToggleRow(getTogglePanel(), category, label, visible, (checked) => {
    applyVisibility(map, category, checked);
    const state = getStoredVisibility();
    state[category] = checked;
    storeVisibility(state);
  });
}

function updateClosures(map, knownCategories, data) {
  if (map.getSource("fire-closures")) {
    map.getSource("fire-closures").setData(data);
  } else {
    map.addSource("fire-closures", { type: "geojson", data });
  }

  const beforeId = map.getLayer("areas") ? "areas" : undefined;

  const categories = new Map(); // slug -> label
  for (const feature of data.features) {
    const { category, categoryLabel } = feature.properties;
    if (!categories.has(category)) categories.set(category, categoryLabel || category);
  }

  for (const [category, label] of categories) {
    ensureCategory(map, knownCategories, category, label, beforeId);
  }
}

function formatTimestamp(iso) {
  if (!iso) return "unknown";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

async function main() {
  const token = await initTokenGate();
  mapboxgl.accessToken = token;

  const map = new mapboxgl.Map({
    container: "map",
    style: STYLE,
    bounds: FONTAINEBLEAU_BOUNDS,
    padding: 20,
    hash: true,
  });

  map.addControl(new mapboxgl.NavigationControl());

  map.on("load", () => {
    addBoulderLayers(map);

    const knownCategories = new Set();
    watchClosures((data, lastSynced) => {
      updateClosures(map, knownCategories, data);
      document.getElementById("last-synced").textContent = formatTimestamp(lastSynced);
    });
  });
}

main();
