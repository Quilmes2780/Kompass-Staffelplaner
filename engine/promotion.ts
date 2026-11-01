// Saisonabschluss: Auf- und Abstieg über alle Ebenen nach Regelwerk, inkl. Kontingenten der 5. Ebene,
// Aufstiegsrunden, Relegation um den halben Platz und Sonderfällen.
import { abstractTable } from "./abstract";
import { cloneLeagues, leagueIndex, levelRank, rlClubs } from "./leagues";
import { rngFor, type Rng } from "./rng";
import { balanceOberligen, reserveAllowedInOberliga } from "./setup";
import { competitionTable } from "./season";
import { playPromotionRound, playTie } from "./ties";
import type { ClubId, GameState, LeagueRef, Leagues, Level, Movement, PromotionRoundResult, TableRow, Tie } from "./types";
import { GEBIETE } from "./types";
import type { Entrant } from "../config/rules";
import { hasHardDeficits } from "./licensing";

export interface PromotionOutcome {
  leagues: Leagues;
  tables: Record<string, TableRow[]>;
  movements: Record<ClubId, Movement>;
  champions: Record<string, ClubId>;
  promotedToL3: ClubId[];
  relegatedFromL3: ClubId[];
  relegatedFromRL: ClubId[];
  promotedFromOL: ClubId[];
  playoffs: Tie[];
  promotionRounds: PromotionRoundResult[];
  specialCases: string[];
  enlargedOberligen: string[];
  /** Saison-Rang je Verein (für Nachrücker-Regeln) */
  rankOf: Record<ClubId, { compId: string; rank: number; ppg: number }>;
}

/** Drittliga-Zulassung (vereinfacht) für einen RL-Aufsteiger */
export function l3Eligible(state: GameState, id: ClubId, idx: Record<ClubId, LeagueRef>): boolean {
  const c = state.clubs[id];
  const r = state.rules.l3;
  if (c.parentId) {
    const p = idx[c.parentId];
    if (p && levelRank(p.level) >= levelRank("L3")) return false;
  }
  return c.stadium.capacity >= r.licenseMinCapacity && c.budget >= r.licenseMinBudget;
}

/** Aufstiegsberechtigung in die Regionalliga (Zweitvertretung nur, wenn Mutterverein höher spielt) */
export function rlEligible(state: GameState, id: ClubId, idx: Record<ClubId, LeagueRef>): boolean {
  const c = state.clubs[id];
  if (c.parentId) {
    const p = idx[c.parentId];
    if (p && levelRank(p.level) >= levelRank("RL")) return false;
  }
  return true;
}

