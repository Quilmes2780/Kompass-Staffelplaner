// Neues Spiel: Startaufstellung der ersten viergleisigen Saison aus den Stammdaten.
// Der Übergang (Qualifikationssaison 2027/28) wird vorausgesetzt und hier abstrakt nachgebildet:
// je Gebiet qualifizieren sich die besten Regionalliga-Teams nach Quote, dazu die Drittliga-Absteiger.
import { cloneRules, KOMPASS_RULES, type RulesConfig } from "../config/rules";
import { emptyLeagues, leagueIndex, levelRank } from "./leagues";
import { rngFor, type Rng } from "./rng";
import { generateFictionalWorld, generateReservoirClub, loadRealWorld } from "./world";
import type { Club, ClubId, GameState, Leagues, Settings } from "./types";
import { GEBIETE, STAKEHOLDERS } from "./types";

export const STATE_VERSION = 1;

export interface NewGameOptions {
  seed: number;
  world?: "REAL" | "FICTIONAL";
  rules?: RulesConfig;
  settings?: Partial<Settings>;
}

export function newGame(opts: NewGameOptions): GameState {
  const rules = cloneRules(opts.rules ?? KOMPASS_RULES);
  const world = opts.world === "FICTIONAL" ? generateFictionalWorld(opts.seed) : loadRealWorld();
  const clubs: Record<ClubId, Club> = {};
  for (const c of world.clubs) clubs[c.id] = c;
  const rng = rngFor(opts.seed, "setup");
  const state: GameState = {
    version: STATE_VERSION,
    seed: opts.seed,
    worldKind: world.kind,
    rules,
    settings: { difficulty: "NORMAL", simSpeed: "SPIELTAG", tutorialDone: false, ...opts.settings },
    clubs,
    derbies: world.derbies,
    oberligen: world.oberligen,
    season: rules.startSeason,
    phase: rules.prolog.enabled ? "PROLOG" : "ALLOCATION",
    leagues: emptyLeagues(),
    competitions: {},
    pendingEvents: [],
    satisfaction: {},
    finance: { marketingPot: rules.finance.marketingBase, tvContractUntil: rules.startSeason + 2, dfbReserve: 2_000_000 },
    news: [],
    courtCases: [],
    precedents: [],
    history: { clubSeasons: [], seasons: [], evaluations: [] },
    seasonStats: {},
    licenseThisSeason: {},
    hardshipThisSeason: {},
    achievements: [],
    score: 0,
    counters: { courtFreeSeasons: 0, nextId: 1 },
  };
  state.leagues = buildStartLeagues(state, rng);
  for (const k of STAKEHOLDERS) state.satisfaction[k] = 62;
  for (const id of Object.keys(state.clubs)) state.satisfaction[id] = 60;
  return state;
}

const score = (c: Club, rng: Rng) => c.strength + rng.normal(0, 2.5);

