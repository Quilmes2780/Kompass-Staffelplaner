// Phasen-Zustandsautomat. Alle Aktionen sind reine Funktionen: (state, …) → neuer state.
// Intern wird auf einer tiefen Kopie gearbeitet, das Original bleibt unverändert.
import { MODEL_22_5_RULES, cloneRules, seasonLabel } from "../config/rules";
import { computeMetrics } from "./allocation/metrics";
import { groupChangers } from "./allocation/matching";
import { optimizeAllocation } from "./allocation/optimizer";
import { applyConcessions, defaultBlocks, FUNDING_COST, required, reversalBlocks, vote } from "./assembly";
import { distributeRevenue, evolveClubs } from "./economy";
import { buildEvaluation, checkAchievements, evaluationDue, ACHIEVEMENTS, seasonGrade } from "./evaluation";
import { autoResolveEvents, generateEvents, resolveEvent } from "./events";
import { distanceMatrixFor } from "./geo";
import { generateHardshipRequests, isFulfilled } from "./hardship";
import { leagueIndex, rlClubs } from "./leagues";
import { allLicensesDecided, decideLicense as decideLicenseRaw, finishLicensing, openLicensing, suggestDecision } from "./licensing";
import { addNews } from "./news";
import { resolvePromotion } from "./promotion";
import { hashKeys } from "./rng";
import { isSeasonComplete, matchStats, pairKey, playMatchdays, playToEnd, playWeek, startSeason } from "./season";
import { computeStreaks } from "./stats";
import { newGame as newGameRaw, type NewGameOptions } from "./setup";
import { acceptance, adjust, reactToAllocation, seasonEndDrift } from "./stakeholders";
import type {
  Allocation,
  AllocationMetrics,
  ClubId,
  ClubSeasonRecord,
  Concession,
  GameState,
  HardshipRequest,
  LicenseStatus,
  RuleViolation,
  SeasonSummary,
} from "./types";

export class RuleError extends Error {
  violations: RuleViolation[];
  constructor(violations: RuleViolation[]) {
    super(violations.map((v) => `${v.rule}: ${v.message}`).join("\n"));
    this.violations = violations;
  }
}

function produce(state: GameState, fn: (s: GameState) => void): GameState {
  const s = structuredClone(state);
  fn(s);
  return s;
}

// ---------------- Neues Spiel / Prolog ----------------

export function newGame(opts: NewGameOptions): GameState {
  const s = newGameRaw(opts);
  if (s.phase === "PROLOG") s.prolog = { concessions: [], model: "KOMPASS" };
  else beginAllocation(s);
  return s;
}

export const PROLOG_LIMITS = { HARDSHIP: 4, FUNDING: 3 };

export function prologConcession(state: GameState, c: Concession): GameState {
  return produce(state, (s) => {
    const p = s.prolog!;
    const used = p.concessions.filter((x) => x.kind === c.kind).length;
    if (used >= PROLOG_LIMITS[c.kind]) throw new Error("Keine Zusagen dieser Art mehr verfügbar");
    p.concessions.push(c);
  });
}

export function prologBlocks(state: GameState) {
  return applyConcessions(defaultBlocks(), state.prolog?.concessions ?? []);
}

export function prologVote(state: GameState): GameState {
  return produce(state, (s) => {
    const p = s.prolog!;
    const res = vote(s.seed, "prolog", prologBlocks(s));
    p.votes = res.yes;
    p.perBlock = res.perBlock;
    p.won = res.yes >= required(s);
    const funding = p.concessions.filter((c) => c.kind === "FUNDING").length;
    s.finance.dfbReserve -= funding * FUNDING_COST;
    if (p.won) {
      addNews(s, `Bundestag beschließt das Kompassmodell mit ${res.yes} von ${s.rules.prolog.votesTotal} Stimmen`, "pos");
      for (const c of p.concessions) if (c.kind === "HARDSHIP") adjust(s, c.blockId, 4);
    } else addNews(s, `Kompassmodell scheitert im Bundestag (${res.yes} Stimmen, nötig ${required(s)})`, "neg");
  });
}

