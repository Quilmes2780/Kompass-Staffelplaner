// Stammdaten: Echtwelt aus data/*.json, Fiktiv-Generator und Validierung.
import clubsJson from "../data/clubs.json";
import derbiesJson from "../data/derbies.json";
import oberligenJson from "../data/oberligen.json";
import { rngFor } from "./rng";
import { haversineKm } from "./geo";
import type { Club, Derby, Oberliga, WorldData } from "./types";
import { GEBIETE, REGIONALVERBAENDE } from "./types";

export function loadRealWorld(): WorldData {
  // tiefe Kopie, damit Spielstände die importierten Module nie verändern
  const clubs = JSON.parse(JSON.stringify(clubsJson.clubs)) as Club[];
  const derbies = JSON.parse(JSON.stringify(derbiesJson.derbies)) as Derby[];
  const oberligen = JSON.parse(JSON.stringify(oberligenJson.oberligen)) as Oberliga[];
  return { clubs, derbies, oberligen, kind: "REAL" };
}

/** Prüft Stammdaten auf Konsistenz. Leere Liste = in Ordnung. */
export function validateWorld(w: WorldData): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  const olIds = new Set(w.oberligen.map((o) => o.id));
  for (const c of w.clubs) {
    if (ids.has(c.id)) errs.push(`Doppelte ID ${c.id}`);
    ids.add(c.id);
    if (!(c.lat > 47.2 && c.lat < 55.1 && c.lon > 5.8 && c.lon < 15.1)) errs.push(`${c.id}: Koordinaten außerhalb Deutschlands`);
    if (!olIds.has(c.oberligaId)) errs.push(`${c.id}: unbekannte Oberliga ${c.oberligaId}`);
    if (!GEBIETE.includes(c.gebiet)) errs.push(`${c.id}: unbekanntes Gebiet ${c.gebiet}`);
    if (!REGIONALVERBAENDE.includes(c.regionalverband)) errs.push(`${c.id}: unbekannter Regionalverband`);
    if (c.strength < 0 || c.strength > 100) errs.push(`${c.id}: Stärke außerhalb 0–100`);
    const s = c.stadium;
    if (!s || s.seats > s.capacity || s.capacity <= 0) errs.push(`${c.id}: Stadiondaten unplausibel`);
    if (c.isReserve !== !!c.parentId) errs.push(`${c.id}: isReserve/parentId inkonsistent`);
  }
  for (const c of w.clubs) if (c.parentId && !ids.has(c.parentId)) errs.push(`${c.id}: Mutterverein ${c.parentId} fehlt`);
  for (const o of w.oberligen) {
    const g = w.clubs.filter((c) => c.oberligaId === o.id);
    if (g.some((c) => c.gebiet !== o.gebiet && !c.league2026?.level.startsWith("PRO")))
      errs.push(`${o.id}: Vereine mit abweichendem Gebiet`);
  }
  const pairs = new Set<string>();
  for (const d of w.derbies) {
    if (!ids.has(d.a) || !ids.has(d.b)) errs.push(`Derby ${d.a}–${d.b}: Verein unbekannt`);
    if (d.a === d.b) errs.push(`Derby ${d.a}: gegen sich selbst`);
    if (![1, 2, 3].includes(d.weight)) errs.push(`Derby ${d.a}–${d.b}: Gewicht ungültig`);
    const k = [d.a, d.b].sort().join("|");
    if (pairs.has(k)) errs.push(`Derby ${k} doppelt`);
    pairs.add(k);
  }
  return errs;
}

// ---------------- Fiktive Welt ----------------

/** Neuer Verein aus dem Verbandsliga-Reservoir (wenn eine Oberliga aufgefüllt werden muss) */
export function generateReservoirClub(
  id: string,
  oberligaId: string,
  anchors: Club[],
  rng: import("./rng").Rng,
): Club {
  const anchor = anchors.length ? rng.pick(anchors) : undefined;
  const town = rng.pick(SYL_A) + rng.pick(SYL_B);
  const lat = (anchor?.lat ?? 51) + rng.normal(0, 0.12);
  const lon = (anchor?.lon ?? 10) + rng.normal(0, 0.16);
  const capacity = Math.round(1500 + rng.next() * 2500);
  return {
    id,
    name: `${rng.pick(PREFIX)} ${town}`,
    shortName: town,
    town,
    lat: Math.round(Math.min(54.9, Math.max(47.4, lat)) * 1000) / 1000,
    lon: Math.round(Math.min(14.9, Math.max(6.0, lon)) * 1000) / 1000,
    landesverband: anchor?.landesverband ?? "?",
    regionalverband: anchor?.regionalverband ?? "SW",
    gebiet: anchor?.gebiet ?? "SUEDWEST",
    oberligaId,
    isReserve: false,
    strength: Math.round(28 + rng.next() * 8),
    budget: Math.round((300_000 + rng.next() * 300_000) / 10000) * 10000,
    fanPotential: Math.round(150 + rng.next() * 350),
    stadium: { capacity, seats: Math.round(capacity * 0.05), lux: Math.round(80 + rng.next() * 150), pressSeats: rng.int(1, 3) },
    colors: [rng.pick(COLORS), rng.pick(COLORS)],
    verified: true,
    estimated: ["alle Werte generiert"],
    fictional: true,
  };
}