export function resolvePromotion(state: GameState): PromotionOutcome {
  const r = state.rules;
  const rng = rngFor(state.seed, state.season, "promotion");
  const old = state.leagues;
  const oldIdx = leagueIndex(old);
  const tables: Record<string, TableRow[]> = {};
  const rankOf: PromotionOutcome["rankOf"] = {};
  const setRanks = (compId: string, t: TableRow[]) => {
    tables[compId] = t;
    t.forEach((row, i) => (rankOf[row.clubId] = { compId, rank: i + 1, ppg: row.played ? row.pts / row.played : 0 }));
  };

  // --- Tabellen ---
  setRanks("BL", abstractTable(state, old.BL, 34, rngFor(state.seed, state.season, "abs", "BL"), 6));
  setRanks("BL2", abstractTable(state, old.BL2, 34, rngFor(state.seed, state.season, "abs", "BL2"), 6));
  setRanks("L3", competitionTable(state, "L3"));
  for (const g of Object.keys(old.RL)) setRanks(`RL-${g}`, competitionTable(state, `RL-${g}`));
  // Oberligen: echte Spiele; abstrakt nur für Spielstände, deren laufende Saison noch ohne Oberliga-Spielplan begann
  for (const o of state.oberligen)
    setRanks(o.id, state.competitions[o.id] ? competitionTable(state, o.id) : abstractTable(state, old.OL[o.id], 34, rngFor(state.seed, state.season, "abs", o.id), 5));
  for (const o of state.oberligen) setRanks(`VL-${o.id}`, abstractTable(state, old.VL[o.id], 30, rngFor(state.seed, state.season, "abs", "VL", o.id), 6));

  const movements: Record<ClubId, Movement> = {};
  const specialCases: string[] = [];
  const champions: Record<string, ClubId> = {};
  for (const [k, t] of Object.entries(tables)) if (t.length && !k.startsWith("VL-")) champions[k] = t[0].clubId;
  const ids = (t: TableRow[]) => t.map((x) => x.clubId);

  // --- Profiligen ---
  const ex = r.pro.exchange;
  const blDown = ids(tables.BL).slice(-ex);
  const bl2Up = ids(tables.BL2).slice(0, ex);
  const bl2Down = ids(tables.BL2).slice(-r.l3.promotedToBL2);
  const l3Up = ids(tables.L3).filter((id) => !state.clubs[id].isReserve).slice(0, r.l3.promotedToBL2);
  const next = cloneLeagues(old);
  next.BL = [...old.BL.filter((x) => !blDown.includes(x)), ...bl2Up];
  next.BL2 = [...old.BL2.filter((x) => !bl2Up.includes(x) && !bl2Down.includes(x)), ...blDown, ...l3Up];
  for (const x of [...blDown, ...bl2Down]) movements[x] = "RELEGATED";
  for (const x of [...bl2Up, ...l3Up]) movements[x] = "PROMOTED";

  // vorläufiger Index nach Profiliga-Bewegungen (für Zweitvertretungs-Regeln)
  const idxAfterPro = leagueIndex({ ...next, L3: [...old.L3.filter((x) => !l3Up.includes(x)), ...bl2Down] });

  // --- Regionalliga → 3. Liga ---
  const groups = Object.keys(old.RL).sort();
  const groupCandidate: Record<string, ClubId | undefined> = {};
  for (const g of groups) {
    const t = tables[`RL-${g}`];
    let cand: ClubId | undefined;
    for (let i = 0; i < Math.min(r.specialCases.noLicenseChampionMaxRank, t.length); i++) {
      if (l3Eligible(state, t[i].clubId, idxAfterPro)) {
        cand = t[i].clubId;
        break;
      }
    }
    if (cand && cand !== t[0].clubId)
      specialCases.push(`Staffel ${g}: Meister ${state.clubs[t[0].clubId].name} ohne Drittliga-Zulassung – ${state.clubs[cand].name} rückt nach.`);
    if (!cand) specialCases.push(`Staffel ${g}: kein zugelassener Aufstiegskandidat – Platz bleibt frei.`);
    groupCandidate[g] = cand;
  }
  const playoffs: Tie[] = [];
  let promotedToL3: ClubId[] = [];
  const slots = r.rl.promotedToL3;
  if (groups.length <= slots) {
    promotedToL3 = groups.map((g) => groupCandidate[g]).filter((x): x is ClubId => !!x);
  } else {
    // Rotation: wechselnde Staffeln mit direktem Aufstieg, die übrigen spielen K.-o.
    const offset = state.season % groups.length;
    const order = groups.map((_, i) => groups[(i + offset) % groups.length]);
    const direct = order.slice(0, slots - 1).map((g) => groupCandidate[g]).filter((x): x is ClubId => !!x);
    const rest = order.slice(slots - 1).map((g) => groupCandidate[g]).filter((x): x is ClubId => !!x);
    let winner = rest[0];
    for (let i = 1; i < rest.length; i++) {
      const tie = playTie(state, winner, rest[i], r.rl.championPlayoffMode, `MP-${i}`, "Aufstiegsspiele zur 3. Liga");
      playoffs.push(tie);
      winner = tie.winner;
    }
    promotedToL3 = winner ? [...direct, winner] : direct;
  }
  for (const x of promotedToL3) movements[x] = "PROMOTED";

  // --- 3. Liga → Regionalliga ---
  const l3Remaining = ids(tables.L3).filter((x) => !l3Up.includes(x));
  const relegatedFromL3 = l3Remaining.slice(l3Remaining.length - promotedToL3.length);
  for (const x of relegatedFromL3) movements[x] = "RELEGATED";
  next.L3 = [...l3Remaining.filter((x) => !relegatedFromL3.includes(x)), ...bl2Down, ...promotedToL3];

  // --- Regionalliga → Oberliga ---
  const relegatedFromRL: ClubId[] = [];
  for (const g of groups) {
    const t = ids(tables[`RL-${g}`]);
    for (const x of t.slice(t.length - r.rl.relegatedPerGroup)) {
      if (!promotedToL3.includes(x)) relegatedFromRL.push(x);
    }
  }
  for (const x of relegatedFromRL) movements[x] = "RELEGATED";

  // --- Oberliga → Regionalliga (Kontingente) ---
  const idxNow = leagueIndex({ ...next, RL: {}, OL: {}, VL: {} });
  const fullIdx: Record<ClubId, LeagueRef> = { ...oldIdx, ...idxNow };
  const promotedFromOL: ClubId[] = [];
  const promotionRounds: PromotionRoundResult[] = [];
  const taken = new Set<ClubId>();
  const resolveEntrant = (e: Entrant): ClubId | undefined => {
    const t = tables[e.oberligaId];
    if (!t) return undefined;
    for (let rank = e.rank; rank <= Math.min(t.length, r.maxFallbackRank + (e.rank - 1)); rank++) {
      const id = t[rank - 1].clubId;
      if (taken.has(id)) continue;
      if (!rlEligible(state, id, fullIdx)) continue;
      // Verzicht (z. B. fehlende Infrastruktur, Etat) – deterministisch je Verein und Saison
      if (renounces(state, id, rng)) {
        if (rank === e.rank) specialCases.push(`${state.clubs[id].name} verzichtet auf den Aufstieg.`);
        continue;
      }
      taken.add(id);
      return id;
    }
    return undefined;
  };
  for (const g of GEBIETE) {
    const q = r.quotas[g];
    for (const e of q.direct) {
      const id = resolveEntrant(e);
      if (id) promotedFromOL.push(id);
    }
    for (const round of q.rounds) {
      const entrants = round.entrants.map(resolveEntrant).filter((x): x is ClubId => !!x);
      const res = playPromotionRound(state, round.id, round.name, entrants, round.slots, round.format);
      promotionRounds.push(res);
      promotedFromOL.push(...res.promoted);
    }
  }
  if (r.halfSlotPlayoff) {
    const [ga, gb] = r.halfSlotPlayoff.gebiete;
    const best = (g: typeof ga) => {
      const cands = (r.quotas[g].halfSlotCandidates ?? [])
        .map((e) => ({ e, ppg: tables[e.oberligaId]?.[e.rank - 1] ? tables[e.oberligaId][e.rank - 1].pts / tables[e.oberligaId][e.rank - 1].played : 0 }))
        .sort((x, y) => y.ppg - x.ppg);
      for (const { e } of cands) {
        const id = resolveEntrant(e);
        if (id) return id;
      }
      return undefined;
    };
    const a = best(ga);
    const b = best(gb);
    if (a && b) {
      const tie = playTie(state, a, b, r.halfSlotPlayoff.mode, "REL-BY-NO", "Relegation Bayern/Nordost");
      playoffs.push(tie);
      promotedFromOL.push(tie.winner);
    } else if (a || b) {
      promotedFromOL.push((a ?? b)!);
      specialCases.push("Relegation Bayern/Nordost entfällt mangels Gegner.");
    }
  }
  for (const x of promotedFromOL) movements[x] = "PROMOTED";

  // --- neue Zusammensetzung ---
  const rlOld = rlClubs(old);
  const rlNew = [...rlOld.filter((x) => !promotedToL3.includes(x) && !relegatedFromRL.includes(x)), ...relegatedFromL3, ...promotedFromOL];
  next.RL = { POOL: rlNew };
  for (const o of state.oberligen) next.OL[o.id] = next.OL[o.id].filter((x) => !promotedFromOL.includes(x));
  for (const o of state.oberligen) next.VL[o.id] = [...next.VL[o.id]];
  for (const x of relegatedFromRL) next.OL[state.clubs[x].oberligaId].push(x);
  // Austausch Oberliga ↔ Verbandsliga: Letzter der Oberliga (bei Aufstockung entsprechend mehr) gegen
  // den Verbandsliga-Meister. Ausgleich auf Sollgröße erfolgt in balanceOberligen.
  for (const o of state.oberligen) {
    const ot = ids(tables[o.id] ?? []).filter((x) => next.OL[o.id].includes(x) && !relegatedFromRL.includes(x));
    const down = 1 + Math.max(0, old.OL[o.id].length - r.oberliga.poolSize);
    for (const x of ot.slice(Math.max(0, ot.length - down))) {
      next.OL[o.id] = next.OL[o.id].filter((y) => y !== x);
      next.VL[o.id].push(x);
      movements[x] = "RELEGATED";
    }
    const vt = tables[`VL-${o.id}`];
    const up = vt?.map((x) => x.clubId).find((x) => reserveAllowedInOberliga(state, next, x));
    if (up) {
      next.VL[o.id] = next.VL[o.id].filter((x) => x !== up);
      next.OL[o.id].push(up);
      movements[up] = "PROMOTED";
    }
  }

  // --- Sonderfälle: Insolvenz / Rückzug (Regionalliga, 3. Liga) ---
  for (const id of [...next.L3, ...rlClubs(next)]) {
    const c = state.clubs[id];
    if (c.isReserve) continue;
    const risk = r.specialCases.insolvencyBaseRate * (c.budget < 1_000_000 ? 3 : c.budget < 1_800_000 ? 1.5 : 0.5);
    const crng = rngFor(state.seed, state.season, "insolvency", id);
    if (crng.chance(risk)) {
      movements[id] = "INSOLVENT";
      specialCases.push(`Insolvenz: ${c.name} muss den Spielbetrieb in der bisherigen Liga einstellen und startet in der Oberliga neu.`);
    } else if (crng.chance(r.specialCases.withdrawalBaseRate)) {
      movements[id] = "WITHDRAWN";
      specialCases.push(`Rückzug: ${c.name} zieht seine Mannschaft freiwillig in die Oberliga zurück.`);
    }
  }
  for (const [id, m] of Object.entries(movements)) {
    if (m !== "INSOLVENT" && m !== "WITHDRAWN") continue;
    next.L3 = next.L3.filter((x) => x !== id);
    next.RL.POOL = next.RL.POOL.filter((x) => x !== id);
    if (!next.OL[state.clubs[id].oberligaId].includes(id)) next.OL[state.clubs[id].oberligaId].push(id);
  }

  // --- Zwangsabstieg von Zweitvertretungen ---
  enforceReserves(state, next, movements, specialCases);

  // --- Ligagrößen ausgleichen (Nachrücker / zusätzliche Absteiger) ---
  rebalance(state, next, movements, specialCases, rankOf);
  // Mutterverein kann durch zusätzliche Abstiege nachträglich gefallen sein
  enforceReserves(state, next, movements, specialCases);
  rebalance(state, next, movements, specialCases, rankOf);

  const enlargedOberligen = balanceOberligen(state, next, rng);
  for (const o of enlargedOberligen)
    specialCases.push(`${state.oberligen.find((x) => x.id === o)?.name}: temporäre Aufstockung auf ${next.OL[o].length} Teams.`);

  return {
    leagues: next,
    tables,
    movements,
    champions,
    promotedToL3,
    relegatedFromL3,
    relegatedFromRL,
    promotedFromOL,
    playoffs,
    promotionRounds,
    specialCases,
    enlargedOberligen,
    rankOf,
  };
}

