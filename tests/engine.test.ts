import { describe, expect, it } from "vitest";
import { KOMPASS_RULES, MODEL_22_5_RULES, totalQuota } from "../config/rules";
import { groupChangers } from "../engine/allocation/matching";
import { computeMetrics } from "../engine/allocation/metrics";
import { optimizeAllocation, randomAllocation } from "../engine/allocation/optimizer";
import { autoAdvance, beginAllocation, finishSeason, metricsFor, newGame, publishAllocation, simulate } from "../engine/game";
import { distanceMatrixFor } from "../engine/geo";
import { checkLeagueInvariants, rlClubs } from "../engine/leagues";
import { createRng } from "../engine/rng";
import { chronicle, eternalTable, groupChangeSeasons, seasonKpis } from "../engine/stats";
import { computeTable, doubleRoundRobin } from "../engine/schedule";
import type { Allocation, GameState } from "../engine/types";

function allocate(s: GameState, seed = 1): Allocation {
  return optimizeAllocation({
    clubs: rlClubs(s.leagues),
    clubData: s.clubs,
    derbies: s.derbies,
    dm: distanceMatrixFor(s.clubs, s.rules.allocation.roadFactor),
    rules: s.rules,
    seed,
  });
}

function expectValidPartition(a: Allocation, clubs: string[], groups = 4, size = 20) {
  expect(Object.keys(a.groups)).toHaveLength(groups);
  for (const list of Object.values(a.groups)) expect(list).toHaveLength(size);
  const all = Object.values(a.groups).flat();
  expect(new Set(all).size).toBe(groups * size);
  expect([...all].sort()).toEqual([...clubs].sort());
}

describe("Spielplan und Tabelle", () => {
  it("Doppelrunde: jeder spielt zweimal gegen jeden, je einmal zu Hause", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const fx = doubleRoundRobin(ids, createRng(1));
    expect(fx).toHaveLength(380);
    const pairs = new Set(fx.map((f) => `${f.home}>${f.away}`));
    expect(pairs.size).toBe(380);
    for (let md = 1; md <= 38; md++) {
      const day = fx.filter((f) => f.matchday === md);
      expect(day).toHaveLength(10);
      expect(new Set(day.flatMap((f) => [f.home, f.away])).size).toBe(20);
    }
  });
  it("Tabelle sortiert nach Punkten, Tordifferenz, Toren", () => {
    const t = computeTable(["a", "b", "c"], [
      { home: "a", away: "b", matchday: 1, hg: 2, ag: 0 },
      { home: "b", away: "c", matchday: 2, hg: 3, ag: 0 },
      { home: "c", away: "a", matchday: 3, hg: 1, ag: 0 },
    ]);
    expect(t.map((r) => r.clubId)).toEqual(["b", "a", "c"]);
    expect(t[0].pts).toBe(3);
  });
});

