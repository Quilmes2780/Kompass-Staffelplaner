// Deterministischer PRNG (mulberry32). Statt eines globalen, fortlaufenden Zustands wird für jede
// Zufallsentscheidung ein Stream aus Seed + Schlüsseln abgeleitet (z. B. Seed, Saison, "match", Spiel-Nr.).
// So beeinflusst z. B. ein zusätzliches Ereignis nie die Spielergebnisse und der Spielstand muss keinen
// RNG-Zustand speichern.

export interface Rng {
  /** gleichverteilt in [0, 1) */
  next(): number;
  int(minIncl: number, maxIncl: number): number;
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: T[]): T[];
  normal(mean?: number, sd?: number): number;
  poisson(lambda: number): number;
  chance(p: number): boolean;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a über die Schlüssel, gemischt mit dem Seed */
export function hashKeys(seed: number, keys: readonly (string | number)[]): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (const k of keys) {
    const s = String(k);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x9e3779b9;
    h = Math.imul(h, 16777619) >>> 0;
  }
  // Avalanche
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  let spare: number | null = null;
  const rng: Rng = {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    normal(mean = 0, sd = 1) {
      if (spare !== null) {
        const v = spare;
        spare = null;
        return mean + sd * v;
      }
      let u = 0;
      let v = 0;
      while (u === 0) u = next();
      v = next();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return mean + sd * r * Math.cos(2 * Math.PI * v);
    },
    poisson(lambda) {
      // Knuth – für die kleinen λ im Fußball ausreichend schnell
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= next();
      } while (p > L);
      return k - 1;
    },
    chance(p) {
      return next() < p;
    },
  };
  return rng;
}

/** Abgeleiteter Stream: rngFor(seed, 2029, "match", 17) */
export function rngFor(seed: number, ...keys: (string | number)[]): Rng {
  return createRng(hashKeys(seed, keys));
}