/** Nach verlorener Abstimmung: Alternativszenario 22/5 oder Kompass trotzdem (Neustart erfolgt in der UI) */
export function prologContinue(state: GameState, alternative: boolean): GameState {
  if (alternative) {
    const s = newGameRaw({ seed: state.seed, world: state.worldKind, rules: cloneRules(MODEL_22_5_RULES), settings: state.settings });
    s.phase = "ALLOCATION";
    s.prolog = { ...state.prolog!, model: "MODEL_22_5" };
    s.news = [...state.news];
    addNews(s, "Alternativszenario: Die Regionalliga startet im 22/5-Modell mit fünf Staffeln", "neutral");
    beginAllocation(s);
    return s;
  }
  return produce(state, (s) => {
    s.phase = "ALLOCATION";
    beginAllocation(s);
  });
}

// ---------------- Staffeleinteilung ----------------

export function expectedRlClubs(state: GameState): ClubId[] {
  return rlClubs(state.leagues);
}

function together(hardship: HardshipRequest[]) {
  return hardship
    .filter((h) => h.decision === "GRANTED" && h.partnerId)
    .map((h) => ({ a: h.clubId, b: h.partnerId!, weight: 100_000 }));
}

function fixedFromHardship(hardship: HardshipRequest[]): Record<ClubId, string> {
  const f: Record<ClubId, string> = {};
  for (const h of hardship) if (h.decision === "GRANTED" && h.wantsGroup) f[h.clubId] = h.wantsGroup;
  return f;
}

function optimize(state: GameState, fixed: Record<ClubId, string>, hardship: HardshipRequest[], key: string, derbyWeight?: number): Allocation {
  const rules = derbyWeight === undefined ? state.rules : { ...state.rules, allocation: { ...state.rules.allocation, weights: { ...state.rules.allocation.weights, derbySplitPerWeight: derbyWeight } } };
  return optimizeAllocation({
    clubs: expectedRlClubs(state),
    clubData: state.clubs,
    derbies: state.derbies,
    dm: distanceMatrixFor(state.clubs, state.rules.allocation.roadFactor),
    rules,
    seed: hashKeys(state.seed, [state.season, key]),
    fixed,
    together: together(hardship),
    previous: state.allocation,
  });
}

/** Vorschlag des Algorithmus erzeugen, Härtefallanträge einsammeln */
export function beginAllocation(s: GameState): void {
  const proposal = optimize(s, {}, [], "proposal");
  proposal.label = "Algorithmus-Vorschlag";
  const pure = optimize(s, {}, [], "pure", 0);
  const dm = distanceMatrixFor(s.clubs, s.rules.allocation.roadFactor);
  const optimumKm = computeMetrics({ allocation: pure, expectedClubs: expectedRlClubs(s), clubs: s.clubs, derbies: s.derbies, dm, rules: s.rules }).totalKm;
  const hardship = s.season === s.rules.startSeason && !s.allocation ? generateHardshipRequests(s, proposal).slice(0, 4) : generateHardshipRequests(s, proposal);
  s.allocationDraft = {
    working: structuredClone(proposal),
    proposal,
    variants: { A: structuredClone(proposal), B: undefined, C: undefined },
    hardship,
    optimumKm,
  };
}

export function metricsFor(state: GameState, allocation: Allocation): AllocationMetrics {
  return computeMetrics({
    allocation,
    expectedClubs: expectedRlClubs(state),
    clubs: state.clubs,
    derbies: state.derbies,
    dm: distanceMatrixFor(state.clubs, state.rules.allocation.roadFactor),
    rules: state.rules,
    previous: state.allocation,
  });
}

export function moveClub(state: GameState, clubId: ClubId, toGroup: string): GameState {
  return produce(state, (s) => {
    const w = s.allocationDraft!.working;
    for (const g of Object.keys(w.groups)) w.groups[g] = w.groups[g].filter((x) => x !== clubId);
    (w.groups[toGroup] ??= []).push(clubId);
    w.label = "Eigene Bearbeitung";
  });
}

export function swapClubs(state: GameState, a: ClubId, b: ClubId): GameState {
  return produce(state, (s) => {
    const w = s.allocationDraft!.working;
    let ga = "";
    let gb = "";
    for (const [g, list] of Object.entries(w.groups)) {
      if (list.includes(a)) ga = g;
      if (list.includes(b)) gb = g;
    }
    if (!ga || !gb || ga === gb) return;
    w.groups[ga] = w.groups[ga].map((x) => (x === a ? b : x));
    w.groups[gb] = w.groups[gb].map((x) => (x === b ? a : x));
    w.label = "Eigene Bearbeitung";
  });
}

