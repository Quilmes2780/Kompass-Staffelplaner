// Spielmodell: Poisson-Tore (mit Dixon-Coles-Korrektur für niedrige Ergebnisse).
import type { RulesConfig } from "../config/rules";
import type { Rng } from "./rng";

export interface MatchInput {
  homeStrength: number;
  awayStrength: number;
  /** Anreise-km des Gastes (einfach) */
  distanceKm: number;
  /** 0 = kein Derby, sonst Gewicht 1–3 */
  derbyWeight: number;
  /** Formwert −1…1 */
  homeForm: number;
  awayForm: number;
}

export function expectedGoals(m: MatchInput, p: RulesConfig["match"]): [number, number] {
  const diff = (m.homeStrength - m.awayStrength) * p.strengthScale;
  const fatigue = (p.fatiguePer100Km * m.distanceKm) / 100;
  const derby = m.derbyWeight > 0 ? p.derbyBonus * m.derbyWeight : 0;
  const lh = p.baseGoals * Math.exp(diff + p.homeAdvantage + p.formWeight * m.homeForm + fatigue / 2 + derby / 2);
  const la = p.baseGoals * Math.exp(-diff + p.formWeight * m.awayForm - fatigue / 2 + derby / 3);
  return [lh, la];
}

function tau(x: number, y: number, lh: number, la: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lh * la * rho;
  if (x === 0 && y === 1) return 1 + lh * rho;
  if (x === 1 && y === 0) return 1 + la * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

export function simulateScore(lh: number, la: number, rho: number, rng: Rng): [number, number] {
  const maxTau = Math.max(1, 1 - lh * la * rho, 1 - rho, 1 + lh * rho, 1 + la * rho);
  for (let i = 0; i < 50; i++) {
    const x = rng.poisson(lh);
    const y = rng.poisson(la);
    if (rng.next() * maxTau <= tau(x, y, lh, la, rho)) return [x, y];
  }
  return [rng.poisson(lh), rng.poisson(la)];
}

export function simulateMatch(m: MatchInput, p: RulesConfig["match"], rng: Rng): [number, number] {
  const [lh, la] = expectedGoals(m, p);
  return simulateScore(lh, la, p.rho, rng);
}

/** Elfmeterschießen: leicht stärkeabhängig, ansonsten Lotterie */
export function penaltyWinner(aStrength: number, bStrength: number, rng: Rng): "a" | "b" {
  const pa = 0.5 + (aStrength - bStrength) * 0.004;
  return rng.next() < pa ? "a" : "b";
}

/** Form aus den letzten Ergebnissen ("WDLWW"): −1 … 1 */
export function formValue(form: string): number {
  if (!form) return 0;
  const last = form.slice(-5);
  let pts = 0;
  for (const ch of last) pts += ch === "W" ? 3 : ch === "D" ? 1 : 0;
  return Math.max(-1, Math.min(1, (pts / last.length - 1.4) / 1.6));
}
