// K.-o.-Duelle (Relegation, Meister-Playoff) und Aufstiegsrunden.
import type { TieMode } from "../config/rules";
import { distanceMatrixFor } from "./geo";
import { penaltyWinner, simulateMatch } from "./match";
import { rngFor } from "./rng";
import { computeTable, doubleRoundRobin, singleRoundRobin } from "./schedule";
import type { ClubId, GameState, PromotionRoundResult, Tie } from "./types";

export function playTie(state: GameState, a: ClubId, b: ClubId, mode: TieMode, id: string, name: string): Tie {
  const rng = rngFor(state.seed, state.season, "tie", id);
  const dm = distanceMatrixFor(state.clubs, state.rules.allocation.roadFactor);
  const p = state.rules.match;
  const play = (home: ClubId, away: ClubId, neutral: boolean) => {
    const params = neutral ? { ...p, homeAdvantage: 0 } : p;
    const [hg, ag] = simulateMatch(
      {
        homeStrength: state.clubs[home].strength,
        awayStrength: state.clubs[away].strength,
        distanceKm: neutral ? 0 : dm.get(home, away),
        derbyWeight: 0,
        homeForm: 0,
        awayForm: 0,
      },
      params,
      rng,
    );
    return { home, away, hg, ag };
  };
  const legs: Tie["legs"] = [];
  let ga = 0;
  let gb = 0;
  if (mode === "TWO_LEGS") {
    // Hinspiel beim zufällig gelosten Team
    const first = rng.chance(0.5) ? [a, b] : [b, a];
    legs.push(play(first[0], first[1], false));
    legs.push(play(first[1], first[0], false));
  } else {
    const neutral = mode === "SINGLE_NEUTRAL";
    const homeA = mode === "ALTERNATING_SINGLE" ? state.season % 2 === 0 : true;
    legs.push(homeA ? play(a, b, neutral) : play(b, a, neutral));
  }
  for (const l of legs) {
    if (l.home === a) {
      ga += l.hg;
      gb += l.ag;
    } else {
      ga += l.ag;
      gb += l.hg;
    }
  }
  let winner: ClubId;
  let decidedBy: Tie["decidedBy"];
  if (ga !== gb) {
    winner = ga > gb ? a : b;
    decidedBy = legs.length > 1 ? "AGGREGATE" : "SINGLE";
  } else {
    winner = penaltyWinner(state.clubs[a].strength, state.clubs[b].strength, rng) === "a" ? a : b;
    decidedBy = "PENALTIES";
  }
  return { id, name, a, b, legs, winner, decidedBy };
}

export function playPromotionRound(
  state: GameState,
  id: string,
  name: string,
  clubs: ClubId[],
  slots: number,
  format: "single" | "double",
): PromotionRoundResult {
  if (clubs.length <= slots) return { id, name, table: [], promoted: [...clubs] };
  const rng = rngFor(state.seed, state.season, "round", id);
  const fixtures = format === "single" ? singleRoundRobin(clubs, rng) : doubleRoundRobin(clubs, rng);
  const dm = distanceMatrixFor(state.clubs, state.rules.allocation.roadFactor);
  for (const f of fixtures) {
    const [hg, ag] = simulateMatch(
      {
        homeStrength: state.clubs[f.home].strength,
        awayStrength: state.clubs[f.away].strength,
        distanceKm: dm.get(f.home, f.away),
        derbyWeight: 0,
        homeForm: 0,
        awayForm: 0,
      },
      state.rules.match,
      rng,
    );
    f.hg = hg;
    f.ag = ag;
  }
  const table = computeTable(clubs, fixtures, state.seed + state.season);
  return { id, name, table, promoted: table.slice(0, slots).map((r) => r.clubId) };
}