export function toggleFixed(state: GameState, clubId: ClubId): GameState {
  return produce(state, (s) => {
    const w = s.allocationDraft!.working;
    w.fixed = w.fixed.includes(clubId) ? w.fixed.filter((x) => x !== clubId) : [...w.fixed, clubId];
  });
}

/** Neu optimieren unter Beachtung fixierter Vereine und genehmigter Härtefälle */
export function reoptimize(state: GameState): GameState {
  return produce(state, (s) => {
    const d = s.allocationDraft!;
    const fixed: Record<ClubId, string> = {};
    for (const id of d.working.fixed) {
      const g = Object.entries(d.working.groups).find(([, l]) => l.includes(id))?.[0];
      if (g) fixed[id] = g;
    }
    Object.assign(fixed, fixedFromHardship(d.hardship));
    const fixedPerGroup: Record<string, number> = {};
    for (const g of Object.values(fixed)) fixedPerGroup[g] = (fixedPerGroup[g] ?? 0) + 1;
    if (Object.values(fixedPerGroup).some((n) => n > s.rules.rl.groupSize))
      throw new RuleError([{ rule: "Fixierungen", message: "Zu viele fixierte Vereine in einer Staffel." }]);
    const res = optimize(s, fixed, d.hardship, `reopt-${s.counters.nextId++}`);
    d.working = { ...res, fixed: [...d.working.fixed], label: "Neu optimiert" };
  });
}

export function resetToProposal(state: GameState): GameState {
  return produce(state, (s) => {
    s.allocationDraft!.working = structuredClone(s.allocationDraft!.proposal);
  });
}

export function saveVariant(state: GameState, slot: "A" | "B" | "C"): GameState {
  return produce(state, (s) => {
    s.allocationDraft!.variants[slot] = { ...structuredClone(s.allocationDraft!.working), label: `Variante ${slot}` };
  });
}

export function loadVariant(state: GameState, slot: "A" | "B" | "C"): GameState {
  return produce(state, (s) => {
    const v = s.allocationDraft!.variants[slot];
    if (v) s.allocationDraft!.working = structuredClone(v);
  });
}

export function decideHardship(state: GameState, id: string, decision: "GRANTED" | "REJECTED"): GameState {
  return produce(state, (s) => {
    const h = s.allocationDraft!.hardship.find((x) => x.id === id);
    if (h) h.decision = decision;
  });
}

/** Veröffentlichen: nur gültige Einteilungen; verletzte Regeln werden als RuleError gemeldet */
export function publishAllocation(state: GameState): GameState {
  const m = metricsFor(state, state.allocationDraft!.working);
  if (m.violations.length) throw new RuleError(m.violations);
  return produce(state, (s) => {
    const d = s.allocationDraft!;
    for (const h of d.hardship) {
      if (!h.decision) h.decision = "REJECTED";
      h.fulfilled = isFulfilled(h, d.working);
      (s.hardshipThisSeason[h.clubId] ??= []).push({ reason: h.reason, granted: h.decision === "GRANTED" });
      if (h.decision === "GRANTED") s.precedents.push({ season: s.season, clubId: h.clubId, kind: "HARDSHIP", detail: h.reason });
    }
    s.previousAllocation = s.allocation;
    s.allocation = { groups: structuredClone(d.working.groups), fixed: [...d.working.fixed], label: d.working.label };
    s.leagues.RL = structuredClone(d.working.groups);
    reactToAllocation(s, m, d.optimumKm, d.hardship);
    s.allocationDraft = undefined;
    s.currentMetrics = m;
    startSeason(s);
    s.phase = "SEASON";
    addNews(s, `Saison ${seasonLabel(s.season)} beginnt`, "neutral");
  });
}

// ---------------- Saison ----------------

export function simulate(state: GameState, mode: "MATCHDAY" | "WEEK" | "SEASON"): GameState {
  return produce(state, (s) => {
    if (s.phase !== "SEASON") return;
    if (mode === "MATCHDAY") playMatchdays(s, 1);
    else if (mode === "WEEK") playWeek(s);
    else playToEnd(s);
  });
}

export function seasonComplete(state: GameState): boolean {
  return state.phase === "SEASON" && isSeasonComplete(state);
}

