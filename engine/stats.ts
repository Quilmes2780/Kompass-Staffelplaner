// Auswertungen über die Historie: Ewige Tabelle, Rekorde, Vereinsprofile, Dashboard-Reihen.
import { groupChangers } from "./allocation/matching";
import { leagueLabel } from "./leagues";
import type { ClubId, ClubSeasonRecord, Competition, GameState, LeagueRef, Movement, SeasonSummary } from "./types";

/** Schlüssel eines Wettbewerbs: "RL-Nord", "L3", Oberliga-ID, "BL", … */
export function compKey(ref: LeagueRef): string {
  return ref.level === "RL" ? `RL-${ref.group}` : ref.level === "OL" ? ref.group : ref.level === "VL" ? `VL-${ref.group}` : ref.level;
}

/** Auswahl für Auswertungen je Spielklasse: Regionalliga gesamt, einzelne Staffeln, 3. Liga, Oberligen */
export function statScopes(state: GameState): { id: string; label: string }[] {
  const seen = new Map<string, LeagueRef>();
  for (const r of state.history.clubSeasons)
    if (r.league.level === "RL" || ((r.league.level === "L3" || r.league.level === "OL") && !r.abstract)) seen.set(compKey(r.league), r.league);
  const rl = [...seen.entries()].filter(([, r]) => r.level === "RL").sort(([a], [b]) => a.localeCompare(b, "de"));
  return [
    { id: "RL", label: "Regionalliga (alle Staffeln)" },
    ...rl.map(([k, r]) => ({ id: k, label: `Regionalliga – Staffel ${r.group}` })),
    ...(seen.has("L3") ? [{ id: "L3", label: "3. Liga" }] : []),
    ...state.oberligen.filter((o) => seen.has(o.id)).map((o) => ({ id: o.id, label: o.name })),
  ];
}

function inScope(r: ClubSeasonRecord, scope: string): boolean {
  if (scope === "RL") return r.league.level === "RL";
  return compKey(r.league) === scope && !r.abstract;
}

export interface EternalRow {
  clubId: ClubId;
  seasons: number;
  played: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
  titles: number;
  bestRank: number;
}

/** Ewige Tabelle einer Spielklasse bzw. Staffel (Standard: Regionalliga gesamt) */
export function eternalTable(state: GameState, scope = "RL"): EternalRow[] {
  const rows = new Map<ClubId, EternalRow>();
  for (const r of state.history.clubSeasons) {
    if (!inScope(r, scope)) continue;
    const e = rows.get(r.clubId) ?? { clubId: r.clubId, seasons: 0, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, titles: 0, bestRank: 99 };
    e.seasons++;
    e.played += r.played;
    e.w += r.w;
    e.d += r.d;
    e.l += r.l;
    e.gf += r.gf;
    e.ga += r.ga;
    e.pts += r.pts;
    if (r.title) e.titles++;
    e.bestRank = Math.min(e.bestRank, r.rank);
    rows.set(r.clubId, e);
  }
  return [...rows.values()].sort((a, b) => b.pts - a.pts || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf);
}

export interface RecordEntry {
  label: string;
  value: string;
  clubId?: ClubId;
  season?: number;
}

