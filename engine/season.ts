// Saisonsimulation der voll simulierten Ligen (3. Liga, Regionalliga-Staffeln, Oberligen).
// Ligen mit weniger Spieltagen (Oberligen) verteilen ihre Spieltage gleichmäßig über die Saison.
import { distanceMatrixFor } from "./geo";
import { formValue, simulateMatch } from "./match";
import { rngFor } from "./rng";
import { computeTable, doubleRoundRobin, weekCalendar } from "./schedule";
import type { ClubId, Competition, Derby, Fixture, GameState, TableRow } from "./types";

export function derbyIndex(derbies: Derby[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of derbies) m.set(pairKey(d.a, d.b), d.weight);
  return m;
}

export function pairKey(a: ClubId, b: ClubId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Wettbewerbe der neuen Saison anlegen (Spielpläne), Saisonstatistiken zurücksetzen */
export function startSeason(state: GameState): void {
  const comps: Record<string, Competition> = {};
  const mk = (id: string, level: "L3" | "RL" | "OL", group: string, clubs: ClubId[]) => {
    if (clubs.length < 2) return;
    const fixtures = doubleRoundRobin(clubs, rngFor(state.seed, state.season, "schedule", id));
    comps[id] = { id, level, group, clubs: [...clubs], fixtures, matchdays: (clubs.length - (clubs.length % 2 === 0 ? 1 : 0)) * 2, played: 0 };
  };
  mk("L3", "L3", "L3", state.leagues.L3);
  for (const [g, clubs] of Object.entries(state.leagues.RL)) mk(`RL-${g}`, "RL", g, clubs);
  for (const o of state.oberligen) mk(o.id, "OL", o.id, state.leagues.OL[o.id] ?? []);
  state.competitions = comps;
  state.seasonStats = {};
  for (const c of Object.values(comps))
    for (const id of c.clubs)
      state.seasonStats[id] = { travelKm: 0, awayGames: 0, attendanceSum: 0, homeGames: 0, derbies: 0, income: { guarantee: 0, distribution: 0, other: 0 } };
}

export function seasonMatchdays(state: GameState): number {
  return Math.max(0, ...Object.values(state.competitions).map((c) => c.matchdays));
}

/** Spieltage, die ein Wettbewerb bis zum Saison-Spieltag md gespielt haben soll */
function targetPlayed(c: Competition, md: number, max: number): number {
  return Math.min(c.matchdays, Math.ceil((md * c.matchdays) / max));
}

/** Saison-Spieltag (gemessen an der Liga mit den meisten Spieltagen) */
export function currentMatchday(state: GameState): number {
  const max = seasonMatchdays(state);
  return Math.min(...Object.values(state.competitions).map((c) => (c.played >= c.matchdays ? max : Math.floor((c.played * max) / c.matchdays))));
}

export function isSeasonComplete(state: GameState): boolean {
  return Object.values(state.competitions).every((c) => c.played >= c.matchdays);
}

/** Aktuelle Tabelle eines Wettbewerbs */
export function competitionTable(state: GameState, compId: string): TableRow[] {
  const c = state.competitions[compId];
  return computeTable(c.clubs, c.fixtures, state.seed + state.season);
}

/** Simuliert die nächsten n Saison-Spieltage aller Wettbewerbe. */
export function playMatchdays(state: GameState, n: number): void {
  const dm = distanceMatrixFor(state.clubs, state.rules.allocation.roadFactor);
  const derbies = derbyIndex(state.derbies);
  const max = seasonMatchdays(state);
  const start = currentMatchday(state);
  for (let md = start + 1; md <= Math.min(max, start + n); md++)
    for (const comp of Object.values(state.competitions))
      while (comp.played < targetPlayed(comp, md, max)) playRound(state, comp, dm, derbies);
}

function playRound(state: GameState, comp: Competition, dm: ReturnType<typeof distanceMatrixFor>, derbies: Map<string, number>): void {
  const md = comp.played + 1;
  const table = computeTable(comp.clubs, comp.fixtures);
  const form: Record<ClubId, number> = {};
  const rank: Record<ClubId, number> = {};
  table.forEach((r, i) => {
    form[r.clubId] = formValue(r.form);
    rank[r.clubId] = i + 1;
  });
  for (const f of comp.fixtures) {
    if (f.matchday !== md) continue;
    playFixture(state, comp, f, dm.get(f.home, f.away), derbies.get(pairKey(f.home, f.away)) ?? 0, form, rank);
  }
  comp.played = md;
}

/** Nächste Kalenderwoche (1 oder 2 Spieltage, englische Wochen) */
export function playWeek(state: GameState): void {
  const md = currentMatchday(state) + 1;
  const week = weekCalendar(seasonMatchdays(state)).find((w) => w.includes(md));
  playMatchdays(state, week ? week.length : 1);
}

export function playToEnd(state: GameState): void {
  playMatchdays(state, seasonMatchdays(state) - currentMatchday(state));
}

function playFixture(
  state: GameState,
  comp: Competition,
  f: Fixture,
  km: number,
  derby: number,
  form: Record<ClubId, number>,
  rank: Record<ClubId, number>,
): void {
  const h = state.clubs[f.home];
  const a = state.clubs[f.away];
  const rng = rngFor(state.seed, state.season, comp.id, f.matchday, f.home);
  const [hg, ag] = simulateMatch(
    { homeStrength: h.strength, awayStrength: a.strength, distanceKm: km, derbyWeight: derby, homeForm: form[f.home] ?? 0, awayForm: form[f.away] ?? 0 },
    state.rules.match,
    rng,
  );
  f.hg = hg;
  f.ag = ag;
  // Zuschauer
  const size = comp.clubs.length;
  let base = h.fanPotential * (comp.level === "L3" ? 1.45 : 1);
  base *= 1.12 - 0.25 * ((rank[f.home] ?? size / 2) / size);
  if (derby) base *= 1 + 0.3 * derby;
  if ((rank[f.home] ?? 99) <= 3 && (rank[f.away] ?? 99) <= 3 && f.matchday > 5) base *= 1.25;
  base += (a.fanPotential * 0.1) / (1 + km / 150);
  base *= Math.exp(rng.normal(0, 0.15));
  const att = Math.max(50, Math.min(h.stadium.capacity, Math.round(base)));
  f.attendance = att;
  const hs = state.seasonStats[f.home];
  const as = state.seasonStats[f.away];
  if (hs) {
    hs.homeGames++;
    hs.attendanceSum += att;
    hs.income.other += att * state.rules.finance.ticketPrice;
    if (derby) hs.derbies++;
  }
  if (as) {
    as.awayGames++;
    as.travelKm += 2 * km;
    if (derby) as.derbies++;
  }
}

/** Kennzahlen einer abgeschlossenen Saison über alle voll simulierten Spiele */
export function matchStats(comps: Competition[]): { goalsPerGame: number; homeWinRate: number; drawRate: number; games: number } {
  let games = 0;
  let goals = 0;
  let hw = 0;
  let dr = 0;
  for (const c of comps)
    for (const f of c.fixtures) {
      if (f.hg === undefined) continue;
      games++;
      goals += f.hg + f.ag!;
      if (f.hg > f.ag!) hw++;
      else if (f.hg === f.ag) dr++;
    }
  return { goalsPerGame: games ? goals / games : 0, homeWinRate: games ? hw / games : 0, drawRate: games ? dr / games : 0, games };
}