function renounces(state: GameState, id: ClubId, _rng: Rng): boolean {
  const c = state.clubs[id];
  // Ohne Aussicht auf die Regionalliga-Zulassung (Pflichtmängel) beantragen die meisten Vereine keinen Aufstieg;
  // kleine Vereine mit sehr kleinem Stadion verzichten auch sonst häufiger.
  const hard = hasHardDeficits(state, id, state.season + 1);
  const p = hard ? (c.budget > 1_000_000 ? 0.5 : 0.85) : c.stadium.capacity < 2000 ? 0.12 : 0.03;
  return rngFor(state.seed, state.season, "renounce", id).chance(p);
}

/** Zweitvertretungen müssen mindestens eine Ebene unter dem Mutterverein spielen (sonst Zwangsabstieg). */
export function enforceReserves(state: GameState, l: Leagues, movements: Record<ClubId, Movement>, notes: string[]): void {
  for (let guard = 0; guard < 5; guard++) {
    const idx = leagueIndex(l);
    let changed = false;
    for (const [id, ref] of Object.entries(idx)) {
      const c = state.clubs[id];
      if (!c.parentId || !idx[c.parentId]) continue;
      const parentLevel = idx[c.parentId].level;
      if (levelRank(ref.level) > levelRank(parentLevel) && levelRank(ref.level) >= levelRank("L3")) continue;
      if (ref.level === "VL") continue; // tiefer geht es nicht
      const target = nextLevelBelow(parentLevel);
      if (target === ref.level) continue;
      removeFrom(l, id);
      addTo(state, l, id, target);
      movements[id] = "FORCED_RELEGATION";
      notes.push(`Zwangsabstieg: ${c.name}, weil ${state.clubs[c.parentId].name} in ${levelName(parentLevel)} spielt.`);
      changed = true;
    }
    if (!changed) break;
  }
}