describe("Staffeleinteilung (Optimierer)", () => {
  const s = newGame({ seed: 11 });
  const clubs = rlClubs(s.leagues);
  const dm = distanceMatrixFor(s.clubs, 1.25);
  const km = (a: Allocation) =>
    computeMetrics({ allocation: a, expectedClubs: clubs, clubs: s.clubs, derbies: s.derbies, dm, rules: s.rules }).totalKm;

  it("erzeugt exakt 4×20 Teams ohne Lücken und Dubletten", () => {
    expect(clubs).toHaveLength(80);
    expectValidPartition(allocate(s), clubs);
  });
  it("ist bei gleichem Seed deterministisch", () => {
    expect(allocate(s, 5)).toEqual(allocate(s, 5));
  });
  it("schlägt zufällige Einteilungen deutlich bei den Gesamt-km", () => {
    const opt = km(allocate(s));
    const rnd = Array.from({ length: 5 }, (_, i) => km(randomAllocation(clubs, s.rules, createRng(i))));
    for (const r of rnd) expect(opt).toBeLessThan(r * 0.6);
  });
  it("Kompass-Rotation liefert ebenfalls gültige Partitionen", () => {
    for (const start of ["N", "O", "S", "W"] as const) {
      const a = optimizeAllocation({ clubs, clubData: s.clubs, derbies: s.derbies, dm, rules: s.rules, seed: 1, mode: "COMPASS", compassStart: start });
      expectValidPartition(a, clubs);
    }
  });
  it("respektiert fixierte Vereine", () => {
    const fixed = { [clubs[0]]: "West", [clubs[1]]: "West", [clubs[2]]: "Nord" };
    const a = optimizeAllocation({ clubs, clubData: s.clubs, derbies: s.derbies, dm, rules: s.rules, seed: 2, fixed });
    expectValidPartition(a, clubs);
    expect(a.groups.West).toContain(clubs[0]);
    expect(a.groups.West).toContain(clubs[1]);
    expect(a.groups.Nord).toContain(clubs[2]);
  });
  it("benennt die Staffeln nach ihrer Lage (Nord, Ost, Süd, West)", () => {
    const a = allocate(s);
    const mean = (g: string, k: "lat" | "lon") => a.groups[g].reduce((x, id) => x + s.clubs[id][k], 0) / a.groups[g].length;
    expect(Object.keys(a.groups).sort()).toEqual(["Nord", "Ost", "Süd", "West"]);
    expect(mean("Nord", "lat")).toBeGreaterThan(mean("Süd", "lat"));
    expect(mean("Ost", "lon")).toBeGreaterThan(mean("West", "lon"));
  });
  it("zählt Staffelwechsel nach Vereinsüberschneidung, nicht nach Bezeichnung", () => {
    const prev = allocate(s);
    const renamed: Allocation = { groups: { Nord: prev.groups.Ost, Ost: prev.groups.Süd, Süd: prev.groups.West, West: prev.groups.Nord }, fixed: [] };
    expect(groupChangers(prev.groups, renamed.groups)).toEqual([]);
    const moved: Allocation = structuredClone(renamed);
    const a = moved.groups.Nord.pop()!;
    const b = moved.groups.Ost.pop()!;
    moved.groups.Nord.push(b);
    moved.groups.Ost.push(a);
    expect(groupChangers(prev.groups, moved.groups).sort()).toEqual([a, b].sort());
    expect(computeMetrics({ allocation: moved, previous: prev, expectedClubs: clubs, clubs: s.clubs, derbies: s.derbies, dm, rules: s.rules }).groupChanges).toBe(2);
  });
  it("Neuoptimierung mit Härtefällen behält die Staffeln des Vorjahres im Wesentlichen bei", () => {
    const prev = allocate(s, 1);
    // gewährte Härtefälle: je ein Verein aus Nord und Süd soll in die Staffel Ost
    const fixed = { [prev.groups.Nord[0]]: "Ost", [prev.groups.Süd[0]]: "Ost", [prev.groups.West[0]]: "West" };
    const a = optimizeAllocation({ clubs, clubData: s.clubs, derbies: s.derbies, dm, rules: s.rules, seed: 9, fixed, previous: prev });
    expect(a.groups.Ost).toContain(prev.groups.Nord[0]);
    const m = computeMetrics({ allocation: a, previous: prev, expectedClubs: clubs, clubs: s.clubs, derbies: s.derbies, dm, rules: s.rules });
    expect(m.groupChanges).toBeLessThan(15);
    // Bezeichnungen folgen den Vereinen: mehr als die Hälfte jeder Staffel stammt aus der gleichnamigen Vorjahresstaffel
    for (const g of Object.keys(a.groups)) expect(a.groups[g].filter((id) => prev.groups[g].includes(id)).length).toBeGreaterThan(10);
  });
  it("hält die Zweitvertretungs-Grenze ein", () => {
    const a = allocate(s);
    for (const list of Object.values(a.groups)) expect(list.filter((id) => s.clubs[id].isReserve).length).toBeLessThanOrEqual(7);
  });
  it("eine ungültige Einteilung lässt sich nicht veröffentlichen und nennt die Regel", () => {
    let g = newGame({ seed: 3 });
    const w = g.allocationDraft!.working;
    const moved = w.groups.Nord.pop()!;
    w.groups.Ost.push(moved);
    expect(metricsFor(g, w).violations.map((v) => v.rule)).toContain("Staffelgröße");
    expect(() => publishAllocation(g)).toThrow(/Staffelgröße/);
    g = newGame({ seed: 3 });
    expect(() => publishAllocation(g)).not.toThrow();
  });
});

