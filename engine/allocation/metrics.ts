// Kennzahlen und Regelprüfung einer Staffeleinteilung.
import type { RulesConfig } from "../../config/rules";
import type { DistanceMatrix } from "../geo";
import type { Allocation, AllocationMetrics, Ampel, Club, ClubId, Derby, RuleViolation } from "../types";
import { groupChangers } from "./matching";

export interface MetricsInput {
  allocation: Allocation;
  /** Vereine, die laut Auf-/Abstieg in der Regionalliga spielen müssen */
  expectedClubs: ClubId[];
  clubs: Record<ClubId, Club>;
  derbies: Derby[];
  dm: DistanceMatrix;
  rules: RulesConfig;
  previous?: Allocation;
}

/** CO₂ je Bus-km (Reisebus, kg) */
const CO2_PER_KM = 1.1;

export function validateAllocation(inp: Omit<MetricsInput, "dm" | "derbies">): RuleViolation[] {
  const { allocation, expectedClubs, clubs, rules } = inp;
  const v: RuleViolation[] = [];
  const groupIds = rules.rl.groupIds;
  const keys = Object.keys(allocation.groups);
  if (keys.length !== groupIds.length || groupIds.some((g) => !allocation.groups[g]))
    v.push({ rule: "Staffelanzahl", message: `Es müssen genau ${groupIds.length} Staffeln (${groupIds.join(", ")}) gebildet werden.` });
  for (const g of groupIds) {
    const n = allocation.groups[g]?.length ?? 0;
    if (n !== rules.rl.groupSize)
      v.push({ rule: "Staffelgröße", message: `Staffel ${g} hat ${n} statt ${rules.rl.groupSize} Teams.` });
  }
  const seen = new Map<ClubId, string>();
  const dup: ClubId[] = [];
  for (const [g, list] of Object.entries(allocation.groups))
    for (const id of list) {
      if (seen.has(id)) dup.push(id);
      seen.set(id, g);
    }
  if (dup.length) v.push({ rule: "Doppelte Zuordnung", message: `${dup.map((d) => clubs[d]?.shortName ?? d).join(", ")} mehrfach eingeteilt.`, clubs: dup });
  const expected = new Set(expectedClubs);
  const missing = expectedClubs.filter((id) => !seen.has(id));
  if (missing.length)
    v.push({ rule: "Vollständigkeit", message: `Nicht eingeteilt: ${missing.map((d) => clubs[d]?.shortName ?? d).join(", ")}.`, clubs: missing });
  const extra = [...seen.keys()].filter((id) => !expected.has(id));
  if (extra.length)
    v.push({ rule: "Spielberechtigung", message: `Nicht für die Regionalliga qualifiziert: ${extra.map((d) => clubs[d]?.shortName ?? d).join(", ")}.`, clubs: extra });
  for (const g of groupIds) {
    const res = (allocation.groups[g] ?? []).filter((id) => clubs[id]?.isReserve);
    if (res.length > rules.rl.maxReservesPerGroup)
      v.push({
        rule: "Zweitvertretungs-Grenze",
        message: `Staffel ${g} hat ${res.length} Zweitvertretungen (Sonderregel: höchstens ${rules.rl.maxReservesPerGroup}).`,
        clubs: res,
      });
  }
  return v;
}

export function gini(values: number[]): number {
  const xs = [...values].sort((a, b) => a - b);
  const n = xs.length;
  const sum = xs.reduce((a, b) => a + b, 0);
  if (!n || !sum) return 0;
  let acc = 0;
  xs.forEach((x, i) => (acc += (2 * (i + 1) - n - 1) * x));
  return acc / (n * sum);
}

/** Saison-Reise-km je Verein (Hin- und Rückfahrt zu jedem Staffelgegner) */
export function clubTravelKm(group: ClubId[], dm: DistanceMatrix): Record<ClubId, number> {
  const out: Record<ClubId, number> = {};
  for (const a of group) {
    let s = 0;
    for (const b of group) if (a !== b) s += 2 * dm.get(a, b);
    out[a] = s;
  }
  return out;
}