function nextLevelBelow(level: Level): Level {
  if (level === "BL" || level === "BL2") return "L3";
  if (level === "L3") return "RL";
  if (level === "RL") return "OL";
  return "VL";
}

function levelName(l: Level): string {
  return { BL: "der Bundesliga", BL2: "der 2. Bundesliga", L3: "der 3. Liga", RL: "der Regionalliga", OL: "der Oberliga", VL: "der Verbandsliga" }[l];
}

export function removeFrom(l: Leagues, id: ClubId): void {
  l.BL = l.BL.filter((x) => x !== id);
  l.BL2 = l.BL2.filter((x) => x !== id);
  l.L3 = l.L3.filter((x) => x !== id);
  for (const k of Object.keys(l.RL)) l.RL[k] = l.RL[k].filter((x) => x !== id);
  for (const k of Object.keys(l.OL)) l.OL[k] = l.OL[k].filter((x) => x !== id);
  for (const k of Object.keys(l.VL)) l.VL[k] = l.VL[k].filter((x) => x !== id);
}

export function addTo(state: GameState, l: Leagues, id: ClubId, level: Level): void {
  if (level === "L3") l.L3.push(id);
  else if (level === "RL") (l.RL.POOL ??= []).push(id);
  else if (level === "OL") l.OL[state.clubs[id].oberligaId].push(id);
  else if (level === "VL") l.VL[state.clubs[id].oberligaId].push(id);
}