describe("Saisonsimulation und Auf-/Abstieg", () => {
  it("Kontingente der 5. Ebene summieren sich zu den RL-Absteigern", () => {
    expect(totalQuota(KOMPASS_RULES)).toBe(16);
    expect(totalQuota(MODEL_22_5_RULES)).toBe(15);
  });

  it("erhält Ligagrößen und Kontingente in jeder Saison (10 Saisons)", () => {
    let s = newGame({ seed: 21 });
    expect(checkLeagueInvariants({ ...s, leagues: { ...s.leagues } })).toEqual([]);
    for (let i = 0; i < 10; i++) {
      s = autoAdvance(s);
      expect(checkLeagueInvariants(s)).toEqual([]);
      const sum = s.history.seasons[s.history.seasons.length - 1];
      expect(sum.promotedToL3.length).toBeLessThanOrEqual(4);
      expect(sum.relegatedFromL3.length).toBe(sum.promotedToL3.length);
      expect(sum.relegatedFromRL).toHaveLength(16);
      // Kontingente: höchstens die Quote je Gebiet (Ausfälle werden über Nachrücker ausgeglichen)
      const perGebiet: Record<string, number> = {};
      for (const id of sum.promotedFromOL) perGebiet[s.clubs[id].gebiet] = (perGebiet[s.clubs[id].gebiet] ?? 0) + 1;
      expect(perGebiet.WEST ?? 0).toBeLessThanOrEqual(4);
      expect(perGebiet.SUEDWEST ?? 0).toBeLessThanOrEqual(4);
      expect(perGebiet.NORD ?? 0).toBeLessThanOrEqual(3);
      expect((perGebiet.BAYERN ?? 0) + (perGebiet.NORDOST ?? 0)).toBeLessThanOrEqual(5);
      expect(perGebiet.BAYERN ?? 0).toBeLessThanOrEqual(3);
      expect(perGebiet.NORDOST ?? 0).toBeLessThanOrEqual(3);
    }
  });

  it("hält die Kontingente exakt ein, wenn alle Berechtigten zugelassen sind", () => {
    // Stadien und Etats großzügig setzen → kein Verzicht, keine Nachrücker
    let s = newGame({ seed: 5 });
    for (const c of Object.values(s.clubs)) {
      c.stadium = { capacity: 12000, seats: 2000, lux: 800, pressSeats: 20 };
      c.budget = Math.max(c.budget, 2_500_000);
    }
    s = publishAllocation(s);
    s = simulate(s, "SEASON");
    // Insolvenzen ausschließen
    s.rules.specialCases.insolvencyBaseRate = 0;
    s.rules.specialCases.withdrawalBaseRate = 0;
    s = finishSeason(s);
    const sum = s.history.seasons[0];
    const perGebiet: Record<string, number> = {};
    for (const id of sum.promotedFromOL) perGebiet[s.clubs[id].gebiet] = (perGebiet[s.clubs[id].gebiet] ?? 0) + 1;
    expect(sum.promotedFromOL).toHaveLength(16);
    expect(perGebiet.WEST).toBe(4);
    expect(perGebiet.SUEDWEST).toBe(4);
    expect(perGebiet.NORD).toBe(3);
    expect(perGebiet.BAYERN + perGebiet.NORDOST).toBe(5);
    expect([2, 3]).toContain(perGebiet.BAYERN);
    expect(sum.playoffs.some((p) => p.name.includes("Bayern/Nordost"))).toBe(true);
  });

  it("Zweitvertretung steigt zwangsweise ab, wenn der Profiverein in die 3. Liga fällt", () => {
    let s = newGame({ seed: 8 });
    // Bayern II in die 3. Liga setzen, den FC Bayern in die 2. Liga tauschen und schwächen
    const reserve = "fcb2";
    const parent = "fcb";
    const l3Club = s.leagues.L3.find((id) => !s.clubs[id].isReserve)!;
    // Bayern II mit einem Drittligisten tauschen – egal, ob sie zum Start in der RL oder einer Oberliga stehen
    const swapIn = (ids: string[]) => ids.map((x) => (x === reserve ? l3Club : x));
    s.leagues.RL.POOL = swapIn(s.leagues.RL.POOL);
    for (const k of Object.keys(s.leagues.OL)) s.leagues.OL[k] = swapIn(s.leagues.OL[k]);
    s.leagues.L3 = [...s.leagues.L3.filter((x) => x !== l3Club), reserve];
    s.clubs[parent].strength = 1;
    s.clubs[reserve].strength = 95; // sportlich sicher
    if (s.leagues.BL.includes(parent)) {
      const swap = s.leagues.BL2[0];
      s.leagues.BL = [...s.leagues.BL.filter((x) => x !== parent), swap];
      s.leagues.BL2 = [...s.leagues.BL2.filter((x) => x !== swap), parent];
    }
    beginAllocation(s);
    s = publishAllocation(s);
    s = simulate(s, "SEASON");
    s = finishSeason(s);
    expect(s.leagues.L3).toContain(parent);
    expect(s.leagues.L3).not.toContain(reserve);
    const rec = s.history.clubSeasons.find((r) => r.clubId === reserve && r.season === 2028)!;
    expect(rec.movement).toBe("FORCED_RELEGATION");
    expect(checkLeagueInvariants(s)).toEqual([]);
  });

  it("22/5-Modell läuft mit 5 Staffeln à 18", () => {
    let s = newGame({ seed: 4, rules: MODEL_22_5_RULES });
    expect(rlClubs(s.leagues)).toHaveLength(90);
    expectValidPartition(s.allocationDraft!.working, rlClubs(s.leagues), 5, 18);
    for (let i = 0; i < 3; i++) s = autoAdvance(s);
    expect(checkLeagueInvariants(s)).toEqual([]);
  });

  it("Fiktive Welt ist spielbar", () => {
    let s = newGame({ seed: 4, world: "FICTIONAL" });
    for (let i = 0; i < 3; i++) s = autoAdvance(s);
    expect(checkLeagueInvariants(s)).toEqual([]);
  });

  it("gleicher Seed + gleiche Entscheidungen = identisches Ergebnis", () => {
    const run = () => {
      let s = newGame({ seed: 99 });
      for (let i = 0; i < 3; i++) s = autoAdvance(s);
      return s;
    };
    expect(run()).toEqual(run());
  });
});

