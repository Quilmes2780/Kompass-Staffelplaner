// Stakeholder-Zufriedenheit (0–100), Reaktionen auf die Einteilung und Gesamtakzeptanz.
import { distanceMatrixFor } from "./geo";
import { clubTravelKm } from "./allocation/metrics";
import { addNews } from "./news";
import { rngFor } from "./rng";
import type { AllocationMetrics, ClubId, GameState, HardshipRequest, Regionalverband, StakeholderKey } from "./types";
import { REGIONALVERBAENDE } from "./types";

export const STAKEHOLDER_LABEL: Record<StakeholderKey, string> = {
  PRAESIDIUM: "DFB-Präsidium",
  BFV: "Bayerischer FV",
  NOFV: "NOFV",
  NFV: "Norddeutscher FV",
  WDFV: "WDFV",
  SW: "Regionalverband Südwest",
  FANS: "Fans",
  MEDIA: "Medien",
  MARKETING: "Vermarktungspartner",
};

const WEIGHTS: Record<StakeholderKey, number> = {
  PRAESIDIUM: 0.2,
  BFV: 0.08,
  NOFV: 0.08,
  NFV: 0.08,
  WDFV: 0.08,
  SW: 0.08,
  FANS: 0.15,
  MEDIA: 0.1,
  MARKETING: 0.15,
};

export function adjust(state: GameState, key: string, delta: number): void {
  const v = state.satisfaction[key] ?? 60;
  state.satisfaction[key] = Math.max(0, Math.min(100, v + delta));
}

/** Gesamtakzeptanz der Reform (gewichtetes Mittel) */
export function acceptance(state: GameState): number {
  let s = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) s += (state.satisfaction[k] ?? 60) * w;
  return Math.round(s * 10) / 10;
}

function sens(state: GameState): number {
  return state.settings.difficulty === "LEICHT" ? 0.7 : state.settings.difficulty === "SCHWER" ? 1.4 : 1;
}

/**
 * Reaktionen auf die Veröffentlichung der Einteilung. Bewertet wird gegenüber dem Optimum (reine km)
 * und dem Vorjahr. Liefert Schlagzeilen.
 */
export function reactToAllocation(
  state: GameState,
  m: AllocationMetrics,
  optimumKm: number,
  hardship: HardshipRequest[],
): void {
  const k = sens(state);
  const neg = (x: number) => (x < 0 ? x * k : x);
  const dm = distanceMatrixFor(state.clubs, state.rules.allocation.roadFactor);
  const groups = state.allocation!.groups;
  const prevKm: Record<ClubId, number> = {};
  if (state.previousAllocation)
    for (const list of Object.values(state.previousAllocation.groups)) Object.assign(prevKm, clubTravelKm(list.filter((x) => state.clubs[x]), dm));
  const changed = new Set(m.changedClubs);
  const split = new Map<ClubId, number>();
  for (const d of m.splitDerbies) {
    split.set(d.a, (split.get(d.a) ?? 0) + d.weight);
    split.set(d.b, (split.get(d.b) ?? 0) + d.weight);
  }
  const verbandDelta: Record<Regionalverband, number[]> = { BFV: [], NOFV: [], NFV: [], WDFV: [], SW: [] };
  for (const list of Object.values(groups)) {
    const km = clubTravelKm(list, dm);
    for (const id of list) {
      let d = 2;
      if (prevKm[id]) d -= ((km[id] - prevKm[id]) / 1000) * 1.2;
      else d -= (km[id] - 8000) / 2000;
      d -= (split.get(id) ?? 0) * 3;
      if (changed.has(id)) d -= 4;
      const req = hardship.filter((h) => h.clubId === id);
      for (const h of req) {
        if (h.decision === "GRANTED") d += h.fulfilled ? 6 : -12;
        if (h.decision === "REJECTED") d -= 3;
      }
      d = neg(d);
      adjust(state, id, d);
      verbandDelta[state.clubs[id].regionalverband].push(d);
    }
  }
  for (const v of REGIONALVERBAENDE) {
    const xs = verbandDelta[v];
    if (xs.length) adjust(state, v, (xs.reduce((a, b) => a + b, 0) / xs.length) * 0.8);
  }
  // Präsidium: Effizienz ggü. Optimum, Regelkonformität
  const overKm = optimumKm > 0 ? (m.totalKm - optimumKm) / optimumKm : 0;
  adjust(state, "PRAESIDIUM", neg(3 - overKm * 60));
  // Fans: Derbys und Stabilität
  adjust(state, "FANS", neg(1.5 - 0.4 * (m.derbiesSplitWeight - 4) - 0.12 * (m.groupChanges - 10)));
  // Medien: Kontroversen
  const brokenPromises = hardship.filter((h) => h.decision === "GRANTED" && !h.fulfilled).length;
  adjust(state, "MEDIA", neg(1 - 0.25 * (m.derbiesSplitWeight - 4) - brokenPromises * 3 - Math.max(0, m.giniKm - 0.2) * 15));
  // Vermarktung: Zuschauerprognose, Derbys
  adjust(state, "MARKETING", neg(Math.max(-4, Math.min(4, (m.attendanceForecast - 1500) / 200)) - 0.2 * (m.derbiesSplitWeight - 4)));
  headlinesForAllocation(state, m, overKm, brokenPromises);
}

