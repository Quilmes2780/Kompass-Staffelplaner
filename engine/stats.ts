// Auswertungen über die Historie: Ewige Tabelle, Rekorde, Vereinsprofile, Dashboard-Reihen.
import type { ClubId, ClubSeasonRecord, Competition, GameState, SeasonSummary } from "./types";

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

export function eternalTable(state: GameState): EternalRow[] {
  const rows = new Map<ClubId, EternalRow>();
  for (const r of state.history.clubSeasons) {
    if (r.league.level !== "RL") continue;
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