function buildStartLeagues(state: GameState, rng: Rng): Leagues {
  const r = state.rules;
  const l = emptyLeagues();
  const all = Object.values(state.clubs);
  const by = (lvl: string, group?: string) =>
    all.filter((c) => c.league2026 && (c.league2026.level === lvl || c.league2026.group === lvl) && (!group || c.league2026.group === group));
  l.BL = by("BL").map((c) => c.id);
  l.BL2 = by("BL2").map((c) => c.id);

  const l3 = by("L3");
  const rlAll = all.filter((c) => c.league2026?.level === "RL");
  // Drittliga-Absteiger (schwächste, keine Zweitvertretung bevorzugt egal) und RL-Aufsteiger
  const l3Sorted = [...l3].sort((a, b) => score(a, rng) - score(b, rng));
  const down = l3Sorted.slice(0, r.startFromL3);
  const parentLevel = (c: Club) => (c.parentId ? state.clubs[c.parentId].league2026?.level : undefined);
  const upCandidates = [...rlAll]
    .filter((c) => !c.isReserve || (parentLevel(c) !== "L3" && parentLevel(c) !== "RL"))
    .sort((a, b) => score(b, rng) - score(a, rng));
  const up = upCandidates.slice(0, r.startFromL3);
  const upIds = new Set(up.map((c) => c.id));
  const downIds = new Set(down.map((c) => c.id));
  l.L3 = [...l3.filter((c) => !downIds.has(c.id)), ...up].map((c) => c.id);

  const rlPool: ClubId[] = down.map((c) => c.id);
  const toOl: Club[] = [];
  for (const g of GEBIETE) {
    const cand = rlAll.filter((c) => c.gebiet === g && !upIds.has(c.id)).sort((a, b) => score(b, rng) - score(a, rng));
    const quota = r.startQuotas[g];
    const chosen = cand.slice(0, quota);
    toOl.push(...cand.slice(quota));
    if (chosen.length < quota) {
      const olCand = all
        .filter((c) => c.league2026?.level === "OL" && c.gebiet === g)
        .sort((a, b) => score(b, rng) - score(a, rng));
      chosen.push(...olCand.slice(0, quota - chosen.length));
    }
    rlPool.push(...chosen.map((c) => c.id));
  }
  l.RL = { POOL: rlPool };
  const inRl = new Set(rlPool);
  for (const o of state.oberligen) l.OL[o.id] = [];
  for (const c of all) if (c.league2026?.level === "OL" && !inRl.has(c.id)) l.OL[c.oberligaId].push(c.id);
  for (const c of toOl) l.OL[c.oberligaId].push(c.id);
  for (const o of state.oberligen) l.VL[o.id] = [];
  balanceOberligen(state, l, rng);
  return l;
}

/**
 * Oberliga-Pools auf Sollgröße bringen: Überhang über die temporäre Aufstockung hinaus wandert ins
 * Verbandsliga-Reservoir, Fehlbestände werden aus dem Reservoir (bzw. neu generierten Vereinen) aufgefüllt.
 * Liefert die Oberligen, die temporär aufgestockt sind.
 */
export function balanceOberligen(state: GameState, l: Leagues, rng: Rng): string[] {
  const r = state.rules.oberliga;
  const enlarged: string[] = [];
  for (const o of state.oberligen) {
    const pool = l.OL[o.id] ?? (l.OL[o.id] = []);
    const vl = l.VL[o.id] ?? (l.VL[o.id] = []);
    pool.sort((a, b) => state.clubs[b].strength - state.clubs[a].strength);
    while (pool.length > r.poolSize + r.maxTemporaryExtra) vl.push(pool.pop()!);
    if (pool.length > r.poolSize) enlarged.push(o.id);
    vl.sort((a, b) => state.clubs[b].strength - state.clubs[a].strength);
    while (pool.length < r.poolSize) {
      if (vl.length) pool.push(vl.shift()!);
      else pool.push(newReservoirClub(state, o.id, rng).id);
    }
    while (vl.length < r.reservoirSize) vl.push(newReservoirClub(state, o.id, rng).id);
  }
  return enlarged;
}

function newReservoirClub(state: GameState, oberligaId: string, rng: Rng): Club {
  const anchors = Object.values(state.clubs).filter((c) => c.oberligaId === oberligaId && !c.isReserve && !c.fictional);
  const fallback = Object.values(state.clubs).filter((c) => c.oberligaId === oberligaId && !c.isReserve);
  const id = `gen${state.counters.nextId++}`;
  const c = generateReservoirClub(id, oberligaId, anchors.length ? anchors : fallback, rng);
  state.clubs[id] = c;
  state.satisfaction[id] = 60;
  return c;
}

/** Zweitvertretungen, die nicht unterhalb ihres Muttervereins spielen, werden zwangsweise eine Ebene unter den Mutterverein versetzt. */
export function reserveViolations(state: GameState, l: Leagues): ClubId[] {
  const idx = leagueIndex(l);
  const out: ClubId[] = [];
  for (const [id, ref] of Object.entries(idx)) {
    const c = state.clubs[id];
    if (!c.parentId) continue;
    const p = idx[c.parentId];
    if (p && levelRank(ref.level) <= levelRank(p.level)) out.push(id);
  }
  return out;
}
