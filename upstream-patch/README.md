# Patch for boolder-rails

This folder contains a ready-made, tested diff that adds the closures layer (area
polygons **and** point markers for closed climbing zones/parkings/bivouacs) directly to
the real [`boolder-rails`](https://github.com/boolder-org/boolder-rails) app — as a
proposal, in case the Boolder maintainers want to adopt the feature officially.

## Before opening a pull request: ask first

The `boolder-rails` README explicitly asks contributors to get in touch **before** opening
a pull request (`hello@boolder.com`). Please don't skip this step — link to
[`../README.md`](../README.md) (the running prototype) and this diff as a starting point
for discussion.

## What the patch does

It follows exactly the pattern `mapbox_controller.js` already uses for the optional
`contribute` and `circuit7a` overlays: a GeoJSON layer toggled by a Stimulus `Value` flag,
inserted below the existing `areas` layer.

- **`mapbox_controller.patch`** — `app/javascript/controllers/mapbox_controller.js`:
  - new `closures` (Boolean) and `closuresSource` (String) values
  - new `fire-closures` source + three layers (`fire-closures-fill`, `fire-closures-outline`
    for areas; `fire-closures-points` for point markers, filtered to `Point` geometries) in `addLayers()`
  - click popup (name, category label, description) in `setupClickEvents()`, for both
    areas and points
- **`map_index.patch`** — `app/views/map/index.html.erb`:
  - sets `data-mapbox-closures-value="true"` and `data-mapbox-closures-source-value` to
    the GeoJSON file from this repo (`dominikhollmann/boolder-on-fire`, kept current every
    6h by a GitHub Action — see [`../scripts/sync-closures.mjs`](../scripts/sync-closures.mjs)).
    **Intended only as a starting point** — for a real integration, Boolder should host/proxy
    the data itself (its own route + its own sync job) so the core feature doesn't depend
    on an external third-party repo.

## Applying

```bash
cd boolder-rails
git apply /path/to/boolder-on-fire/upstream-patch/mapbox_controller.patch
git apply /path/to/boolder-on-fire/upstream-patch/map_index.patch
```

Both diffs were generated against the current `main` branch of `boolder-org/boolder-rails`
and verified with `git apply --check`.

## What's still missing for a real integration

- Boolder's own data source instead of a third-party repo (see above).
- A UI toggle for closures in the existing filter/map menu (currently always on).
- Localization of popup text (`boolder-rails` has no `js/i18n` equivalent; could use
  server-side `I18n.t` for zone names if they should be translated).
- Legal/practical alignment with the uMap data maintainers on whether reusing/redistributing
  the data is acceptable.