/** Saisonabschluss: Auf-/Abstieg, Finanzen, Historie, Zufriedenheit, Achievements */
export function finishSeason(state: GameState): GameState {
  if (!isSeasonComplete(state)) throw new Error("Saison ist noch nicht beendet");
  return produce(state, (s) => {
    const fin = distributeRevenue(s);
    const prevRevenue = s.history.seasons[s.history.seasons.length - 1]?.revenue ?? fin.revenue;
    const out = resolvePromotion(s);
    const oldIdx = leagueIndex(s.leagues);
    // Staffelwechsler nach Vereinsüberschneidung (nur Vereine, die auch in der Vorsaison Regionalliga spielten)
    const changed = new Set(s.previousAllocation && s.allocation ? groupChangers(s.previousAllocation.groups, s.allocation.groups) : []);
    const newIdx = leagueIndex(out.leagues);
    // Historie
    for (const [id, ref] of Object.entries(oldIdx)) {
      const compId = ref.level === "RL" ? `RL-${ref.group}` : ref.level === "L3" ? "L3" : ref.level === "OL" ? ref.group : ref.level === "VL" ? `VL-${ref.group}` : ref.level;
      const t = out.tables[compId] ?? [];
      const rank = t.findIndex((r) => r.clubId === id);
      const row = t[rank];
      const st = s.seasonStats[id];
      const rec: ClubSeasonRecord = {
        season: s.season,
        clubId: id,
        league: ref,
        rank: rank + 1,
        played: row?.played ?? 0,
        w: row?.w ?? 0,
        d: row?.d ?? 0,
        l: row?.l ?? 0,
        gf: row?.gf ?? 0,
        ga: row?.ga ?? 0,
        pts: row?.pts ?? 0,
        movement: out.movements[id] ?? "STAYED",
        nextLeague: newIdx[id],
        title: rank === 0 && ref.level !== "VL",
        playoff: playoffFor(id, out),
        travelKm: Math.round(st?.travelKm ?? 0),
        travelKmPerAway: st?.awayGames ? Math.round(st.travelKm / st.awayGames) : 0,
        avgAttendance: st?.homeGames ? Math.round(st.attendanceSum / st.homeGames) : 0,
        income: st?.income ?? { guarantee: 0, distribution: 0, other: 0 },
        budgetEnd: 0,
        license: s.licenseThisSeason[id] ?? { status: ref.level === "RL" ? "GRANTED" : "NA", conditions: [] },
        hardship: s.hardshipThisSeason[id] ?? [],
        groupChanged: ref.level === "RL" && changed.has(id),
        derbiesPlayed: st?.derbies ?? 0,
        abstract: !s.competitions[compId],
      };
      s.history.clubSeasons.push(rec);
    }
    const ms = matchStats(Object.values(s.competitions).filter((c) => c.level === "RL"));
    const rlAtt = rlClubs(s.leagues).map((id) => s.seasonStats[id]).filter(Boolean);
    const avgAtt = rlAtt.reduce((a, x) => a + x.attendanceSum, 0) / Math.max(1, rlAtt.reduce((a, x) => a + x.homeGames, 0));
    // Ligen umstellen und Vereine entwickeln
    s.leagues = out.leagues;
    evolveClubs(s, out.movements);
    for (const rec of s.history.clubSeasons) if (rec.season === s.season) rec.budgetEnd = s.clubs[rec.clubId].budget;
    // Zufriedenheit
    for (const [id, m] of Object.entries(out.movements)) {
      if (m === "PROMOTED") adjust(s, id, 10);
      if (m === "RELEGATED" || m === "FORCED_RELEGATION") adjust(s, id, -8);
      if (m === "FORCED_RELEGATION") adjust(s, s.clubs[id].regionalverband, -2);
    }
    seasonEndDrift(s, fin.revenue - prevRevenue);
    const summary: SeasonSummary = {
      season: s.season,
      allocation: s.allocation,
      metrics: s.currentMetrics,
      tables: Object.fromEntries(Object.entries(out.tables).filter(([k]) => !k.startsWith("VL-"))),
      champions: out.champions,
      promotedToL3: out.promotedToL3,
      relegatedFromL3: out.relegatedFromL3,
      relegatedFromRL: out.relegatedFromRL,
      promotedFromOL: out.promotedFromOL,
      playoffs: out.playoffs,
      promotionRounds: out.promotionRounds,
      goalsPerGame: Math.round(ms.goalsPerGame * 100) / 100,
      homeWinRate: Math.round(ms.homeWinRate * 1000) / 1000,
      drawRate: Math.round(ms.drawRate * 1000) / 1000,
      avgAttendanceRL: Math.round(avgAtt),
      acceptance: acceptance(s),
      revenue: fin.revenue,
      specialCases: out.specialCases,
      streaks: computeStreaks(Object.values(s.competitions)),
      derbyResults: derbyResultsOf(s),
    };
    summary.grade = seasonGrade(summary);
    s.history.seasons.push(summary);
    if (!s.courtCases.some((c) => c.season === s.season)) s.counters.courtFreeSeasons++;
    s.score += Math.round((5 - summary.grade) * 100 + summary.acceptance);
    for (const id of checkAchievements(s, summary)) {
      const a = ACHIEVEMENTS.find((x) => x.id === id)!;
      addNews(s, `Erfolg freigeschaltet: ${a.title}`, "pos");
    }
    // Schlagzeilen
    for (const id of out.promotedToL3) addNews(s, `${s.clubs[id].name} steigt in die 3. Liga auf`, "pos", [id]);
    for (const t of out.playoffs) addNews(s, `${t.name}: ${s.clubs[t.winner].name} setzt sich durch`, "neutral", [t.a, t.b]);
    for (const n of out.specialCases) addNews(s, n, "neutral");
    s.competitions = {};
    s.licenseThisSeason = {};
    s.hardshipThisSeason = {};
    s.currentMetrics = undefined;
    s.phase = "WRAPUP";
  });
}

