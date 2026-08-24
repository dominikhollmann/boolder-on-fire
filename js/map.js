// Standalone Mapbox GL map: Boolder's public Fontainebleau boulder map (same style +
// vector tileset as https://github.com/boolder-org/boolder-rails, MIT licensed) plus a
// new "fire-closures" overlay layer showing the current wildfire closure zones in red.
//
// The closures layer follows the same pattern boolder-rails already uses for its
// optional "contribute" / "circuit7a" overlays (see mapbox_controller.js there): a
// geojson source added conditionally and inserted just before the style's "areas"
// layer, so boulder points stay on top. See upstream-patch/ for the ready-to-send
// patch that ports this layer into the real boolder-rails app.

import { watchClosures } from "./closures.js";

const STYLE = "mapbox://styles/nmondollot/cl95n147u003k15qry7pvfmq2";
const FONTAINEBLEAU_BOUNDS = [
  [2.4806787, 48.2868427],
  [2.7698927, 48.473906],
];
const PROBLEMS_SOURCE = "mapbox://nmondollot.4xsv235p";
const PROBLEMS_SOURCE_LAYER = "problems-ayes3a";
const CLOSURE_COLOR = "#e2231a";
const CLOSURE_LAYER_IDS = ["fire-closures-fill", "fire-closures-outline", "fire-closures-points"];
const CATEGORY_LABELS = {
  zone: "Sperrzone",
  parking: "Parkplatz gesperrt",
  climbing: "Kletterzone gesperrt",
  bivouac: "Biwak gesperrt",
  other: "Sperrung",
};

const TOKEN_KEY = "boolder_on_fire_mapbox_token";

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

function addClosuresLayer(map, data) {
  if (map.getSource("fire-closures")) {
    map.getSource("fire-closures").setData(data);
    return;
  }

  map.addSource("fire-closures", { type: "geojson", data });

  const beforeId = map.getLayer("areas") ? "areas" : undefined;

  map.addLayer(
    {
      id: "fire-closures-fill",
      type: "fill",
      source: "fire-closures",
      paint: {
        "fill-color": CLOSURE_COLOR,
        "fill-opacity": 0.35,
      },
    },
    beforeId,
  );

  map.addLayer(
    {
      id: "fire-closures-outline",
      type: "line",
      source: "fire-closures",
      paint: {
        "line-color": CLOSURE_COLOR,
        "line-width": 2,
      },
    },
    beforeId,
  );

  map.addLayer(
    {
      id: "fire-closures-points",
      type: "circle",
      source: "fire-closures",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 8],
        "circle-color": CLOSURE_COLOR,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#fff",
      },
    },
    beforeId,
  );

  for (const layerId of ["fire-closures-fill", "fire-closures-points"]) {
    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("click", layerId, (e) => {
      const props = e.features[0].properties;
      const category = CATEGORY_LABELS[props.category] ?? CATEGORY_LABELS.other;
      const name = props.name || category;
      const description = props.description ? `<p>${props.description}</p>` : "";

      new mapboxgl.Popup({ closeButton: false, offset: [0, -4] })
        .setLngLat(e.lngLat)
        .setHTML(
          `<strong>${name}</strong><p>${category}</p>${description}` +
            `<p><a href="https://umap.openstreetmap.fr/de/map/foret-de-fontainebleau-zones-interdites_1443097" target="_blank" rel="noopener">Quelle: uMap</a></p>`,
        )
        .addTo(map);
    });
  }
}

function initToggleControl(map) {
  const control = document.createElement("div");
  control.className = "toggle-control";
  control.innerHTML = `<button type="button"><span class="swatch"></span>Sperrungen</button>`;
  document.body.appendChild(control);

  let visible = true;
  control.querySelector("button").addEventListener("click", () => {
    visible = !visible;
    const visibility = visible ? "visible" : "none";
    for (const layerId of CLOSURE_LAYER_IDS) {
      map.setLayoutProperty(layerId, "visibility", visibility);
    }
    control.classList.toggle("is-off", !visible);
  });
}

function formatTimestamp(iso) {
  if (!iso) return "unbekannt";
  try {
    return new Date(iso).toLocaleString("de-DE", {
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

    let toggleAdded = false;
    watchClosures((data, lastSynced) => {
      addClosuresLayer(map, data);
      document.getElementById("last-synced").textContent = formatTimestamp(lastSynced);

      if (!toggleAdded) {
        initToggleControl(map);
        toggleAdded = true;
      }
    });
  });
}

main();