function headlinesForAllocation(state: GameState, m: AllocationMetrics, overKm: number, broken: number): void {
  const rng = rngFor(state.seed, state.season, "headlines");
  const name = (id: ClubId) => state.clubs[id]?.name ?? id;
  const fmt = (n: number) => Math.round(n).toLocaleString("de-DE");
  addNews(state, `Staffeleinteilung veröffentlicht: ${fmt(m.totalKm)} Reise-km, ${m.derbiesKept} Derbys erhalten`, "neutral");
  if (m.splitDerbies.length) {
    const top = [...m.splitDerbies].sort((a, b) => b.weight - a.weight)[0];
    addNews(
      state,
      rng.pick([
        `„Ein Schlag ins Gesicht der Fans“: Derby ${state.clubs[top.a].shortName} gegen ${state.clubs[top.b].shortName} fällt aus`,
        `Kein Derby mehr: ${name(top.a)} und ${name(top.b)} in getrennten Staffeln`,
      ]),
      "neg",
      [top.a, top.b],
    );
  } else addNews(state, "Alle Derbys bleiben erhalten – Lob aus den Fankurven", "pos");
  if (overKm > 0.08) addNews(state, `Kritik vom Präsidium: Einteilung ${Math.round(overKm * 100)} % über dem km-Optimum`, "neg");
  else if (overKm < 0.02) addNews(state, "Präsidium zufrieden: Einteilung nahe am Reise-Optimum", "pos");
  if (m.maxClub.clubId) addNews(state, `Längste Saisonreise: ${name(m.maxClub.clubId)} mit ${fmt(m.maxClub.km)} km`, m.maxClub.km > 14000 ? "neg" : "neutral", [m.maxClub.clubId]);
  if (m.groupChanges > 20) addNews(state, `${m.groupChanges} Staffelwechsler – Vereine klagen über fehlende Planungssicherheit`, "neg");
  if (broken > 0) addNews(state, `Zusagen nicht eingehalten: ${broken} genehmigte Härtefälle wurden in der Einteilung nicht umgesetzt`, "neg");
}

/** Zufriedenheit zum Saisonende: sportlicher Erfolg, Finanzen, Ruhe; leichte Rückkehr zum Mittelwert */
export function seasonEndDrift(state: GameState, revenueDelta: number): void {
  const k = sens(state);
  for (const key of Object.keys(state.satisfaction)) {
    const v = state.satisfaction[key];
    state.satisfaction[key] = v + (60 - v) * 0.12;
  }
  adjust(state, "MARKETING", revenueDelta > 0 ? 2 : -2 * k);
  adjust(state, "PRAESIDIUM", state.finance.dfbReserve < 0 ? -4 * k : 1);
}
