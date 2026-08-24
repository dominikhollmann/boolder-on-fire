# boolder-on-fire

Closures in the Fontainebleau forest, shown on a [Boolder](https://www.boolder.com)-style
boulder map.

Parts of Fontainebleau are currently off-limits (including wildfire-related closures).
These closures are maintained on a community uMap map:
<https://umap.openstreetmap.fr/en/map/foret-de-fontainebleau-zones-interdites_1443097>

[Boolder](https://github.com/boolder-org/boolder-rails) is the reference map for boulder
problems in Fontainebleau but doesn't show these closures. This repo is a prototype that
overlays them on top of Boolder's boulder points and keeps the data current automatically
— as a template for a possible real Boolder feature (see
[`upstream-patch/`](upstream-patch/)). Closures are grouped into categories (all marked
red), each independently toggleable via the panel in the top-right corner — your choices
are remembered in the browser for next time. Categories are derived directly from
whatever closed layers currently exist on the uMap map (see
[Data pipeline](#data-pipeline)), so a new one uMap adds shows up automatically; today
that's:

- **Closed area** — general no-access polygons (red shaded areas)
- **Climbing zone closed** — closed boulder/climbing areas, e.g. individual circuit numbers or sectors
- **Parking closed**
- **Bivouac closed**

Only point markers (not the area fill) show a click popup — this avoids two overlapping
popups when a marker sits inside a shaded zone.

> ⚠️ **Not an official Boolder service.** This is an independent prototype, not affiliated
> with boolder.com. Closure data comes from a community uMap map and may be outdated or
> incomplete. **Always follow official on-site signage**, not this map.

## Language

This project is English-only — code, comments, docs, and UI. Keep it that way for any
future changes.

## What's in here

```
index.html                      # Standalone Mapbox GL map, no build step
js/map.js                       # Map setup: Boolder style + boulder points + per-category closures layers (areas + point markers, red) + toggle panel
js/closures.js                  # Loads data/fire-closures.geojson, polls periodically
data/fire-closures.geojson      # Latest synced data (written by the GitHub Action)
scripts/sync-closures.mjs       # Node script: fetches current closures from uMap, writes data/fire-closures.geojson
.github/workflows/sync-closures.yml  # Cron job that runs sync-closures.mjs regularly
upstream-patch/                 # Ready-to-send patch + instructions for proposing the feature to boolder-org
```

## Running locally

No build step needed — any static web server works:

```bash
npx serve .
# or: python3 -m http.server 8000
```

Then open `index.html` in a browser. On first load it asks for a **public Mapbox access
token** (stored only in the browser's `localStorage`, never sent to any server of ours).
Get a free token at <https://account.mapbox.com/access-tokens/>.

## Data pipeline

`scripts/sync-closures.mjs` fetches the current closures (both area polygons **and** point
markers for closed climbing zones/parkings/bivouacs) from the uMap map, trims them down to
the fields needed for display, and writes `data/fire-closures.geojson`. The
[GitHub Action](.github/workflows/sync-closures.yml) runs this script every 6 hours (and
on manual "Run workflow") and commits changes automatically. The static page loads this
file on open and re-polls it every 30 minutes (`js/closures.js`), so tabs left open stay
current.

Run manually (e.g. to test locally):

```bash
node scripts/sync-closures.mjs
```

**Note on the data source:** the uMap map is a pure client-rendered SPA — none of the
datalayer URLs appear directly in the HTML. `sync-closures.mjs` therefore uses the real
API, verified from the [uMap source code](https://github.com/umap-project/umap):
`GET /{locale}/map/{mapId}/geojson/` returns the list of datalayer IDs (UUIDs),
`GET /{locale}/datalayer/{mapId}/{uuid}/` returns each layer's actual GeoJSON. If the sync
still fails (e.g. because uMap changes its API), the error message is in the GitHub
Actions log; `DATALAYER_URL_OVERRIDES` in `scripts/sync-closures.mjs` is the fallback for
pasting in known-good datalayer URLs directly.

Each feature is tagged with a `category` (a stable slug derived from its uMap layer's
name, e.g. `zone-d-escalade-non-accessible`) and a `categoryLabel` (a nicer English label
for the categories `sync-closures.mjs` recognizes today, or the raw uMap layer name
otherwise). `js/map.js` uses these to build one toggle per category automatically — no
category list to keep in sync by hand.

## Offering this to Boolder

[`upstream-patch/`](upstream-patch/) contains a ready-made diff that adds the closures
layer following the same pattern as the existing `contribute`/`circuit7a` layers in
`boolder-rails`. Boolder's own README asks contributors to get in touch **before** opening
a pull request, at hello@boolder.com — see
[`upstream-patch/README.md`](upstream-patch/README.md) for details.

## License

MIT, see [Boolder's license](https://github.com/boolder-org/boolder-rails/blob/main/LICENSE).
The `mapbox://` style and boulder vector tileset are operated by Boolder and referenced
here for demo purposes only (public IDs from boolder-rails' open-source repo).