describe("Oberligen-Simulation und Statistiken", () => {
  let s = newGame({ seed: 77 });
  for (let i = 0; i < 4; i++) s = autoAdvance(s);
  const seasons = s.history.seasons.map((x) => x.season);

  it("spielt die Oberligen Spiel für Spiel, über die ganze Saison verteilt", () => {
    let g = newGame({ seed: 5 });
    g = publishAllocation(g);
    const ol = Object.values(g.competitions).filter((c) => c.level === "OL");
    expect(ol).toHaveLength(g.oberligen.length);
    g = simulate(g, "WEEK");
    g = simulate(g, "WEEK");
    // nach einigen Spieltagen haben alle Ligen gespielt, die kleinen Oberligen aber noch nicht fertig
    for (const c of Object.values(g.competitions)) {
      expect(c.played).toBeGreaterThan(0);
      expect(c.played).toBeLessThan(c.matchdays);
    }
    g = simulate(g, "SEASON");
    for (const c of Object.values(g.competitions)) expect(c.played).toBe(c.matchdays);
    const recs = s.history.clubSeasons.filter((r) => r.league.level === "OL");
    expect(recs.length).toBeGreaterThan(100);
    expect(recs.every((r) => !r.abstract && r.played > 0)).toBe(true);
  });
  it("ewige Tabelle je Staffel, 3. Liga und Oberliga", () => {
    const rl = eternalTable(s, "RL");
    const nord = eternalTable(s, "RL-Nord");
    expect(nord.length).toBeGreaterThan(19);
    expect(nord.length).toBeLessThan(rl.length);
    expect(eternalTable(s, "L3").length).toBeGreaterThanOrEqual(20);
    const ol = s.oberligen[0].id;
    const t = eternalTable(s, ol);
    expect(t.length).toBeGreaterThan(5);
    const ids = new Set(s.history.clubSeasons.filter((r) => r.league.level === "OL" && r.league.group === ol).map((r) => r.clubId));
    expect(t.every((r) => ids.has(r.clubId))).toBe(true);
  });
  it("Staffelwechsler zählen nur Vereine, die in beiden Saisons Regionalliga spielten", () => {
    const gc = groupChangeSeasons(s);
    expect(gc.map((x) => x.season)).toEqual(seasons.slice(1));
    for (const x of gc) {
      const prev = new Set(s.history.clubSeasons.filter((r) => r.season === x.season - 1 && r.league.level === "RL").map((r) => r.clubId));
      for (const c of x.changers) expect(prev.has(c.clubId)).toBe(true);
      // gleiche Zahl wie in den Einteilungskennzahlen der Saison
      expect(x.changers.length).toBe(s.history.seasons.find((h) => h.season === x.season)!.metrics!.groupChanges);
    }
    const flagged = s.history.clubSeasons.filter((r) => r.groupChanged).length;
    expect(flagged).toBe(gc.reduce((a, x) => a + x.changers.length, 0));
  });
  it("Kennzahlen je Saison und Chronik", () => {
    const k = seasonKpis(s);
    expect(k.map((r) => r.season)).toEqual(seasons);
    expect(k[0].groupChanges).toBeUndefined();
    const last = seasons[seasons.length - 1];
    const entries = chronicle(s).filter((e) => e.season === last);
    // 4 Staffeln + 3. Liga + alle Oberligen
    expect(entries).toHaveLength(4 + 1 + s.oberligen.length);
    const sum = s.history.seasons[s.history.seasons.length - 1];
    for (const e of entries.filter((x) => x.level === "RL")) {
      expect(e.champion?.clubId).toBe(sum.champions[e.key]);
      // Absteiger plus Nachrücker (bester Absteiger bleibt drin) = Abstiegsplätze
      expect(e.relegated.length + e.reinstated.length).toBeGreaterThanOrEqual(s.rules.rl.relegatedPerGroup);
      expect(e.goalsPerGame).toBeGreaterThan(1.5);
    }
    const l3 = entries.find((e) => e.level === "L3")!;
    expect(l3.promoted.map((m) => m.league?.level)).toEqual(["BL2", "BL2", "BL2"].slice(0, l3.promoted.length));
    // Neulinge der Folgesaison = Absteiger/Aufsteiger der Vorsaison
    const prevL3 = chronicle(s).find((e) => e.season === last - 1 && e.level === "L3")!;
    expect(new Set(l3.newcomers.map((m) => m.clubId)).size).toBe(l3.newcomers.length);
    expect(prevL3.relegated.every((m) => m.league?.level === "RL" || m.league?.level === "OL")).toBe(true);
  });
});

