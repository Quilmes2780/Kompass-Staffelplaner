// Staffeleinteilung: kapazitätsbeschränktes Clustering + lokale Suche (Swap/Relocate).
// Zielfunktion in km-Äquivalenten: Summe der paarweisen Distanzen innerhalb der Staffeln
// + Strafterme (getrennte Derbys, Zweitvertretungs-Grenze, Staffelwechsel, Leistungsbalance).
import type { RulesConfig } from "../../config/rules";
import type { DistanceMatrix } from "../geo";
import { rngFor, type Rng } from "../rng";
import type { Allocation, Club, ClubId, Derby } from "../types";

export interface OptimizeInput {
  clubs: ClubId[];
  clubData: Record<ClubId, Club>;
  derbies: Derby[];
  dm: DistanceMatrix;
  rules: RulesConfig;
  seed: number;
  /** fixierte Vereine: ClubId → Staffel */
  fixed?: Record<ClubId, string>;
  /** Vereine, die gemeinsam in eine Staffel sollen (gewährte Härtefälle), mit Strafgewicht */
  together?: { a: ClubId; b: ClubId; weight: number }[];
  previous?: Allocation;
  mode?: "CLUSTER" | "COMPASS";
  compassStart?: "N" | "O" | "S" | "W";
}

interface Ctx {
  n: number;
  G: number;
  size: number;
  ids: ClubId[];
  D: Float64Array; // n×n lokale Distanzmatrix (einfach, Straßen-km)
  W: Float64Array; // n×n Paargewichte (Derby/Härtefall, km-Äquivalent bei Trennung)
  reserve: Uint8Array;
  strength: Float64Array;
  prevGroup: Int32Array; // −1 = kein Vorjahr
  fixed: Int32Array; // −1 = frei
  maxReserves: number;
  wReserve: number;
  wChange: number;
  wBalance: number;
}

function buildCtx(inp: OptimizeInput): Ctx {
  const r = inp.rules;
  const ids = [...inp.clubs].sort();
  const n = ids.length;
  const G = r.rl.groupIds.length;
  const local: Record<ClubId, number> = {};
  ids.forEach((id, i) => (local[id] = i));
  const D = new Float64Array(n * n);
  const gi = ids.map((id) => inp.dm.index[id]);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) D[i * n + j] = inp.dm.idx(gi[i], gi[j]);
  const W = new Float64Array(n * n);
  const addW = (a: ClubId, b: ClubId, w: number) => {
    const i = local[a];
    const j = local[b];
    if (i === undefined || j === undefined) return;
    W[i * n + j] += w;
    W[j * n + i] += w;
  };
  for (const d of inp.derbies) addW(d.a, d.b, d.weight * r.allocation.weights.derbySplitPerWeight);
  for (const t of inp.together ?? []) addW(t.a, t.b, t.weight);
  const reserve = new Uint8Array(n);
  const strength = new Float64Array(n);
  const prevGroup = new Int32Array(n).fill(-1);
  const fixed = new Int32Array(n).fill(-1);
  ids.forEach((id, i) => {
    reserve[i] = inp.clubData[id].isReserve ? 1 : 0;
    strength[i] = inp.clubData[id].strength;
  });
  if (inp.previous)
    for (const [g, list] of Object.entries(inp.previous.groups)) {
      const gIdx = r.rl.groupIds.indexOf(g);
      for (const id of list) if (local[id] !== undefined && gIdx >= 0) prevGroup[local[id]] = gIdx;
    }
  for (const [id, g] of Object.entries(inp.fixed ?? {})) {
    const gIdx = r.rl.groupIds.indexOf(g);
    if (local[id] !== undefined && gIdx >= 0) fixed[local[id]] = gIdx;
  }
  return {
    n,
    G,
    size: r.rl.groupSize,
    ids,
    D,
    W,
    reserve,
    strength,
    prevGroup,
    fixed,
    maxReserves: r.rl.maxReservesPerGroup,
    wReserve: r.allocation.weights.reserveOverLimit,
    wChange: r.allocation.weights.groupChange,
    wBalance: r.allocation.weights.strengthImbalance,
  };
}

/** Kosten einer Zuordnung (assign[i] = Staffelindex) */
function totalCost(c: Ctx, assign: Int32Array): number {
  let km = 0;
  let split = 0;
  for (let i = 0; i < c.n; i++)
    for (let j = i + 1; j < c.n; j++) {
      if (assign[i] === assign[j]) km += c.D[i * c.n + j];
      else split += c.W[i * c.n + j];
    }
  return km + split + groupPenalties(c, assign);
}

