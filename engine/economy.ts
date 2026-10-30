// Finanzen: Zentralvermarktung, Garantie, Ausschüttung, Regionalverbände, Vereinsentwicklung.
import { leagueIndex, rlClubs } from "./leagues";
import { rngFor } from "./rng";
import type { ClubId, GameState, Level, Movement } from "./types";
import { REGIONALVERBAENDE } from "./types";

export interface DistributionResult {
  revenue: number;
  guaranteeTotal: number;
  distributionTotal: number;
  perClubDistribution: number;
  verbandPayout: Record<string, number>;
  dfbTopUp: number;
}

const LEVEL_STRENGTH: Record<Level, number> = { BL: 84, BL2: 70, L3: 60, RL: 47, OL: 37, VL: 31 };
const LEVEL_BUDGET: Record<Level, number> = { BL: 120e6, BL2: 40e6, L3: 8e6, RL: 1.9e6, OL: 0.55e6, VL: 0.3e6 };

/** Erlös der Zentralvermarktung der laufenden Saison */
export function seasonRevenue(state: GameState): number {
  const mk = state.satisfaction.MARKETING ?? 60;
  const m = state.allocation ? marketingFactor(state) : 1;
  return Math.round(state.finance.marketingPot * (0.85 + mk / 400) * m);
}

function marketingFactor(state: GameState): number {
  const rl = rlClubs(state.leagues);
  const fans = rl.reduce((a, id) => a + state.clubs[id].fanPotential, 0) / Math.max(1, rl.length);
  return Math.max(0.8, Math.min(1.25, fans / 1500));
}

/**
 * Ausschüttung: 1. Mannschaften in der Regionalliga erhalten mindestens die Garantie (bis zum Stichjahr),
 * darüber hinausgehende Erlöse werden zu 90 % an diese Klubs ausgeschüttet. Die übrigen 10 % gehen an
 * die Regionalverbände; jeder erhält mindestens 500.000 € (Fehlbetrag trägt der DFB).
 */
export function distributeRevenue(state: GameState): DistributionResult {
  const f = state.rules.finance;
  const revenue = seasonRevenue(state);
  const firstTeams = rlClubs(state.leagues).filter((id) => !state.clubs[id].isReserve);
  const guaranteeActive = state.season <= f.guaranteeUntilSeason;
  const guaranteeTotal = guaranteeActive ? firstTeams.length * f.guaranteePerClub : 0;
  const excess = Math.max(0, revenue - guaranteeTotal);
  const distributionTotal = excess * f.distributionShare;
  const perClubDistribution = firstTeams.length ? distributionTotal / firstTeams.length : 0;
  let dfbTopUp = Math.max(0, guaranteeTotal - revenue);
  for (const id of firstTeams) {
    const s = state.seasonStats[id];
    if (!s) continue;
    s.income.guarantee = guaranteeActive ? f.guaranteePerClub : 0;
    s.income.distribution = Math.round(perClubDistribution);
  }
  const verbandShare = (excess * (1 - f.distributionShare)) / REGIONALVERBAENDE.length;
  const verbandPayout: Record<string, number> = {};
  for (const v of REGIONALVERBAENDE) {
    verbandPayout[v] = Math.max(f.minPerRegionalverband, Math.round(verbandShare));
    dfbTopUp += Math.max(0, f.minPerRegionalverband - verbandShare);
  }
  state.finance.dfbReserve += f.dfbAnnualBudget - Math.round(dfbTopUp);
  return { revenue, guaranteeTotal, distributionTotal, perClubDistribution, verbandPayout, dfbTopUp: Math.round(dfbTopUp) };
}

/** Vereinsentwicklung zum Saisonende (Etat, Stärke, Zuschauerpotenzial) */
export function evolveClubs(state: GameState, movements: Record<ClubId, Movement>): void {
  const idx = leagueIndex(state.leagues);
  const f = state.rules.finance;
  for (const [id, ref] of Object.entries(idx)) {
    const c = state.clubs[id];
    const rng = rngFor(state.seed, state.season, "evolve", id);
    const s = state.seasonStats[id];
    const lvl = ref.level;
    // Etat
    const target = LEVEL_BUDGET[lvl] * Math.pow(Math.max(100, c.fanPotential) / 1500, 0.35);
    let budget = 0.8 * c.budget + 0.2 * target;
    if (s) {
      budget += 0.5 * (s.income.guarantee + s.income.distribution);
      budget -= 0.5 * s.travelKm * f.travelCostPerKm;
      budget += 0.25 * (s.income.other - c.fanPotential * 19 * f.ticketPrice);
    }
    budget *= Math.exp(rng.normal(0, 0.05));
    c.budget = Math.max(120_000, Math.round(budget / 1000) * 1000);
    // Stärke: Mittelwertrückkehr zum Ligaziel, Etat-Effekt, Rauschen
    let tgt = LEVEL_STRENGTH[lvl] + 5 * Math.log10(c.budget / LEVEL_BUDGET[lvl]);
    if (c.parentId) {
      const pl = idx[c.parentId]?.level;
      tgt = pl === "BL" ? 51 : pl === "BL2" ? 47 : 42;
    }
    c.strength = Math.max(15, Math.min(98, Math.round((c.strength + 0.3 * (tgt - c.strength) + rng.normal(0, 1.8)) * 10) / 10));
    // Zuschauerpotenzial: Erfolg zieht, Abstieg kostet
    const mv = movements[id];
    const k = mv === "PROMOTED" ? 1.06 : mv === "RELEGATED" || mv === "FORCED_RELEGATION" ? 0.93 : mv === "INSOLVENT" ? 0.8 : 1;
    c.fanPotential = Math.max(80, Math.round(c.fanPotential * k * Math.exp(rng.normal(0, 0.03))));
    if (mv === "INSOLVENT") {
      c.budget = Math.round(c.budget * 0.45);
      c.strength = Math.max(15, c.strength - 8);
    }
  }
}