/**
 * Ligagrößen von oben nach unten herstellen.
 * Fehlbestand: bester Absteiger der Liga bleibt (Nachrücker), sonst nächster Aufstiegskandidat der Ebene darunter.
 * Überhang: zusätzlicher Absteiger (schlechtester Verbleiber nach Punkten pro Spiel).
 */
export function rebalance(
  state: GameState,
  l: Leagues,
  movements: Record<ClubId, Movement>,
  notes: string[],
  rankOf: PromotionOutcome["rankOf"],
): void {
  const r = state.rules;
  const blocked = (id: ClubId) => ["INSOLVENT", "WITHDRAWN", "FORCED_RELEGATION", "LICENSE_DENIED"].includes(movements[id]);
  const ppg = (id: ClubId) => rankOf[id]?.ppg ?? 0;
  // 3. Liga
  while (l.L3.length < r.l3.size) {
    const idx = leagueIndex(l);
    const back = rlClubs(l)
      .filter((id) => movements[id] === "RELEGATED" && rankOf[id]?.compId === "L3" && !blocked(id))
      .sort((a, b) => rankOf[a].rank - rankOf[b].rank)[0];
    const up =
      back ??
      rlClubs(l)
        .filter((id) => !blocked(id) && movements[id] !== "RELEGATED" && rankOf[id]?.compId.startsWith("RL-") && l3Eligible(state, id, idx))
        .sort((a, b) => ppg(b) - ppg(a))[0];
    if (!up) break;
    removeFrom(l, up);
    l.L3.push(up);
    movements[up] = back ? "REINSTATED" : "PROMOTED";
    notes.push(`Nachrücker 3. Liga: ${state.clubs[up].name}.`);
  }
  while (l.L3.length > r.l3.size) {
    const out = l.L3.filter((id) => rankOf[id]?.compId === "L3" && movements[id] !== "PROMOTED").sort((a, b) => ppg(a) - ppg(b))[0];
    removeFrom(l, out);
    addTo(state, l, out, "RL");
    movements[out] = "RELEGATED";
    notes.push(`Zusätzlicher Absteiger aus der 3. Liga: ${state.clubs[out].name}.`);
  }
  // Regionalliga
  const target = r.rl.groupIds.length * r.rl.groupSize;
  while (rlClubs(l).length < target) {
    const idx = leagueIndex(l);
    const back = Object.values(l.OL)
      .flat()
      .filter((id) => movements[id] === "RELEGATED" && rankOf[id]?.compId.startsWith("RL-") && !blocked(id))
      .sort((a, b) => ppg(b) - ppg(a))[0];
    const up =
      back ??
      Object.values(l.OL)
        .flat()
        .filter((id) => !blocked(id) && movements[id] !== "RELEGATED" && rlEligible(state, id, idx))
        .sort((a, b) => ppg(b) - ppg(a))[0];
    if (!up) break;
    removeFrom(l, up);
    addTo(state, l, up, "RL");
    movements[up] = back ? "REINSTATED" : "PROMOTED";
    notes.push(`Nachrücker Regionalliga: ${state.clubs[up].name}${back ? " (bester Absteiger)" : ""}.`);
  }
  while (rlClubs(l).length > target) {
    const out = rlClubs(l)
      .filter((id) => rankOf[id]?.compId.startsWith("RL-") && movements[id] !== "PROMOTED" && movements[id] !== "REINSTATED")
      .sort((a, b) => ppg(a) - ppg(b))[0];
    removeFrom(l, out);
    addTo(state, l, out, "OL");
    movements[out] = "RELEGATED";
    notes.push(`Zusätzlicher Absteiger aus der Regionalliga: ${state.clubs[out].name}.`);
  }
}