function groupPenalties(c: Ctx, assign: Int32Array): number {
  const res = new Array(c.G).fill(0);
  const str = new Array(c.G).fill(0);
  const cnt = new Array(c.G).fill(0);
  let changes = 0;
  for (let i = 0; i < c.n; i++) {
    res[assign[i]] += c.reserve[i];
    str[assign[i]] += c.strength[i];
    cnt[assign[i]]++;
    if (c.prevGroup[i] >= 0 && c.prevGroup[i] !== assign[i]) changes++;
  }
  let p = 0;
  for (let g = 0; g < c.G; g++) p += Math.max(0, res[g] - c.maxReserves) * c.wReserve;
  p += changes * c.wChange;
  if (c.wBalance > 0) {
    const means = str.map((s, g) => s / Math.max(1, cnt[g]));
    const m = means.reduce((a, b) => a + b, 0) / c.G;
    p += c.wBalance * Math.sqrt(means.reduce((a, x) => a + (x - m) ** 2, 0) / c.G);
  }
  return p;
}

/** Kapazitätsbeschränkte Startlösung: k-Means-artige Zentren (k-means++), gierige Zuordnung nach Regret */
function initialCluster(c: Ctx, rng: Rng): Int32Array {
  const assign = new Int32Array(c.n).fill(-1);
  const count = new Array(c.G).fill(0);
  // fixierte zuerst
  for (let i = 0; i < c.n; i++)
    if (c.fixed[i] >= 0) {
      assign[i] = c.fixed[i];
      count[c.fixed[i]]++;
    }
  // Zentren per k-means++ über die Distanzen
  const centers: number[] = [rng.int(0, c.n - 1)];
  while (centers.length < c.G) {
    const d2 = new Float64Array(c.n);
    let sum = 0;
    for (let i = 0; i < c.n; i++) {
      let m = Infinity;
      for (const k of centers) m = Math.min(m, c.D[i * c.n + k]);
      d2[i] = m * m;
      sum += d2[i];
    }
    let t = rng.next() * sum;
    let pick = 0;
    for (let i = 0; i < c.n; i++) {
      t -= d2[i];
      if (t <= 0) {
        pick = i;
        break;
      }
    }
    centers.push(pick);
  }
  // Medoid-Iterationen mit Kapazität
  for (let it = 0; it < 6; it++) {
    const a = new Int32Array(c.n).fill(-1);
    const cnt = new Array(c.G).fill(0);
    for (let i = 0; i < c.n; i++)
      if (c.fixed[i] >= 0) {
        a[i] = c.fixed[i];
        cnt[c.fixed[i]]++;
      }
    const free = [];
    for (let i = 0; i < c.n; i++) if (a[i] < 0) free.push(i);
    // Regret: Differenz zwischen bestem und zweitbestem Zentrum → schwierige Fälle zuerst
    const pref = free.map((i) => {
      const ds = centers.map((k, g) => ({ g, d: c.D[i * c.n + k] })).sort((x, y) => x.d - y.d);
      return { i, ds, regret: (ds[1]?.d ?? 0) - ds[0].d };
    });
    pref.sort((x, y) => y.regret - x.regret);
    for (const p of pref) {
      const choice = p.ds.find((x) => cnt[x.g] < c.size)!;
      a[p.i] = choice.g;
      cnt[choice.g]++;
    }
    // neue Medoide
    for (let g = 0; g < c.G; g++) {
      let best = centers[g];
      let bestSum = Infinity;
      for (let i = 0; i < c.n; i++) {
        if (a[i] !== g) continue;
        let s = 0;
        for (let j = 0; j < c.n; j++) if (a[j] === g) s += c.D[i * c.n + j];
        if (s < bestSum) {
          bestSum = s;
          best = i;
        }
      }
      centers[g] = best;
    }
    assign.set(a);
  }
  return assign;
}

/** Kompass-Rotation: Sektoren nach Polarwinkel um den Schwerpunkt, beginnend beim Startwinkel */
function initialCompass(c: Ctx, clubData: Record<ClubId, Club>, start: "N" | "O" | "S" | "W"): Int32Array {
  const lat0 = c.ids.reduce((a, id) => a + clubData[id].lat, 0) / c.n;
  const lon0 = c.ids.reduce((a, id) => a + clubData[id].lon, 0) / c.n;
  const startAngle = { N: 0, O: 90, S: 180, W: 270 }[start];
  const ang = c.ids.map((id, i) => {
    const dy = clubData[id].lat - lat0;
    const dx = (clubData[id].lon - lon0) * Math.cos((lat0 * Math.PI) / 180);
    // Kompasswinkel: 0 = Nord, im Uhrzeigersinn
    const a = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    return { i, a: (a - startAngle + 360 + 360 / c.G / 2) % 360 };
  });
  ang.sort((x, y) => x.a - y.a);
  const assign = new Int32Array(c.n);
  const cnt = new Array(c.G).fill(0);
  for (let i = 0; i < c.n; i++) if (c.fixed[i] >= 0) cnt[c.fixed[i]]++;
  let g = 0;
  for (const { i } of ang) {
    if (c.fixed[i] >= 0) {
      assign[i] = c.fixed[i];
      continue;
    }
    while (cnt[g] >= c.size) g++;
    assign[i] = g;
    cnt[g]++;
  }
  return assign;
}