const PREFIX = ["SV", "FC", "TuS", "SpVgg", "VfB", "VfL", "1. FC", "SC", "TSV", "FSV", "SG", "Eintracht", "Germania", "Union", "Borussia", "Viktoria", "Preußen", "Fortuna", "Rot-Weiß", "Blau-Weiß"];
const SYL_A = ["Alt", "Berg", "Bruch", "Eichen", "Elm", "Falken", "Felds", "Grün", "Hasel", "Hohen", "Kirch", "Linden", "Marien", "Neu", "Ober", "Ost", "Rosen", "Sand", "Stein", "Tann", "Unter", "Wald", "Weiden", "West", "Wiesen", "Wolfs", "Bären", "Klee", "Moor", "Heide", "Hirsch", "Kron"];
const SYL_B = ["hagen", "feld", "dorf", "burg", "stadt", "heim", "bach", "berg", "au", "brück", "hausen", "rode", "kirchen", "werder", "furt", "stedt", "ingen", "wald", "born", "see"];
const COLORS = ["#c8102e", "#0050a0", "#00843d", "#fcd116", "#000000", "#6a2c91", "#e35205", "#1d9fd8", "#7a1f2b", "#ffffff"];

/**
 * Erzeugt eine fiktive Welt mit derselben Struktur wie die Echtwelt (gleiche Ligagrößen, Oberligen,
 * Zweitvertretungs-Beziehungen), aber erfundenen Namen, verschobenen Orten und neuen Werten.
 */
export function generateFictionalWorld(seed: number): WorldData {
  const real = loadRealWorld();
  const rng = rngFor(seed, "fictional-world");
  const usedTowns = new Set<string>();
  const townFor = () => {
    for (;;) {
      const t = rng.pick(SYL_A) + rng.pick(SYL_B);
      if (!usedTowns.has(t)) {
        usedTowns.add(t);
        return t;
      }
    }
  };
  const idMap: Record<string, string> = {};
  real.clubs.forEach((c, i) => (idMap[c.id] = `f${i.toString(36)}`));
  const nonReserve = real.clubs.filter((c) => !c.isReserve);
  const byOldId: Record<string, Club> = {};
  for (const c of nonReserve) {
    const town = townFor();
    // Ort leicht verschieben (≈ ±20 km), Gebiet/Oberliga bleiben erhalten
    const lat = Math.min(54.9, Math.max(47.4, c.lat + rng.normal(0, 0.15)));
    const lon = Math.min(14.9, Math.max(6.0, c.lon + rng.normal(0, 0.2)));
    const prefix = rng.pick(PREFIX);
    const name = `${prefix} ${town}`;
    const k = 0.85 + 0.3 * rng.next();
    byOldId[c.id] = {
      ...c,
      id: idMap[c.id],
      name,
      shortName: town,
      town,
      lat: Math.round(lat * 1000) / 1000,
      lon: Math.round(lon * 1000) / 1000,
      strength: Math.max(20, Math.min(98, Math.round(c.strength + rng.normal(0, 3)))),
      budget: Math.round((c.budget * k) / 10000) * 10000,
      fanPotential: Math.round(c.fanPotential * k),
      stadium: {
        capacity: Math.round(c.stadium.capacity * k),
        seats: Math.round(c.stadium.seats * k),
        lux: Math.round(c.stadium.lux * (0.8 + 0.4 * rng.next())),
        pressSeats: Math.max(1, Math.round(c.stadium.pressSeats * k)),
      },
      colors: [rng.pick(COLORS), rng.pick(COLORS)],
      verified: true,
      estimated: [],
      fictional: true,
    };
  }
  const clubs: Club[] = real.clubs.map((c) => {
    if (!c.isReserve) return byOldId[c.id];
    const parent = byOldId[c.parentId!];
    return {
      ...c,
      id: idMap[c.id],
      parentId: parent.id,
      name: `${parent.name} II`,
      shortName: `${parent.shortName} II`,
      town: parent.town,
      lat: parent.lat,
      lon: parent.lon,
      colors: parent.colors,
      verified: true,
      estimated: [],
      fictional: true,
    };
  });
  // Derbys: alle Nicht-Reserve-Paare unter 35 km (mit Wahrscheinlichkeit), Gewicht nach Nähe
  const derbies: Derby[] = [];
  const cand = clubs.filter((c) => !c.isReserve);
  for (let i = 0; i < cand.length; i++) {
    for (let j = i + 1; j < cand.length; j++) {
      const d = haversineKm(cand[i].lat, cand[i].lon, cand[j].lat, cand[j].lon);
      if (d < 35 && rng.chance(0.45)) {
        const weight = (d < 12 ? 3 : d < 24 ? 2 : 1) as 1 | 2 | 3;
        derbies.push({ a: cand[i].id, b: cand[j].id, weight, verified: true });
      }
    }
  }
  return { clubs, derbies, oberligen: real.oberligen, kind: "FICTIONAL" };
}
