import type { Club, ClubId } from "./types";

const R_EARTH_KM = 6371.0088;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Symmetrische Distanzmatrix (Straßen-km = Luftlinie × Straßenfaktor) über alle Vereine der Welt.
 * Wird nicht gespeichert, sondern bei Bedarf aus den Koordinaten berechnet und gecacht.
 */
export class DistanceMatrix {
  readonly ids: ClubId[];
  readonly index: Record<ClubId, number>;
  readonly n: number;
  readonly km: Float32Array;
  readonly roadFactor: number;

  constructor(clubs: Pick<Club, "id" | "lat" | "lon">[], roadFactor: number) {
    this.roadFactor = roadFactor;
    this.ids = clubs.map((c) => c.id);
    this.index = {};
    this.ids.forEach((id, i) => (this.index[id] = i));
    this.n = clubs.length;
    this.km = new Float32Array(this.n * this.n);
    for (let i = 0; i < this.n; i++) {
      for (let j = i + 1; j < this.n; j++) {
        const d = haversineKm(clubs[i].lat, clubs[i].lon, clubs[j].lat, clubs[j].lon) * roadFactor;
        this.km[i * this.n + j] = d;
        this.km[j * this.n + i] = d;
      }
    }
  }

  get(a: ClubId, b: ClubId): number {
    const i = this.index[a];
    const j = this.index[b];
    if (i === undefined || j === undefined) throw new Error(`Distanz unbekannt: ${a} ↔ ${b}`);
    return this.km[i * this.n + j];
  }

  idx(i: number, j: number): number {
    return this.km[i * this.n + j];
  }
}

const cache = new Map<string, DistanceMatrix>();

/**
 * Gecachte Matrix. Schlüssel sind IDs + Koordinaten + Straßenfaktor, damit auch geklonte
 * Spielstände (gleiche Vereine) dieselbe Matrix wiederverwenden.
 */
export function distanceMatrixFor(clubs: Record<ClubId, Club>, roadFactor: number): DistanceMatrix {
  const list = Object.values(clubs);
  let key = `${roadFactor}|`;
  for (const c of list) key += `${c.id}:${c.lat},${c.lon};`;
  let m = cache.get(key);
  if (!m) {
    m = new DistanceMatrix(list, roadFactor);
    if (cache.size > 6) cache.delete(cache.keys().next().value!);
    cache.set(key, m);
  }
  return m;
}