export function computeMetrics(inp: MetricsInput): AllocationMetrics {
  const { allocation, clubs, derbies, dm, rules, previous } = inp;
  const violations = validateAllocation(inp);
  const groupKm: Record<string, number> = {};
  const avgKmPerClub: Record<string, number> = {};
  const perClub: Record<ClubId, number> = {};
  const groupOf: Record<ClubId, string> = {};
  const reservesPerGroup: Record<string, number> = {};
  const avgStrength: Record<string, number> = {};
  let attendance = 0;
  let marketing = 0;
  for (const [g, list] of Object.entries(allocation.groups)) {
    const valid = list.filter((id) => clubs[id]);
    const km = clubTravelKm(valid, dm);
    Object.assign(perClub, km);
    for (const id of valid) groupOf[id] = g;
    groupKm[g] = Object.values(km).reduce((a, b) => a + b, 0);
    avgKmPerClub[g] = valid.length ? groupKm[g] / valid.length : 0;
    reservesPerGroup[g] = valid.filter((id) => clubs[id].isReserve).length;
    avgStrength[g] = valid.length ? valid.reduce((a, id) => a + clubs[id].strength, 0) / valid.length : 0;
    const fans = valid.reduce((a, id) => a + clubs[id].fanPotential, 0);
    attendance += fans;
    // Vermarktungswert: Zuschauerpotenzial mit Bonus für große Traditionsvereine je Staffel (Zugpferde)
    const top = valid.map((id) => clubs[id].fanPotential).sort((a, b) => b - a).slice(0, 4);
    marketing += fans * 0.6 + top.reduce((a, b) => a + b, 0) * 0.8;
  }
  const totalKm = Object.values(groupKm).reduce((a, b) => a + b, 0);
  let maxClub = { clubId: "", km: 0 };
  for (const [id, km] of Object.entries(perClub)) if (km > maxClub.km) maxClub = { clubId: id, km };
  let derbiesKept = 0;
  let derbiesSplit = 0;
  let kw = 0;
  let sw = 0;
  const splitDerbies: AllocationMetrics["splitDerbies"] = [];
  for (const d of derbies) {
    if (!groupOf[d.a] || !groupOf[d.b]) continue;
    if (groupOf[d.a] === groupOf[d.b]) {
      derbiesKept++;
      kw += d.weight;
    } else {
      derbiesSplit++;
      sw += d.weight;
      splitDerbies.push({ a: d.a, b: d.b, weight: d.weight });
    }
  }
  marketing *= 1 + 0.01 * kw;
  attendance *= 1 + 0.004 * kw;
  // Wechsel nach Vereinsüberschneidung, nicht nach Bezeichnung (siehe matching.ts)
  const changedClubs: ClubId[] = previous ? groupChangers(previous.groups, allocation.groups).filter((id) => clubs[id]) : [];
  const strengths = Object.values(avgStrength);
  const meanS = strengths.reduce((a, b) => a + b, 0) / Math.max(1, strengths.length);
  const strengthSpread = Math.sqrt(strengths.reduce((a, x) => a + (x - meanS) ** 2, 0) / Math.max(1, strengths.length));
  const oberligaRisk = oberligaRiskFor(allocation, clubs, rules);
  const m: AllocationMetrics = {
    totalKm,
    groupKm,
    avgKmPerClub,
    maxClub,
    giniKm: gini(Object.values(perClub)),
    derbiesKept,
    derbiesSplit,
    derbiesKeptWeight: kw,
    derbiesSplitWeight: sw,
    splitDerbies,
    reservesPerGroup,
    groupChanges: changedClubs.length,
    changedClubs,
    avgStrength,
    strengthSpread,
    marketingValue: Math.round(marketing),
    attendanceForecast: Math.round(attendance / Math.max(1, Object.keys(perClub).length)),
    co2Tonnes: Math.round((totalKm * CO2_PER_KM) / 1000),
    oberligaRisk,
    violations,
    ampel: {},
  };
  m.ampel = ampelFor(m, rules);
  return m;
}

/**
 * Oberliga-Risiko: erwartete Zahl an Absteigern je Heim-Oberliga. Abstiegswahrscheinlichkeit je Verein
 * aus seiner Stärke relativ zur Staffel (logistisch, je Staffel auf die Absteigerzahl normiert).
 */
export function oberligaRiskFor(allocation: Allocation, clubs: Record<ClubId, Club>, rules: RulesConfig): AllocationMetrics["oberligaRisk"] {
  const exp: Record<string, number> = {};
  const atRisk: Record<string, number> = {};
  for (const list of Object.values(allocation.groups)) {
    const valid = list.filter((id) => clubs[id]);
    if (!valid.length) continue;
    const mean = valid.reduce((a, id) => a + clubs[id].strength, 0) / valid.length;
    const raw = valid.map((id) => 1 / (1 + Math.exp((clubs[id].strength - mean) / 2.5 + 1)));
    const sum = raw.reduce((a, b) => a + b, 0);
    valid.forEach((id, i) => {
      const p = (raw[i] / sum) * rules.rl.relegatedPerGroup;
      const ol = clubs[id].oberligaId;
      exp[ol] = (exp[ol] ?? 0) + p;
      if (p > 0.3) atRisk[ol] = (atRisk[ol] ?? 0) + 1;
    });
  }
  return Object.entries(exp)
    .map(([oberligaId, expected]) => ({ oberligaId, expected: Math.round(expected * 10) / 10, max: atRisk[oberligaId] ?? 0 }))
    .sort((a, b) => b.expected - a.expected);
}

function ampelFor(m: AllocationMetrics, rules: RulesConfig): Record<string, Ampel> {
  const a = (v: number, y: number, r: number): Ampel => (v >= r ? "red" : v >= y ? "yellow" : "green");
  const maxRes = Math.max(0, ...Object.values(m.reservesPerGroup));
  const avgClub = m.totalKm / Math.max(1, Object.values(m.reservesPerGroup).length * rules.rl.groupSize);
  return {
    totalKm: a(avgClub, 9000, 12000),
    maxClub: a(m.maxClub.km, 13000, 17000),
    gini: a(m.giniKm, 0.18, 0.26),
    derbies: a(m.derbiesSplitWeight, 6, 14),
    reserves: maxRes > rules.rl.maxReservesPerGroup ? "red" : maxRes === rules.rl.maxReservesPerGroup ? "yellow" : "green",
    changes: a(m.groupChanges, 15, 30),
    balance: a(m.strengthSpread, 1.5, 3),
    oberliga: a(Math.max(0, ...m.oberligaRisk.map((x) => x.expected)), 2.6, 3.6),
    valid: m.violations.length ? "red" : "green",
  };
}