export function records(state: GameState): RecordEntry[] {
  const rl = state.history.clubSeasons.filter((r) => r.league.level === "RL" && r.played > 0);
  const fmt = (n: number) => Math.round(n).toLocaleString("de-DE");
  const best = (f: (r: ClubSeasonRecord) => number, dir = 1) => [...rl].sort((a, b) => dir * (f(b) - f(a)))[0];
  const out: RecordEntry[] = [];
  const add = (label: string, r: ClubSeasonRecord | undefined, v: (r: ClubSeasonRecord) => string) => {
    if (r) out.push({ label, value: v(r), clubId: r.clubId, season: r.season });
  };
  add("Meiste Punkte in einer Saison", best((r) => r.pts), (r) => `${r.pts} Punkte`);
  add("Wenigste Punkte in einer Saison", best((r) => r.pts, -1), (r) => `${r.pts} Punkte`);
  add("Meiste Tore in einer Saison", best((r) => r.gf), (r) => `${r.gf} Tore`);
  add("Beste Tordifferenz", best((r) => r.gf - r.ga), (r) => `${r.gf - r.ga > 0 ? "+" : ""}${r.gf - r.ga}`);
  add("Weiteste Saison-Reise", best((r) => r.travelKm), (r) => `${fmt(r.travelKm)} km`);
  add("Kürzeste Saison-Reise", best((r) => r.travelKm, -1), (r) => `${fmt(r.travelKm)} km`);
  add("Höchster Zuschauerschnitt", best((r) => r.avgAttendance), (r) => `${fmt(r.avgAttendance)}`);
  for (const s of state.history.seasons)
    for (const st of s.streaks ?? []) {
      const cur = out.find((x) => x.label === st.label);
      const val = `${st.length} Spiele`;
      if (!cur) out.push({ label: st.label, value: val, clubId: st.clubId, season: s.season });
      else if (parseInt(cur.value) < st.length) Object.assign(cur, { value: val, clubId: st.clubId, season: s.season });
    }
  return out;
}

/** Fahrstuhlteams: häufigste Wechsel zwischen Regionalliga und anderen Spielklassen */
export function elevatorTeams(state: GameState): { clubId: ClubId; moves: number }[] {
  const byClub = new Map<ClubId, ClubSeasonRecord[]>();
  for (const r of state.history.clubSeasons) byClub.set(r.clubId, [...(byClub.get(r.clubId) ?? []), r]);
  const out: { clubId: ClubId; moves: number }[] = [];
  for (const [id, recs] of byClub) {
    recs.sort((a, b) => a.season - b.season);
    let moves = 0;
    for (let i = 1; i < recs.length; i++) if ((recs[i].league.level === "RL") !== (recs[i - 1].league.level === "RL")) moves++;
    if (moves) out.push({ clubId: id, moves });
  }
  return out.sort((a, b) => b.moves - a.moves);
}

/** Dauerbrenner: meiste Regionalliga-Saisons in Folge */
export function ironmen(state: GameState): { clubId: ClubId; seasons: number }[] {
  const byClub = new Map<ClubId, number[]>();
  for (const r of state.history.clubSeasons) if (r.league.level === "RL") byClub.set(r.clubId, [...(byClub.get(r.clubId) ?? []), r.season]);
  const out: { clubId: ClubId; seasons: number }[] = [];
  for (const [id, ys] of byClub) {
    ys.sort((a, b) => a - b);
    let best = 1;
    let cur = 1;
    for (let i = 1; i < ys.length; i++) {
      cur = ys[i] === ys[i - 1] + 1 ? cur + 1 : 1;
      best = Math.max(best, cur);
    }
    out.push({ clubId: id, seasons: best });
  }
  return out.sort((a, b) => b.seasons - a.seasons);
}

export function clubHistory(state: GameState, id: ClubId): ClubSeasonRecord[] {
  return state.history.clubSeasons.filter((r) => r.clubId === id).sort((a, b) => a.season - b.season);
}

