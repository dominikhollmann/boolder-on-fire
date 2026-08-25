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
// Boulders are colored by their circuit's color (a Fontainebleau convention: marked
// circuits, not raw numeric grade), same mapping boolder-rails' own mapbox_controller.js
// uses. Problems with no circuit (circuitColor "" or missing) fall back to yellow, same
// as boolder-rails; anything else unrecognized falls back to gray.
const DEFAULT_PROBLEM_COLOR = "#878A8D";
const CIRCUIT_COLOR_EXPRESSION = [
  "match",
  ["get", "circuitColor"],
  ["", "yellow"],
  "#FFCC02",
  "purple",
  "#D783FF",
  "orange",
  "#FF9500",
  "green",
  "#77C344",
  "blue",
  "#017AFF",
  "skyblue",
  "#5AC7FA",
  "salmon",
  "#FDAF8A",
  "red",
  "#FF3B2F",
  "black",
  "#000",
  "white",
  "#FFFFFF",
  DEFAULT_PROBLEM_COLOR,
];
const CLOSURE_COLOR = "#e2231a";
const CLOSURES_SOURCE_URL =
  "https://umap.openstreetmap.fr/en/map/foret-de-fontainebleau-zones-interdites_1443097";
const ONF_SOURCE_URL =
  "https://www.onf.fr/vivre-la-foret/+/2d9a::foret-de-fontainebleau-carte-des-sentiers-et-routes-forestieres-accessibles.html";

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
      "circle-color": CIRCUIT_COLOR_EXPRESSION,
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

// name/categoryLabel/description come from ONF's public uMap map (via
// scripts/sync-closures.mjs) — still untrusted third-party text. Popup.setHTML() assigns
// via innerHTML with no escaping of its own, so escape before interpolating to avoid
// stored XSS.
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
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
    const label = escapeHtml(props.categoryLabel || "Closure");
    const name = escapeHtml(props.name || props.categoryLabel || "Closure");
    const description = props.description ? `<p>${escapeHtml(props.description)}</p>` : "";

    new mapboxgl.Popup({ closeButton: false, offset: [0, -4] })
      .setLngLat(e.lngLat)
      .setHTML(
        `<strong>${name}</strong><p>${label}</p>${description}` +
          `<p><a href="${ONF_SOURCE_URL}" target="_blank" rel="noopener">Source: ONF</a> · ` +
          `<a href="${CLOSURES_SOURCE_URL}" target="_blank" rel="noopener">Live data</a></p>`,
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

const PANEL_OPEN_KEY = "boolder_on_fire_panel_open";

function getStoredPanelOpen() {
  try {
    return localStorage.getItem(PANEL_OPEN_KEY) === "true";
  } catch {
    return false; // collapsed by default — keeps the map clear on first load, esp. on phones
  }
}

function storePanelOpen(open) {
  try {
    localStorage.setItem(PANEL_OPEN_KEY, String(open));
  } catch {
    // best-effort only — toggle still works for this page load without persistence
  }
}

function setPanelOpen(open) {
  document.querySelector(".closures-panel")?.classList.toggle("hidden", !open);
  const button = document.querySelector(".closures-toggle-btn");
  button?.classList.toggle("is-open", open);
  button?.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("panel-open", open); // shrinks .banner so it doesn't overlap
  storePanelOpen(open);
}

// Single filter icon that shows/hides the category panel — keeps the map's top-right
// corner (where Mapbox's own zoom controls also live) usable on small phone screens.
function initClosuresToggleButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "closures-toggle-btn";
  button.setAttribute("aria-label", "Toggle closures filter");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/>' +
    "</svg>";
  document.body.appendChild(button);

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !document.querySelector(".closures-panel")?.classList.contains("hidden");
    setPanelOpen(!isOpen);
  });

  document.addEventListener("click", (e) => {
    const panel = document.querySelector(".closures-panel");
    if (!panel || panel.classList.contains("hidden")) return;
    if (panel.contains(e.target) || button.contains(e.target)) return;
    setPanelOpen(false);
  });
}

function getTogglePanel() {
  let panel = document.querySelector(".closures-panel");
  if (panel) return panel;

  initClosuresToggleButton();

  panel = document.createElement("div");
  panel.className = "closures-panel hidden";
  panel.innerHTML = `<div class="closures-panel-title">Closures</div>`;
  document.body.appendChild(panel);

  setPanelOpen(getStoredPanelOpen());
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

  // bottom-right: top-right is reserved for the closures filter button/panel
  map.addControl(new mapboxgl.NavigationControl(), "bottom-right");

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
