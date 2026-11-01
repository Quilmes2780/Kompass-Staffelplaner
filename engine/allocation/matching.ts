// Staffelkontinuität: Welche neue Staffel ist die Nachfolgerin welcher Vorjahresstaffel?
// Maßgeblich ist die Überschneidung der Vereine, nicht die Bezeichnung.
import type { ClubId } from "../types";

type Groups = Record<string, ClubId[]>;

/** Alle Permutationen von 0..n−1 (n = Staffelanzahl, klein) */
export function permutations(a: number[]): number[][] {
  if (a.length <= 1) return [a];
  const out: number[][] = [];
  a.forEach((x, i) => {
    for (const p of permutations([...a.slice(0, i), ...a.slice(i + 1)])) out.push([x, ...p]);
  });
  return out;
}

/**
 * Ordnet jeder neuen Staffel die Vorjahresstaffel zu, mit der sie die meisten Vereine teilt
 * (beste Eins-zu-eins-Zuordnung über alle Staffeln). Neue Staffeln ohne Gegenstück → undefined.
 */
export function matchGroups(prev: Groups, next: Groups): Record<string, string | undefined> {
  const nextIds = Object.keys(next);
  const prevIds = Object.keys(prev);
  const slots = Math.max(nextIds.length, prevIds.length);
  const prevSets = prevIds.map((g) => new Set(prev[g]));
  const overlap = (ni: number, pi: number) => (pi < prevIds.length && ni < nextIds.length ? next[nextIds[ni]].filter((id) => prevSets[pi].has(id)).length : 0);
  let best: number[] = [];
  let bestScore = -1;
  for (const p of permutations([...Array(slots).keys()])) {
    let s = 0;
    for (let ni = 0; ni < nextIds.length; ni++) s += overlap(ni, p[ni]);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  const out: Record<string, string | undefined> = {};
  nextIds.forEach((g, ni) => (out[g] = prevIds[best[ni]]));
  return out;
}

/**
 * Staffelwechsler: Vereine, die schon im Vorjahr in der Regionalliga spielten und jetzt in einer
 * Staffel stehen, die nicht die Nachfolgerin ihrer Vorjahresstaffel ist. Die Bezeichnung spielt keine Rolle.
 */
export function groupChangers(prev: Groups, next: Groups): ClubId[] {
  const match = matchGroups(prev, next);
  const prevGroup: Record<ClubId, string> = {};
  for (const [g, list] of Object.entries(prev)) for (const id of list) prevGroup[id] = g;
  const out: ClubId[] = [];
  for (const [g, list] of Object.entries(next)) for (const id of list) if (prevGroup[id] && prevGroup[id] !== match[g]) out.push(id);
  return out;
}
