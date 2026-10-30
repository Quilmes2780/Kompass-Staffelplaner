// Hilfsfunktionen rund um Ligazugehörigkeit.
import type { ClubId, GameState, LeagueRef, Leagues, Level } from "./types";
import { LEVEL_ORDER } from "./types";

export function emptyLeagues(): Leagues {
  return { BL: [], BL2: [], L3: [], RL: {}, OL: {}, VL: {} };
}

export function cloneLeagues(l: Leagues): Leagues {
  const rec = (r: Record<string, ClubId[]>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, [...v]]));
  return { BL: [...l.BL], BL2: [...l.BL2], L3: [...l.L3], RL: rec(l.RL), OL: rec(l.OL), VL: rec(l.VL) };
}

/** Index ClubId → LeagueRef */
export function leagueIndex(l: Leagues): Record<ClubId, LeagueRef> {
  const idx: Record<ClubId, LeagueRef> = {};
  for (const id of l.BL) idx[id] = { level: "BL", group: "BL" };
  for (const id of l.BL2) idx[id] = { level: "BL2", group: "BL2" };
  for (const id of l.L3) idx[id] = { level: "L3", group: "L3" };
  for (const [g, ids] of Object.entries(l.RL)) for (const id of ids) idx[id] = { level: "RL", group: g };
  for (const [g, ids] of Object.entries(l.OL)) for (const id of ids) idx[id] = { level: "OL", group: g };
  for (const [g, ids] of Object.entries(l.VL)) for (const id of ids) idx[id] = { level: "VL", group: g };
  return idx;
}

export function levelRank(level: Level): number {
  return LEVEL_ORDER.indexOf(level);
}

export function rlClubs(l: Leagues): ClubId[] {
  return Object.values(l.RL).flat();
}

export function allLeagueClubs(l: Leagues): ClubId[] {
  return [...l.BL, ...l.BL2, ...l.L3, ...rlClubs(l), ...Object.values(l.OL).flat(), ...Object.values(l.VL).flat()];
}

export function leagueLabel(ref: LeagueRef, state?: Pick<GameState, "oberligen">): string {
  switch (ref.level) {
    case "BL":
      return "Bundesliga";
    case "BL2":
      return "2. Bundesliga";
    case "L3":
      return "3. Liga";
    case "RL":
      return ref.group === "POOL" ? "Regionalliga (offen)" : `Regionalliga ${ref.group}`;
    case "OL": {
      const o = state?.oberligen.find((x) => x.id === ref.group);
      return o ? o.name : ref.group;
    }
    case "VL": {
      const o = state?.oberligen.find((x) => x.id === ref.group);
      return `Verbandsliga (${o?.short ?? ref.group})`;
    }
  }
}

/** Prüft Ligagrößen; liefert Fehlermeldungen (leer = ok) */
export function checkLeagueInvariants(state: GameState): string[] {
  const r = state.rules;
  const l = state.leagues;
  const errs: string[] = [];
  if (l.BL.length !== r.pro.blSize) errs.push(`BL hat ${l.BL.length}`);
  if (l.BL2.length !== r.pro.bl2Size) errs.push(`BL2 hat ${l.BL2.length}`);
  if (l.L3.length !== r.l3.size) errs.push(`3. Liga hat ${l.L3.length}`);
  const rl = rlClubs(l).length;
  const target = r.rl.groupIds.length * r.rl.groupSize;
  if (rl !== target) errs.push(`Regionalliga hat ${rl} statt ${target}`);
  for (const o of state.oberligen) {
    const n = l.OL[o.id]?.length ?? 0;
    if (n < r.oberliga.poolSize || n > r.oberliga.poolSize + r.oberliga.maxTemporaryExtra)
      errs.push(`${o.id} hat ${n} Teams`);
  }
  const all = allLeagueClubs(l);
  if (new Set(all).size !== all.length) errs.push("Verein in mehreren Ligen");
  for (const id of all) if (!state.clubs[id]) errs.push(`Unbekannter Verein ${id}`);
  // Zweitvertretungen unterhalb des Muttervereins
  const idx = leagueIndex(l);
  for (const id of all) {
    const c = state.clubs[id];
    if (c.parentId && idx[c.parentId] && idx[id].level !== "VL" && levelRank(idx[id].level) <= levelRank(idx[c.parentId].level))
      errs.push(`${id} spielt nicht unterhalb von ${c.parentId}`);
    if (c.isReserve && levelRank(idx[id].level) < levelRank("L3")) errs.push(`${id}: Zweitvertretung oberhalb der 3. Liga`);
  }
  return errs;
}