/** Bilanz gegen Rivalen aus den archivierten Derby-Ergebnissen */
export function rivalryRecord(state: GameState, id: ClubId): { opponent: ClubId; w: number; d: number; l: number; weight: number }[] {
  const out: { opponent: ClubId; w: number; d: number; l: number; weight: number }[] = [];
  for (const d of state.derbies) {
    if (d.a !== id && d.b !== id) continue;
    const opp = d.a === id ? d.b : d.a;
    const rec = { opponent: opp, w: 0, d: 0, l: 0, weight: d.weight };
    for (const s of state.history.seasons)
      for (const m of s.derbyResults ?? []) {
        if (!((m.home === id && m.away === opp) || (m.home === opp && m.away === id))) continue;
        const my = m.home === id ? m.hg : m.ag;
        const their = m.home === id ? m.ag : m.hg;
        if (my > their) rec.w++;
        else if (my < their) rec.l++;
        else rec.d++;
      }
    out.push(rec);
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/** Längste Serien einer Saison (Siege, ungeschlagen) aus den Spielen der Wettbewerbe */
export function computeStreaks(comps: Competition[]): NonNullable<SeasonSummary["streaks"]> {
  let bestWin = { clubId: "", length: 0 };
  let bestUnbeaten = { clubId: "", length: 0 };
  for (const c of comps) {
    if (c.level !== "RL") continue;
    for (const id of c.clubs) {
      const games = c.fixtures.filter((f) => f.hg !== undefined && (f.home === id || f.away === id)).sort((a, b) => a.matchday - b.matchday);
      let w = 0;
      let u = 0;
      for (const f of games) {
        const my = f.home === id ? f.hg! : f.ag!;
        const th = f.home === id ? f.ag! : f.hg!;
        w = my > th ? w + 1 : 0;
        u = my >= th ? u + 1 : 0;
        if (w > bestWin.length) bestWin = { clubId: id, length: w };
        if (u > bestUnbeaten.length) bestUnbeaten = { clubId: id, length: u };
      }
    }
  }
  return [
    { label: "Längste Siegesserie", ...bestWin },
    { label: "Längste Serie ohne Niederlage", ...bestUnbeaten },
  ];
}

export interface SeriesPoint {
  season: number;
  value: number;
}

export function dashboardSeries(state: GameState): Record<string, { label: string; unit: string; points: SeriesPoint[] }> {
  const ss = state.history.seasons;
  const mk = (label: string, unit: string, f: (s: SeasonSummary) => number) => ({ label, unit, points: ss.map((s) => ({ season: s.season, value: f(s) })) });
  return {
    km: mk("Gesamt-Reise-km", "km", (s) => s.metrics?.totalKm ?? 0),
    acceptance: mk("Akzeptanz", "", (s) => s.acceptance),
    balance: mk("Leistungsstreuung der Staffeln", "", (s) => Math.round((s.metrics?.strengthSpread ?? 0) * 100) / 100),
    revenue: mk("Vermarktungserlöse", "€", (s) => s.revenue),
    attendance: mk("Zuschauerschnitt RL", "", (s) => s.avgAttendanceRL),
    derbies: mk("Getrennte Derbys (gewichtet)", "", (s) => s.metrics?.derbiesSplitWeight ?? 0),
    grade: mk("Saisonnote", "", (s) => s.grade ?? 0),
    goals: mk("Tore pro Spiel", "", (s) => s.goalsPerGame),
  };
}

// ---------- Staffelwechsler ----------

export interface GroupChangeSeason {
  season: number;
  /** Vereine, die in beiden Saisons Regionalliga spielten */
  eligible: number;
  changers: { clubId: ClubId; from: string; to: string }[];
}

/**
 * Staffelwechsel von einer Saison zur direkt folgenden, nach Vereinsüberschneidung der Staffeln.
 * Wer zwischendurch auf- oder abgestiegen ist, spielte in einer der beiden Saisons nicht Regionalliga und zählt nicht.
 */
export function groupChangeSeasons(state: GameState): GroupChangeSeason[] {
  const ss = state.history.seasons;
  const out: GroupChangeSeason[] = [];
  for (let i = 1; i < ss.length; i++) {
    const prev = ss[i - 1].allocation;
    const cur = ss[i].allocation;
    if (!prev || !cur || ss[i - 1].season !== ss[i].season - 1) continue;
    const prevGroup: Record<ClubId, string> = {};
    for (const [g, l] of Object.entries(prev.groups)) for (const id of l) prevGroup[id] = g;
    const curGroup: Record<ClubId, string> = {};
    for (const [g, l] of Object.entries(cur.groups)) for (const id of l) curGroup[id] = g;
    out.push({
      season: ss[i].season,
      eligible: Object.keys(curGroup).filter((id) => prevGroup[id]).length,
      changers: groupChangers(prev.groups, cur.groups).map((id) => ({ clubId: id, from: prevGroup[id], to: curGroup[id] })),
    });
  }
  return out;
}

export function groupChangeClubs(state: GameState): { clubId: ClubId; changes: number; seasons: number[]; rlSeasons: number }[] {
  const rlSeasons = new Map<ClubId, number>();
  for (const r of state.history.clubSeasons) if (r.league.level === "RL") rlSeasons.set(r.clubId, (rlSeasons.get(r.clubId) ?? 0) + 1);
  const by = new Map<ClubId, number[]>();
  for (const s of groupChangeSeasons(state)) for (const c of s.changers) by.set(c.clubId, [...(by.get(c.clubId) ?? []), s.season]);
  return [...by.entries()]
    .map(([clubId, seasons]) => ({ clubId, changes: seasons.length, seasons, rlSeasons: rlSeasons.get(clubId) ?? 0 }))
    .sort((a, b) => b.changes - a.changes || a.rlSeasons - b.rlSeasons);
}

// ---------- Kennzahlen je Saison (wie im Evaluierungsbericht) ----------

export interface SeasonKpiRow {
  season: number;
  totalKm?: number;
  derbiesSplitWeight?: number;
  groupChanges?: number;
  strengthSpread?: number;
  revenue: number;
  avgAttendanceRL: number;
  acceptance: number;
  grade?: number;
  evaluation: boolean;
}

export function seasonKpis(state: GameState): SeasonKpiRow[] {
  const changes = new Map(groupChangeSeasons(state).map((s) => [s.season, s.changers.length]));
  const evals = new Set(state.history.evaluations.map((e) => e.season));
  return state.history.seasons.map((s) => ({
    season: s.season,
    totalKm: s.metrics?.totalKm,
    derbiesSplitWeight: s.metrics?.derbiesSplitWeight,
    // erste Saison ohne Vorjahr: kein Wert; sonst nach Vereinsüberschneidung neu berechnet
    groupChanges: changes.get(s.season),
    strengthSpread: s.metrics?.strengthSpread,
    revenue: s.revenue,
    avgAttendanceRL: s.avgAttendanceRL,
    acceptance: s.acceptance,
    grade: s.grade,
    evaluation: evals.has(s.season),
  }));
}

// ---------- Chronik ----------

export interface ChronicleMove {
  clubId: ClubId;
  movement: Movement;
  /** Ziel (Auf-/Absteiger) bzw. Herkunft (Neulinge) */
  league?: LeagueRef;
}

export interface ChronicleEntry {
  season: number;
  key: string;
  label: string;
  level: LeagueRef["level"];
  abstract: boolean;
  teams: number;
  champion?: { clubId: ClubId; pts: number; gf: number; ga: number };
  runnerUp?: { clubId: ClubId; pts: number };
  promoted: ChronicleMove[];
  relegated: ChronicleMove[];
  /** sportlich abgestiegen, aber als Nachrücker in der Liga geblieben */
  reinstated: ChronicleMove[];
  newcomers: ChronicleMove[];
  bestAttack?: { clubId: ClubId; gf: number };
  bestDefense?: { clubId: ClubId; ga: number };
  goalsPerGame?: number;
  avgAttendance?: number;
  topAttendance?: { clubId: ClubId; value: number };
  totalKm?: number;
  groupChangersIn?: number;
  playoffs: { name: string; winner?: ClubId; text: string }[];
}

const DOWN: Movement[] = ["RELEGATED", "FORCED_RELEGATION", "LICENSE_DENIED", "WITHDRAWN", "INSOLVENT"];

/** Chronik: je Saison und Liga (3. Liga, RL-Staffeln, Oberligen) die wichtigsten Ergebnisse */
export function chronicle(state: GameState): ChronicleEntry[] {
  const byKey = new Map<string, ClubSeasonRecord[]>();
  const recOf = new Map<string, ClubSeasonRecord>();
  for (const r of state.history.clubSeasons) {
    recOf.set(`${r.season}|${r.clubId}`, r);
    if (!["RL", "L3", "OL"].includes(r.league.level)) continue;
    const k = `${r.season}|${compKey(r.league)}`;
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  const changes = new Map(groupChangeSeasons(state).map((s) => [s.season, s]));
  const summaries = new Map(state.history.seasons.map((s) => [s.season, s]));
  const out: ChronicleEntry[] = [];
  for (const recs of byKey.values()) {
    const season = recs[0].season;
    const ref = recs[0].league;
    const key = compKey(ref);
    const table = recs.filter((r) => r.rank > 0).sort((a, b) => a.rank - b.rank);
    const real = recs.filter((r) => !r.abstract);
    const abstract = real.length === 0;
    // Ziel einer Bewegung: die Liga der Folgesaison (mit Staffel), sonst die beim Saisonabschluss vermerkte
    const dest = (r: ClubSeasonRecord) => recOf.get(`${season + 1}|${r.clubId}`)?.league ?? r.nextLeague;
    const newcomers: ChronicleMove[] = [];
    for (const r of recs) {
      const p = recOf.get(`${season - 1}|${r.clubId}`);
      if (p && p.league.level !== ref.level) newcomers.push({ clubId: r.clubId, movement: p.movement, league: p.league });
    }
    const games = real.reduce((a, r) => a + r.played, 0) / 2;
    const att = real.filter((r) => r.avgAttendance > 0);
    const sum = summaries.get(season);
    const ids = new Set(recs.map((r) => r.clubId));
    const name = (id: ClubId) => state.clubs[id]?.shortName ?? id;
    const playoffs = [
      ...(sum?.playoffs ?? []).filter((t) => ids.has(t.a) || ids.has(t.b)).map((t) => ({ name: t.name, winner: t.winner, text: `${name(t.a)} – ${name(t.b)}` })),
      ...(sum?.promotionRounds ?? [])
        .filter((pr) => pr.table.some((row) => ids.has(row.clubId)))
        .map((pr) => ({ name: pr.name, winner: pr.promoted[0], text: pr.table.map((row) => name(row.clubId)).join(", ") })),
    ];
    const top = (f: (r: ClubSeasonRecord) => number) => (real.length ? [...real].sort((a, b) => f(b) - f(a))[0] : undefined);
    const atk = top((r) => r.gf);
    const def = top((r) => -r.ga);
    const topAtt = att.length ? [...att].sort((a, b) => b.avgAttendance - a.avgAttendance)[0] : undefined;
    const gc = ref.level === "RL" ? changes.get(season) : undefined;
    out.push({
      season,
      key,
      label: leagueLabel(ref, state),
      level: ref.level,
      abstract,
      teams: recs.length,
      champion: table[0] && { clubId: table[0].clubId, pts: table[0].pts, gf: table[0].gf, ga: table[0].ga },
      runnerUp: table[1] && { clubId: table[1].clubId, pts: table[1].pts },
      promoted: table.filter((r) => r.movement === "PROMOTED").map((r) => ({ clubId: r.clubId, movement: r.movement, league: dest(r) })),
      relegated: recs.filter((r) => DOWN.includes(r.movement)).sort((a, b) => a.rank - b.rank).map((r) => ({ clubId: r.clubId, movement: r.movement, league: dest(r) })),
      reinstated: table.filter((r) => r.movement === "REINSTATED").map((r) => ({ clubId: r.clubId, movement: r.movement })),
      newcomers,
      bestAttack: atk && !abstract ? { clubId: atk.clubId, gf: atk.gf } : undefined,
      bestDefense: def && !abstract ? { clubId: def.clubId, ga: def.ga } : undefined,
      goalsPerGame: games ? real.reduce((a, r) => a + r.gf, 0) / games : undefined,
      avgAttendance: att.length ? att.reduce((a, r) => a + r.avgAttendance, 0) / att.length : undefined,
      topAttendance: topAtt && { clubId: topAtt.clubId, value: topAtt.avgAttendance },
      totalKm: abstract ? undefined : real.reduce((a, r) => a + r.travelKm, 0),
      groupChangersIn: gc ? gc.changers.filter((c) => `RL-${c.to}` === key).length : undefined,
      playoffs,
    });
  }
  const order = (e: ChronicleEntry) => (e.level === "L3" ? 0 : e.level === "RL" ? 1 : 2);
  return out.sort((a, b) => b.season - a.season || order(a) - order(b) || a.label.localeCompare(b.label, "de"));
}
