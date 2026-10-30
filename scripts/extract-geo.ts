// Extrahiert Deutschland + Nachbarländer aus world-atlas (Natural Earth, Public Domain)
// als kompaktes GeoJSON nach data/geo/de.json. Aufruf: npx tsx scripts/extract-geo.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";

const topo = JSON.parse(readFileSync("node_modules/world-atlas/countries-50m.json", "utf8")) as Topology;
const all = feature(topo, topo.objects.countries as GeometryCollection);
const keep: Record<string, string> = {
  "276": "Deutschland", "040": "Österreich", "056": "Belgien", "203": "Tschechien", "208": "Dänemark",
  "250": "Frankreich", "442": "Luxemburg", "528": "Niederlande", "616": "Polen", "756": "Schweiz",
};
const round = (x: unknown): unknown => (Array.isArray(x) ? x.map(round) : typeof x === "number" ? Math.round(x * 1000) / 1000 : x);
const features = all.features
  .filter((f) => keep[String(f.id)])
  .map((f) => ({
    type: "Feature",
    id: String(f.id),
    properties: { name: keep[String(f.id)], home: String(f.id) === "276" },
    geometry: { ...f.geometry, coordinates: round((f.geometry as { coordinates: unknown }).coordinates) },
  }));
mkdirSync("data/geo", { recursive: true });
writeFileSync("data/geo/de.json", JSON.stringify({ type: "FeatureCollection", source: "Natural Earth 1:50m via world-atlas", features }));
console.log(features.length, "Features geschrieben");