function derbyResultsOf(s: GameState): NonNullable<SeasonSummary["derbyResults"]> {
  const keys = new Set(s.derbies.map((d) => pairKey(d.a, d.b)));
  const out: NonNullable<SeasonSummary["derbyResults"]> = [];
  for (const c of Object.values(s.competitions))
    for (const f of c.fixtures) if (f.hg !== undefined && keys.has(pairKey(f.home, f.away))) out.push({ home: f.home, away: f.away, hg: f.hg, ag: f.ag! });
  return out;
}

function playoffFor(id: ClubId, out: ReturnType<typeof resolvePromotion>): ClubSeasonRecord["playoff"] {
  const t = out.playoffs.find((x) => x.a === id || x.b === id);
  if (t) return { name: t.name, won: t.winner === id };
  const r = out.promotionRounds.find((x) => x.table.some((row) => row.clubId === id));
  if (r) return { name: r.name, won: r.promoted.includes(id) };
  return undefined;
}

export function continueAfterWrapup(state: GameState): GameState {
  return produce(state, (s) => {
    if (evaluationDue(s)) {
      const rep = buildEvaluation(s);
      s.history.evaluations.push(rep);
      addNews(s, `Evaluierungsbericht ${seasonLabel(s.season)}: Akzeptanz ${rep.acceptance}`, rep.motionFiled ? "neg" : "neutral");
      if (rep.motionFiled) {
        s.rescue = { concessions: [] };
        addNews(s, "Mehrere Landesverbände beantragen die Rückabwicklung der Reform auf dem Bundestag", "neg");
      }
      s.phase = "EVALUATION";
    } else {
      generateEvents(s);
      s.phase = "EVENTS";
    }
  });
}

// ---------------- Evaluierung / Rettung ----------------

export const RESCUE_LIMITS = { HARDSHIP: 3, FUNDING: 2 };

export function rescueBlocks(state: GameState) {
  return applyConcessions(reversalBlocks(state), state.rescue?.concessions ?? []);
}

export function rescueConcession(state: GameState, c: Concession): GameState {
  return produce(state, (s) => {
    const r = s.rescue!;
    if (r.concessions.filter((x) => x.kind === c.kind).length >= RESCUE_LIMITS[c.kind]) throw new Error("Keine Zusagen dieser Art mehr verfügbar");
    r.concessions.push(c);
  });
}

