// Evaluierung alle 3 Saisons, Saisonnote, Score, Achievements.
import { acceptance } from "./stakeholders";
import type { EvaluationReport, GameState, SeasonSummary } from "./types";

export function evaluationDue(state: GameState): boolean {
  const n = state.season - state.rules.startSeason + 1;
  return n > 0 && n % state.rules.evaluation.intervalSeasons === 0;
}

export function buildEvaluation(state: GameState): EvaluationReport {
  const seasons = state.history.seasons.slice(-state.rules.evaluation.intervalSeasons);
  const prev = state.history.seasons.slice(-2 * state.rules.evaluation.intervalSeasons, -state.rules.evaluation.intervalSeasons);
  const avg = (xs: SeasonSummary[], f: (s: SeasonSummary) => number) => (xs.length ? xs.reduce((a, s) => a + f(s), 0) / xs.length : 0);
  const trend = (key: string, label: string, f: (s: SeasonSummary) => number) => {
    const v = avg(seasons, f);
    return { key, label, value: Math.round(v * 10) / 10, delta: prev.length ? Math.round((v - avg(prev, f)) * 10) / 10 : 0 };
  };
  const acc = acceptance(state);
  const trends = [
    trend("km", "Ø Gesamt-Reise-km", (s) => s.metrics?.totalKm ?? 0),
    trend("derbySplit", "Ø getrennte Derbys (gewichtet)", (s) => s.metrics?.derbiesSplitWeight ?? 0),
    trend("changes", "Ø Staffelwechsler", (s) => s.metrics?.groupChanges ?? 0),
    trend("balance", "Leistungsstreuung der Staffeln", (s) => s.metrics?.strengthSpread ?? 0),
    trend("revenue", "Ø Vermarktungserlös (€)", (s) => s.revenue),
    trend("attendance", "Ø Zuschauer Regionalliga", (s) => s.avgAttendanceRL),
    trend("acceptance", "Akzeptanz", (s) => s.acceptance),
  ];
  const criticism: string[] = [];
  const t = Object.fromEntries(trends.map((x) => [x.key, x]));
  if (t.derbySplit.value > 6) criticism.push("Zu viele traditionsreiche Derbys wurden getrennt.");
  if (t.changes.value > 18) criticism.push("Die jährlichen Staffelwechsel gefährden die Planungssicherheit der Vereine.");
  if (t.km.delta > 0 && prev.length) criticism.push("Die Reisebelastung ist gegenüber dem Vorzeitraum gestiegen.");
  if (state.finance.dfbReserve < 0) criticism.push("Der DFB musste die Garantien aus Rücklagen finanzieren – die Reserve ist aufgebraucht.");
  if (state.courtCases.filter((c) => c.season > state.season - 3).length >= 2) criticism.push("Mehrere Sportgerichtsverfahren beschädigen das Zulassungsverfahren.");
  if (state.precedents.filter((p) => p.kind === "EXEMPTION" && p.season > state.season - 3).length >= 4)
    criticism.push("Die Zahl der Ausnahmegenehmigungen untergräbt die Zulassungsstandards.");
  for (const k of ["BFV", "NOFV", "NFV", "WDFV", "SW"]) if (state.satisfaction[k] < 40) criticism.push(`Der Regionalverband ${k} stellt die Reform offen infrage.`);
  if (!criticism.length) criticism.push("Keine wesentlichen Kritikpunkte – das Kompassmodell gilt als etabliert.");
  return { season: state.season, acceptance: acc, trends, criticism, motionFiled: acc < state.rules.evaluation.acceptanceThreshold };
}

/** Saisonnote 1,0 (sehr gut) – 5,0 (mangelhaft) */
export function seasonGrade(s: SeasonSummary): number {
  const m = s.metrics;
  let pts = 0;
  pts += Math.min(30, s.acceptance * 0.4);
  if (m) {
    pts += Math.max(0, 25 - m.derbiesSplitWeight * 1.5);
    pts += Math.max(0, 15 - m.groupChanges * 0.5);
    pts += Math.max(0, 15 - Math.max(0, m.giniKm - 0.12) * 100);
    pts += m.violations.length ? 0 : 5;
  }
  pts += s.specialCases.length < 4 ? 10 : 5;
  const grade = 5 - (pts / 100) * 4;
  return Math.round(Math.max(1, Math.min(5, grade)) * 10) / 10;
}

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  check: (state: GameState, s: SeasonSummary) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "NO_SPLIT", title: "Derby-Hüter", description: "Eine Saison ohne getrennte Derbys.", check: (_g, s) => !!s.metrics && s.metrics.derbiesSplit === 0 },
  { id: "LOW_KM", title: "Kurze Wege", description: "Unter 520.000 Gesamt-Reise-km in einer Saison.", check: (_g, s) => !!s.metrics && s.metrics.totalKm < 520_000 },
  { id: "STABLE", title: "Planungssicherheit", description: "Höchstens 5 Staffelwechsler.", check: (g, s) => !!s.metrics && g.history.seasons.length > 1 && s.metrics.groupChanges <= 5 },
  { id: "FAIR", title: "Fair verteilt", description: "Gini der Reisewege unter 0,12.", check: (_g, s) => !!s.metrics && s.metrics.giniKm < 0.12 },
  { id: "COURT_FREE_10", title: "Rechtsfrieden", description: "10 Jahre ohne Gerichtsverfahren.", check: (g) => g.counters.courtFreeSeasons >= 10 },
  { id: "ACCEPT_75", title: "Breite Mehrheit", description: "Akzeptanz über 75.", check: (_g, s) => s.acceptance >= 75 },
  { id: "TEN_SEASONS", title: "Dauerbrenner", description: "10 Saisons Kompassmodell.", check: (g) => g.history.seasons.length >= 10 },
  { id: "TWENTY_SEASONS", title: "Reform-Architekt", description: "20 Saisons Kompassmodell.", check: (g) => g.history.seasons.length >= 20 },
  { id: "GRADE_1", title: "Musterjahrgang", description: "Saisonnote 1,5 oder besser.", check: (_g, s) => (s.grade ?? 5) <= 1.5 },
  { id: "RICH", title: "Geldsegen", description: "Vermarktungserlös über 12 Mio. €.", check: (_g, s) => s.revenue > 12_000_000 },
];

export function checkAchievements(state: GameState, s: SeasonSummary): string[] {
  const got = new Set(state.achievements.map((a) => a.id));
  const fresh: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (got.has(a.id)) continue;
    if (a.check(state, s)) {
      state.achievements.push({ id: a.id, season: state.season });
      fresh.push(a.id);
    }
  }
  return fresh;
}