/** Lokale Suche: paarweise Tausche zwischen Staffeln (erhält 4×20 exakt), first-improvement */
function localSearch(c: Ctx, assign: Int32Array, passes: number): number {
  const n = c.n;
  // sumTo[i*G+g] = Σ_j∈g D[i,j]; wTo analog für Paargewichte
  const sumTo = new Float64Array(n * c.G);
  const wTo = new Float64Array(n * c.G);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      sumTo[i * c.G + assign[j]] += c.D[i * n + j];
      wTo[i * c.G + assign[j]] += c.W[i * n + j];
    }
  let cost = totalCost(c, assign);
  const resCnt = new Array(c.G).fill(0);
  for (let i = 0; i < n; i++) resCnt[assign[i]] += c.reserve[i];
  const needGroupPen = c.wChange > 0 || c.wBalance > 0;
  for (let pass = 0; pass < passes; pass++) {
    let improved = false;
    for (let i = 0; i < n; i++) {
      if (c.fixed[i] >= 0) continue;
      for (let j = i + 1; j < n; j++) {
        const gi = assign[i];
        const gj = assign[j];
        if (gi === gj || c.fixed[j] >= 0) continue;
        // Δ km: i verlässt gi → gj, j verlässt gj → gi
        const dij = c.D[i * n + j];
        const wij = c.W[i * n + j];
        const dKm =
          sumTo[i * c.G + gj] - dij - sumTo[i * c.G + gi] + (sumTo[j * c.G + gi] - dij - sumTo[j * c.G + gj]);
        // Δ Trennungsstrafe: Gewichte zu ehemaligen Staffelkameraden kommen hinzu, zu neuen fallen weg
        const dW =
          wTo[i * c.G + gi] - (wTo[i * c.G + gj] - wij) + (wTo[j * c.G + gj] - (wTo[j * c.G + gi] - wij));
        let dRes = 0;
        if (c.reserve[i] !== c.reserve[j]) {
          const before = Math.max(0, resCnt[gi] - c.maxReserves) + Math.max(0, resCnt[gj] - c.maxReserves);
          const ri = resCnt[gi] - c.reserve[i] + c.reserve[j];
          const rj = resCnt[gj] - c.reserve[j] + c.reserve[i];
          const after = Math.max(0, ri - c.maxReserves) + Math.max(0, rj - c.maxReserves);
          dRes = (after - before) * c.wReserve;
        }
        let delta = dKm + dW + dRes;
        if (needGroupPen) {
          const before = groupPenalties(c, assign) - resPen(c, resCnt);
          assign[i] = gj;
          assign[j] = gi;
          const after = groupPenalties(c, assign) - resPenAfterSwap(c, resCnt, gi, gj, i, j);
          assign[i] = gi;
          assign[j] = gj;
          delta += after - before;
        }
        if (delta < -1e-6) {
          // anwenden
          assign[i] = gj;
          assign[j] = gi;
          resCnt[gi] += c.reserve[j] - c.reserve[i];
          resCnt[gj] += c.reserve[i] - c.reserve[j];
          for (let k = 0; k < n; k++) {
            if (k !== i) {
              sumTo[k * c.G + gi] -= c.D[k * n + i];
              sumTo[k * c.G + gj] += c.D[k * n + i];
              wTo[k * c.G + gi] -= c.W[k * n + i];
              wTo[k * c.G + gj] += c.W[k * n + i];
            }
            if (k !== j) {
              sumTo[k * c.G + gj] -= c.D[k * n + j];
              sumTo[k * c.G + gi] += c.D[k * n + j];
              wTo[k * c.G + gj] -= c.W[k * n + j];
              wTo[k * c.G + gi] += c.W[k * n + j];
            }
          }
          cost += delta;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return totalCost(c, assign);
}

function resPen(c: Ctx, resCnt: number[]): number {
  let p = 0;
  for (let g = 0; g < c.G; g++) p += Math.max(0, resCnt[g] - c.maxReserves) * c.wReserve;
  return p;
}

function resPenAfterSwap(c: Ctx, resCnt: number[], gi: number, gj: number, i: number, j: number): number {
  const r = [...resCnt];
  r[gi] += c.reserve[j] - c.reserve[i];
  r[gj] += c.reserve[i] - c.reserve[j];
  return resPen(c, r);
}

/** Hauptfunktion: liefert eine gültige 4×20-Einteilung (bzw. G×size nach Regelwerk) */
export function optimizeAllocation(inp: OptimizeInput): Allocation {
  const c = buildCtx(inp);
  if (c.n !== c.G * c.size) throw new Error(`Einteilung benötigt ${c.G * c.size} Teams, erhalten: ${c.n}`);
  const fixedCount = new Array(c.G).fill(0);
  for (let i = 0; i < c.n; i++) if (c.fixed[i] >= 0) fixedCount[c.fixed[i]]++;
  if (fixedCount.some((x) => x > c.size)) throw new Error("Zu viele fixierte Vereine in einer Staffel");
  const mode = inp.mode ?? inp.rules.allocation.mode;
  let best: Int32Array | null = null;
  let bestCost = Infinity;
  const restarts = mode === "COMPASS" ? 1 : inp.rules.allocation.restarts;
  for (let r = 0; r < restarts; r++) {
    const rng = rngFor(inp.seed, "alloc", r);
    const assign = mode === "COMPASS" ? initialCompass(c, inp.clubData, inp.compassStart ?? inp.rules.allocation.compassStart) : initialCluster(c, rng);
    const cost = localSearch(c, assign, inp.rules.allocation.localSearchPasses);
    if (cost < bestCost - 1e-6) {
      bestCost = cost;
      best = assign.slice();
    }
  }
  const groups = toGroups(c, best!, inp.rules.rl.groupIds);
  return { groups: relabelGroups(groups, inp), fixed: Object.keys(inp.fixed ?? {}) };
}

function toGroups(c: Ctx, assign: Int32Array, groupIds: string[]): Record<string, ClubId[]> {
  const groups: Record<string, ClubId[]> = {};
  for (const g of groupIds) groups[g] = [];
  for (let i = 0; i < c.n; i++) groups[groupIds[assign[i]]].push(c.ids[i]);
  for (const g of groupIds) groups[g].sort();
  return groups;
}

/**
 * Staffelbezeichnungen stabil halten: Ohne Fixierungen wird so umbenannt, dass möglichst viele
 * Vereine ihre Vorjahresstaffel behalten, sonst geografisch (A = nördlichste … ).
 */
function relabelGroups(groups: Record<string, ClubId[]>, inp: OptimizeInput): Record<string, ClubId[]> {
  if (inp.fixed && Object.keys(inp.fixed).length) return groups;
  const ids = inp.rules.rl.groupIds;
  const lists = ids.map((g) => groups[g]);
  const perms = permutations(ids.map((_, i) => i));
  let best = perms[0];
  let bestScore = -Infinity;
  for (const p of perms) {
    let s = 0;
    p.forEach((src, dst) => {
      const label = ids[dst];
      if (inp.previous?.groups[label]) {
        const prev = new Set(inp.previous.groups[label]);
        for (const id of lists[src]) if (prev.has(id)) s += 1000;
      }
      // Tiebreak: geografische Ordnung nach Breitengrad (A nördlich)
      const lat = lists[src].reduce((a, id) => a + inp.clubData[id].lat, 0) / lists[src].length;
      s += lat * (ids.length - dst) * 0.01;
    });
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  const out: Record<string, ClubId[]> = {};
  best.forEach((src, dst) => (out[ids[dst]] = lists[src]));
  return out;
}

function permutations(a: number[]): number[][] {
  if (a.length <= 1) return [a];
  const out: number[][] = [];
  a.forEach((x, i) => {
    for (const p of permutations([...a.slice(0, i), ...a.slice(i + 1)])) out.push([x, ...p]);
  });
  return out;
}

/** Zufällige gültige Einteilung (Vergleichsbasis für Tests) */
export function randomAllocation(clubs: ClubId[], rules: RulesConfig, rng: Rng): Allocation {
  const ids = rng.shuffle([...clubs]);
  const groups: Record<string, ClubId[]> = {};
  rules.rl.groupIds.forEach((g, i) => (groups[g] = ids.slice(i * rules.rl.groupSize, (i + 1) * rules.rl.groupSize)));
  return { groups, fixed: [] };
}