/** Abstimmung über den Rückabwicklungsantrag: Reform fällt, wenn ≥ 2/3 der Stimmen für die Rückabwicklung sind */
export function rescueVote(state: GameState): GameState {
  return produce(state, (s) => {
    const r = s.rescue!;
    const blocks = rescueBlocks(s);
    const res = vote(s.seed, `rescue-${s.season}`, blocks.map((b) => ({ ...b, support: 1 - b.support })));
    r.votesForReversal = res.yes;
    r.perBlock = res.perBlock;
    s.finance.dfbReserve -= r.concessions.filter((c) => c.kind === "FUNDING").length * FUNDING_COST;
    if (res.yes >= required(s)) {
      r.survived = false;
      s.gameOver = { season: s.season, reason: `Der Bundestag beschließt mit ${res.yes} Stimmen die Rückabwicklung des Kompassmodells.` };
      s.phase = "GAME_OVER";
      addNews(s, "Reform gescheitert: Bundestag beschließt Rückabwicklung", "neg");
    } else {
      r.survived = true;
      for (const c of r.concessions) {
        if (c.kind === "HARDSHIP") s.precedents.push({ season: s.season, clubId: "", kind: "HARDSHIP", detail: `Härtefallgarantie ${c.blockId}` });
        adjust(s, c.blockId, 6);
      }
      for (const k of ["PRAESIDIUM", "MEDIA"]) adjust(s, k, 4);
      addNews(s, `Rückabwicklung abgewehrt (${res.yes} Stimmen, nötig ${required(s)})`, "pos");
    }
  });
}

export function continueAfterEvaluation(state: GameState): GameState {
  return produce(state, (s) => {
    if (s.phase === "GAME_OVER") return;
    if (s.rescue && s.rescue.survived === undefined) throw new Error("Abstimmung über den Rückabwicklungsantrag steht aus");
    s.rescue = undefined;
    generateEvents(s);
    s.phase = "EVENTS";
  });
}

// ---------------- Zwischensaison ----------------

export function chooseEventOption(state: GameState, eventId: string, option: string): GameState {
  return produce(state, (s) => resolveEvent(s, eventId, option));
}

export function continueAfterEvents(state: GameState): GameState {
  return produce(state, (s) => {
    if (s.pendingEvents.some((e) => !e.chosen)) throw new Error("Es sind noch Ereignisse offen");
    s.pendingEvents = [];
    s.season += 1;
    // Vermarktungserlös: Sonderdeals laufen aus, langfristig 1,5 % Marktwachstum p. a.
    const trend = s.rules.finance.marketingBase * Math.pow(1.015, s.season - s.rules.startSeason);
    s.finance.marketingPot = Math.round(s.finance.marketingPot + 0.15 * (trend - s.finance.marketingPot));
    openLicensing(s);
    s.phase = "LICENSING";
  });
}

// ---------------- Zulassung ----------------

export function decideLicense(state: GameState, clubId: ClubId, decision: LicenseStatus): GameState {
  return produce(state, (s) => decideLicenseRaw(s, clubId, decision));
}

export function decideAllSuggested(state: GameState): GameState {
  return produce(state, (s) => {
    for (const a of s.licensing!.applications) if (!a.decision) decideLicenseRaw(s, a.clubId, suggestDecision(s, a));
  });
}

export function finishLicensingPhase(state: GameState): GameState {
  if (!allLicensesDecided(state)) throw new Error("Es sind noch Zulassungsanträge offen");
  return produce(state, (s) => {
    finishLicensing(s);
    s.licensing = undefined;
    beginAllocation(s);
    s.phase = "ALLOCATION";
  });
}

// ---------------- Headless ----------------

/** Spielt eine komplette Saison mit Standardentscheidungen (Tests, Schnellsimulation) */
export function autoAdvance(state: GameState): GameState {
  let s = state;
  for (let guard = 0; guard < 20; guard++) {
    switch (s.phase) {
      case "PROLOG":
        s = prologVote(s);
        s = prologContinue(s, !s.prolog?.won);
        break;
      case "ALLOCATION":
        s = publishAllocation(s);
        break;
      case "SEASON":
        s = simulate(s, "SEASON");
        s = finishSeason(s);
        break;
      case "WRAPUP":
        s = continueAfterWrapup(s);
        break;
      case "EVALUATION":
        if (s.rescue && s.rescue.survived === undefined) s = rescueVote(s);
        s = continueAfterEvaluation(s);
        break;
      case "EVENTS":
        s = produce(s, autoResolveEvents);
        s = continueAfterEvents(s);
        break;
      case "LICENSING":
        s = finishLicensingPhase(decideAllSuggested(s));
        return s;
      case "GAME_OVER":
        return s;
    }
  }
  return s;
}
