// Härtefallanträge zur Staffeleinteilung.
import { matchGroups, groupChangers } from "./allocation/matching";
import { clubTravelKm } from "./allocation/metrics";
import { distanceMatrixFor } from "./geo";
import { rngFor } from "./rng";
import type { Allocation, ClubId, GameState, HardshipRequest } from "./types";

/** Anträge auf Basis des Algorithmus-Vorschlags erzeugen */
export function generateHardshipRequests(state: GameState, proposal: Allocation): HardshipRequest[] {
  const rng = rngFor(state.seed, state.season, "hardship");
  const groupOf: Record<ClubId, string> = {};
  for (const [g, list] of Object.entries(proposal.groups)) for (const id of list) groupOf[id] = g;
  const reqs: HardshipRequest[] = [];
  const name = (id: ClubId) => state.clubs[id].shortName;
  let n = 0;
  const id = () => `h${state.season}-${++n}`;
  // Derby: getrennte Rivalitäten (Gewicht ≥ 2)
  for (const d of state.derbies) {
    if (!groupOf[d.a] || !groupOf[d.b] || groupOf[d.a] === groupOf[d.b] || d.weight < 2) continue;
    if (!rng.chance(0.4 + 0.25 * d.weight)) continue;
    const applicant = state.clubs[d.a].fanPotential >= state.clubs[d.b].fanPotential ? d.a : d.b;
    const partner = applicant === d.a ? d.b : d.a;
    reqs.push({
      id: id(),
      clubId: applicant,
      reason: "DERBY",
      partnerId: partner,
      text: `${state.clubs[applicant].name} beantragt, mit ${state.clubs[partner].name} in einer Staffel zu spielen. ${d.name ? `Das „${d.name}“` : "Das Derby"} sichert die höchsten Zuschauereinnahmen der Saison.`,
    });
  }
  // Reisekosten: Vereine mit den weitesten Wegen
  const dm = distanceMatrixFor(state.clubs, state.rules.allocation.roadFactor);
  const km: Record<ClubId, number> = {};
  for (const list of Object.values(proposal.groups)) Object.assign(km, clubTravelKm(list, dm));
  const far = Object.entries(km).sort((a, b) => b[1] - a[1]).slice(0, 4);
  for (const [cid, k] of far) {
    if (state.clubs[cid].isReserve || !rng.chance(0.5)) continue;
    // gewünschte Staffel = die mit der geringsten Reiselast für den Verein
    let best = groupOf[cid];
    let bestKm = Infinity;
    for (const [g, list] of Object.entries(proposal.groups)) {
      const s = list.reduce((a, o) => a + (o === cid ? 0 : 2 * dm.get(cid, o)), 0);
      if (s < bestKm) {
        bestKm = s;
        best = g;
      }
    }
    if (best === groupOf[cid]) continue;
    reqs.push({
      id: id(),
      clubId: cid,
      reason: "TRAVEL_COST",
      wantsGroup: best,
      text: `${state.clubs[cid].name} (${Math.round(k).toLocaleString("de-DE")} km Saisonreise im Vorschlag) beantragt aus Kostengründen die Einteilung in Staffel ${best}.`,
    });
  }
  // Stadionnutzung: Vereine aus demselben Ort wollen gemeinsam planen (Spielplanabstimmung)
  const byTown = new Map<string, ClubId[]>();
  for (const cid of Object.keys(groupOf)) {
    const t = state.clubs[cid].town;
    byTown.set(t, [...(byTown.get(t) ?? []), cid]);
  }
  for (const list of byTown.values()) {
    if (list.length < 2) continue;
    const [a, b] = list;
    if (groupOf[a] === groupOf[b] || !rng.chance(0.35)) continue;
    reqs.push({
      id: id(),
      clubId: a,
      reason: "STADIUM_SHARING",
      partnerId: b,
      text: `${name(a)} und ${name(b)} teilen sich Infrastruktur in ${state.clubs[a].town} und bitten um dieselbe Staffel, um den Spielplan abzustimmen.`,
    });
  }
  // Planungssicherheit: Vereine, die im Vorschlag die Staffel wechseln sollen
  // Vorjahr = die laufende Einteilung (previousAllocation ist während der Einteilungsphase schon zwei Saisons alt)
  const last = state.allocation;
  if (last) {
    const prev: Record<ClubId, string> = {};
    for (const [g, list] of Object.entries(last.groups)) for (const c of list) prev[c] = g;
    // gewünscht ist die Nachfolgerin der Vorjahresstaffel (nach Vereinsüberschneidung)
    const match = matchGroups(last.groups, proposal.groups);
    const successor = (g: string) => Object.keys(match).find((k) => match[k] === g);
    const movers = groupChangers(last.groups, proposal.groups).filter((c) => successor(prev[c]));
    for (const c of rng.shuffle(movers).slice(0, 3)) {
      if (!rng.chance(0.5)) continue;
      const want = successor(prev[c])!;
      reqs.push({
        id: id(),
        clubId: c,
        reason: "PLANNING",
        wantsGroup: want,
        text: `${state.clubs[c].name} möchte in Staffel ${want} bleiben: Dauerkarten, Sponsorenverträge und Busplanung sind auf die bisherige Staffel ausgelegt.`,
      });
    }
  }
  return reqs;
}

/** Prüft, ob eine Einteilung einen Antrag erfüllt */
export function isFulfilled(h: HardshipRequest, a: Allocation): boolean {
  const groupOf: Record<ClubId, string> = {};
  for (const [g, list] of Object.entries(a.groups)) for (const id of list) groupOf[id] = g;
  if (h.partnerId) return groupOf[h.clubId] === groupOf[h.partnerId];
  if (h.wantsGroup) return groupOf[h.clubId] === h.wantsGroup;
  return true;
}

export const HARDSHIP_LABEL: Record<HardshipRequest["reason"], string> = {
  DERBY: "Derby",
  TRAVEL_COST: "Reisekosten",
  STADIUM_SHARING: "Stadionnutzung",
  PLANNING: "Planungssicherheit",
};
