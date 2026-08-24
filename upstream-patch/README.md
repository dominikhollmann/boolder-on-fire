# Patch für boolder-rails

Dieser Ordner enthält einen fertigen, getesteten Diff, der das Sperrungen-Layer (Zonen
**und** Punkt-Marker für gesperrte Kletterzonen/Parkplätze/Biwaks) direkt in die echte
[`boolder-rails`](https://github.com/boolder-org/boolder-rails)-App einbaut — als
Vorschlag, falls die Boolder-Maintainer das Feature offiziell übernehmen wollen.

## Vor einem Pull Request: bitte erst anfragen

Das `boolder-rails`-README bittet ausdrücklich darum, sich **vor** einem Pull Request bei
den Maintainern zu melden (`hello@boolder.com`). Bitte diesen Schritt nicht überspringen —
am besten mit einem Link auf [`../README.md`](../README.md) (den laufenden Prototyp) und
diesen Diff als Diskussionsgrundlage.

## Was der Patch macht

Er folgt exakt dem Muster, das `mapbox_controller.js` bereits für die optionalen
`contribute`- und `circuit7a`-Overlays benutzt: ein per Stimulus-`Value`-Flag
ein-/ausschaltbarer GeoJSON-Layer, eingefügt unterhalb des bestehenden `areas`-Layers.

- **`mapbox_controller.patch`** — `app/javascript/controllers/mapbox_controller.js`:
  - neue Values `closures` (Boolean) und `closuresSource` (String)
  - neuer `fire-closures`-Source + drei Layer (`fire-closures-fill`, `fire-closures-outline`
    für Flächen; `fire-closures-points` für Punkt-Marker, gefiltert auf `Point`-Geometrien) in `addLayers()`
  - Klick-Popup (Name, Kategorie-Label, Beschreibung) in `setupClickEvents()`, für Flächen
    und Punkte gleichermaßen
- **`map_index.patch`** — `app/views/map/index.html.erb`:
  - setzt `data-mapbox-closures-value="true"` und `data-mapbox-closures-source-value` auf die
    GeoJSON-Datei aus diesem Repo (`dominikhollmann/boolder-on-fire`, per GitHub Action alle
    6h aktuell gehalten — siehe [`../scripts/sync-closures.mjs`](../scripts/sync-closures.mjs)).
    **Nur als Startpunkt gedacht** — bei echter Integration sollte Boolder die Daten selbst
    hosten/proxyen (eigene Route + eigener Sync-Job), damit die Kernfunktion nicht von einem
    externen Drittanbieter-Repo abhängt.

## Anwenden

```bash
cd boolder-rails
git apply /pfad/zu/boolder-on-fire/upstream-patch/mapbox_controller.patch
git apply /pfad/zu/boolder-on-fire/upstream-patch/map_index.patch
```

Beide Diffs wurden gegen den aktuellen `main`-Branch von `boolder-org/boolder-rails`
erstellt und mit `git apply --check` verifiziert.

## Was für eine echte Integration noch fehlt

- Eigene Datenquelle statt Fremd-Repo (siehe oben).
- Ein UI-Toggle für die Sperrzonen im bestehenden Filter-/Kartenmenü (aktuell immer an).
- Lokalisierung der Popup-Texte (`js/i18n`-Äquivalent gibt es in `boolder-rails` nicht,
  ggf. `I18n.t` serverseitig für Zonennamen verwenden, falls diese übersetzt werden sollen).
- Rechtliche/fachliche Abstimmung mit den Datenpflegern der uMap-Karte, ob eine
  Weiterverwendung/Weiterverteilung der Daten in Ordnung ist.
