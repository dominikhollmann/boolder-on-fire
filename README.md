# boolder-on-fire

Sperrungen im Wald von Fontainebleau, dargestellt auf einer [Boolder](https://www.boolder.com)-artigen
Boulder-Karte.

Fontainebleau hat in Teilen Zutrittsverbote (u. a. Waldbrand-bedingt). Diese Sperrungen werden
in einer Community-uMap-Karte gepflegt:
<https://umap.openstreetmap.fr/de/map/foret-de-fontainebleau-zones-interdites_1443097>

[Boolder](https://github.com/boolder-org/boolder-rails) ist die Referenz-Karte für Boulderproblems
in Fontainebleau, zeigt diese Sperrungen aber nicht an. Dieses Repo ist ein Prototyp, der sie
zusätzlich zu den Boolder-Boulderpunkten auf einer Karte anzeigt und die Daten automatisch
aktuell hält — als Vorlage für eine mögliche echte Erweiterung von Boolder (siehe
[`upstream-patch/`](upstream-patch/)). Vier Kategorien werden unterschieden (alle rot markiert):

- **Sperrzone** — allgemeine Zutrittsverbotsflächen (rote Flächen)
- **Kletterzone gesperrt** — gesperrte Boulder-/Kletterbereiche, z. B. einzelne Circuit-Nummern oder Sektoren
- **Parkplatz gesperrt**
- **Biwak gesperrt**

> ⚠️ **Kein offizieller Boolder-Dienst.** Dies ist ein unabhängiger Prototyp, nicht mit
> boolder.com verbunden. Die Sperrzonen-Daten stammen aus einer Community-uMap-Karte und
> können veraltet oder unvollständig sein. **Verlasst euch vor Ort immer auf die amtliche
> Beschilderung**, nicht auf diese Karte.

## Was ist hier drin

```
index.html                      # Standalone Mapbox-GL-Karte, kein Build-Step
js/map.js                       # Kartenaufbau: Boolder-Style + Boulderpunkte + closures-Layer (Flächen + Punkt-Marker, rot)
js/closures.js                  # Lädt data/fire-closures.geojson, pollt periodisch neu
data/fire-closures.geojson      # Zuletzt synchronisierter Datenstand (von der GitHub Action geschrieben)
scripts/sync-closures.mjs       # Node-Skript: holt aktuelle Sperrungen von uMap, schreibt data/fire-closures.geojson
.github/workflows/sync-closures.yml  # Cron-Job, der sync-closures.mjs regelmäßig laufen lässt
upstream-patch/                 # Fertiger Patch + Anleitung, um das Feature bei boolder-org vorzuschlagen
```

## Lokal starten

Kein Build-Step nötig — ein beliebiger statischer Webserver reicht:

```bash
npx serve .
# oder: python3 -m http.server 8000
```

Dann `index.html` im Browser öffnen. Beim ersten Laden fragt die Seite nach einem
**öffentlichen Mapbox-Access-Token** (wird nur lokal im Browser in `localStorage`
gespeichert, nie an einen eigenen Server geschickt). Ein kostenloses Token gibt es unter
<https://account.mapbox.com/access-tokens/>.

## Datenpipeline

`scripts/sync-closures.mjs` holt die aktuellen Sperrungen (Flächen **und** Punkt-Marker für
gesperrte Kletterzonen/Parkplätze/Biwaks) von der uMap-Karte, reduziert sie auf die für die
Anzeige nötigen Felder und schreibt `data/fire-closures.geojson`. Die
[GitHub Action](.github/workflows/sync-closures.yml) führt dieses Skript alle 6 Stunden
(und manuell per „Run workflow“) aus und committed Änderungen automatisch. Die statische
Seite lädt diese Datei beim Öffnen und danach alle 30 Minuten neu (`js/closures.js`), damit
auch offen gelassene Browser-Tabs aktuell bleiben.

Manuell ausführen (z. B. lokal testen):

```bash
node scripts/sync-closures.mjs
```

**Hinweis zur Datenquelle:** Die uMap-Karte ist eine reine Client-seitige SPA — im
HTML steht keine der Datalayer-URLs direkt drin. `sync-closures.mjs` nutzt daher die
echte, aus dem [uMap-Quellcode](https://github.com/umap-project/umap) verifizierte API:
`GET /{locale}/map/{mapId}/geojson/` liefert die Liste der Datalayer-IDs (UUIDs),
`GET /{locale}/datalayer/{mapId}/{uuid}/` liefert pro Layer das eigentliche GeoJSON.
Bricht der Sync trotzdem ab (z. B. weil uMap seine API ändert), steht die Fehlermeldung
im GitHub-Actions-Log; `DATALAYER_URL_OVERRIDES` in `scripts/sync-closures.mjs` ist der
Fallback, um bekannte Datalayer-URLs direkt einzutragen.

## Beitrag an Boolder anbieten

[`upstream-patch/`](upstream-patch/) enthält einen fertigen Diff, der das Sperrzonen-Layer
nach dem gleichen Muster wie die bestehenden `contribute`/`circuit7a`-Layer in
`boolder-rails` ergänzt. Boolder bittet im eigenen README darum, sich **vor** einem Pull
Request bei hello@boolder.com zu melden — siehe [`upstream-patch/README.md`](upstream-patch/README.md)
für Details.

## Lizenz

MIT, siehe [Boolder-Lizenz](https://github.com/boolder-org/boolder-rails/blob/main/LICENSE).
Der `mapbox://`-Style und das Boulder-Vector-Tileset werden von Boolder betrieben und hier
nur zu Demozwecken referenziert (öffentliche IDs aus dem Open-Source-Repo von boolder-rails).
