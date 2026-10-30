// DFB-Bundestag: Delegiertenblöcke für den Prolog (Abstimmung über die Reform) und das
// Rettungs-Minispiel (Antrag auf Rückabwicklung).
import { rngFor } from "./rng";
import type { Concession, GameState, Regionalverband } from "./types";

export interface DelegateBlock {
  id: string;
  name: string;
  votes: number;
  /** Zustimmung zur Reform 0–1 */
  support: number;
  rv?: Regionalverband;
  /** Wofür der Block empfänglich ist */
  wants: "HARDSHIP" | "FUNDING";
}

/** 257 Stimmen (vereinfachte Verteilung nach Größe der Landesverbände + Liga) */
export function defaultBlocks(): DelegateBlock[] {
  const b = (id: string, name: string, votes: number, support: number, rv: Regionalverband | undefined, wants: DelegateBlock["wants"]): DelegateBlock => ({
    id, name, votes, support, rv, wants,
  });
  return [
    b("BFV", "Bayerischer FV", 32, 0.5, "BFV", "HARDSHIP"),
    b("WDFV", "Westdeutsche Verbände (FVN, FLVW, FVM)", 54, 0.78, "WDFV", "FUNDING"),
    b("NFV", "Norddeutsche Verbände (NFV, HFV, SHFV, BFV-HB)", 40, 0.62, "NFV", "FUNDING"),
    b("NOFV", "Nordostdeutsche Verbände", 36, 0.45, "NOFV", "HARDSHIP"),
    b("SW", "Süd/Südwest-Verbände (HFV, WFV, bfv, SBFV, FVR, SWFV, SFV)", 64, 0.66, "SW", "FUNDING"),
    b("LIGA", "Liga (DFL-Delegierte)", 31, 0.8, undefined, "FUNDING"),
  ];
}

export type { Concession };

export const CONCESSION_EFFECT = { match: 0.16, other: 0.07 };
export const FUNDING_COST = 400_000;

export function applyConcessions(blocks: DelegateBlock[], cons: Concession[]): DelegateBlock[] {
  return blocks.map((bl) => {
    let s = bl.support;
    for (const c of cons.filter((x) => x.blockId === bl.id)) s += c.kind === bl.wants ? CONCESSION_EFFECT.match : CONCESSION_EFFECT.other;
    return { ...bl, support: Math.min(0.98, s) };
  });
}

export function vote(seed: number, key: string, blocks: DelegateBlock[]): { yes: number; perBlock: Record<string, number> } {
  const rng = rngFor(seed, "vote", key);
  const perBlock: Record<string, number> = {};
  let yes = 0;
  for (const bl of blocks) {
    const v = Math.max(0, Math.min(bl.votes, Math.round(bl.votes * bl.support + rng.normal(0, bl.votes * 0.04))));
    perBlock[bl.id] = v;
    yes += v;
  }
  return { yes, perBlock };
}

export function required(state: Pick<GameState, "rules">): number {
  return Math.ceil(state.rules.prolog.votesTotal * state.rules.prolog.requiredShare);
}

/** Blöcke für einen Rückabwicklungsantrag: Unterstützung der Reform folgt der Zufriedenheit */
export function reversalBlocks(state: GameState): DelegateBlock[] {
  return defaultBlocks().map((b) => {
    const sat = b.rv ? state.satisfaction[b.rv] : (state.satisfaction.MARKETING + state.satisfaction.PRAESIDIUM) / 2;
    const general = (state.satisfaction.FANS + state.satisfaction.MEDIA) / 2;
    return { ...b, support: Math.max(0.05, Math.min(0.95, (0.7 * sat + 0.3 * general) / 100 + 0.12)) };
  });
}
