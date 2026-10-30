// Abstrakt simulierte Ligen (Bundesliga, 2. Bundesliga, Oberligen, Verbandsliga-Reservoir):
// stärkegewichtete Zufallsrangliste mit plausibler Pseudo-Tabelle.
import type { Rng } from "./rng";
import type { ClubId, GameState, TableRow } from "./types";

export function abstractTable(state: GameState, clubs: ClubId[], games: number, rng: Rng, noise = 5): TableRow[] {
  const scored = clubs.map((id) => ({ id, s: state.clubs[id].strength + rng.normal(0, noise) }));
  scored.sort((a, b) => b.s - a.s);
  const mean = scored.reduce((a, x) => a + x.s, 0) / Math.max(1, scored.length);
  const rows = scored.map(({ id, s }) => {
    const ppg = Math.max(0.35, Math.min(2.6, 1.37 + (s - mean) * 0.075));
    const d = Math.round(games * (0.22 + rng.next() * 0.08));
    let w = Math.round((ppg * games - d) / 3);
    w = Math.max(0, Math.min(games - d, w));
    const l = games - w - d;
    const gf = Math.max(10, Math.round(games * (1.45 + (s - mean) * 0.04) + rng.normal(0, 4)));
    const ga = Math.max(10, Math.round(games * (1.45 - (s - mean) * 0.04) + rng.normal(0, 4)));
    return { clubId: id, played: games, w, d, l, gf, ga, pts: w * 3 + d, form: "" };
  });
  // Rangfolge nach Pseudo-Punkten (stabil zur Stärke-Reihenfolge)
  rows.sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga));
  return rows;
}