describe("Headless-Langlauf", () => {
  it("30 Saisons ohne Fehler, plausible Tor- und Punkteverteilungen, lückenlose Historie", () => {
    let s = newGame({ seed: 2026 });
    const goals: number[] = [];
    const home: number[] = [];
    for (let i = 0; i < 30 && s.phase !== "GAME_OVER"; i++) {
      s = autoAdvance(s);
      const sum = s.history.seasons[s.history.seasons.length - 1];
      goals.push(sum.goalsPerGame);
      home.push(sum.homeWinRate);
      expect(checkLeagueInvariants(s)).toEqual([]);
      // Punkte des Meisters / Letzten plausibel
      for (const [k, t] of Object.entries(sum.tables)) {
        if (!k.startsWith("RL-")) continue;
        expect(t[0].pts).toBeGreaterThan(55);
        expect(t[0].pts).toBeLessThan(100);
        expect(t[t.length - 1].pts).toBeLessThan(45);
      }
    }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(goals)).toBeGreaterThan(2.8);
    expect(avg(goals)).toBeLessThan(3.2);
    expect(avg(home)).toBeGreaterThan(0.41);
    expect(avg(home)).toBeLessThan(0.49);
    // Lückenlose Historie: jeder Verein hat ab seiner ersten Saison einen Eintrag pro Saison
    const seasons = s.history.seasons.map((x) => x.season);
    const bySeason = new Map<string, Set<number>>();
    for (const r of s.history.clubSeasons) {
      if (!bySeason.has(r.clubId)) bySeason.set(r.clubId, new Set());
      bySeason.get(r.clubId)!.add(r.season);
    }
    for (const [id, set] of bySeason) {
      const first = Math.min(...set);
      for (const y of seasons) if (y >= first) expect(set.has(y), `${id} fehlt ${y}`).toBe(true);
    }
  });
});
