// Headless-Simulation: npx tsx scripts/headless.ts [Saisons] [Seed] [REAL|FICTIONAL]
import { seasonLabel } from "../config/rules";
import { autoAdvance, newGame } from "../engine/game";
import { checkLeagueInvariants } from "../engine/leagues";

const seasons = Number(process.argv[2] ?? 10);
const seed = Number(process.argv[3] ?? 1);
const world = (process.argv[4] ?? "REAL") as "REAL" | "FICTIONAL";
let s = newGame({ seed, world });
const t0 = Date.now();
for (let i = 0; i < seasons && s.phase !== "GAME_OVER"; i++) {
  s = autoAdvance(s);
  const sum = s.history.seasons[s.history.seasons.length - 1];
  const errs = checkLeagueInvariants(s);
  console.log(
    `${seasonLabel(sum.season)}  Tore/Spiel ${sum.goalsPerGame.toFixed(2)}  Heimsiege ${(sum.homeWinRate * 100).toFixed(1)} %  Remis ${(sum.drawRate * 100).toFixed(1)} %` +
      `  km ${Math.round(sum.metrics!.totalKm).toLocaleString("de-DE")}  Akzeptanz ${sum.acceptance}  Note ${sum.grade}` +
      `  Zuschauer ${sum.avgAttendanceRL}  Erlös ${(sum.revenue / 1e6).toFixed(1)} Mio.  Sonderfälle ${sum.specialCases.length}` +
      (errs.length ? `  INVARIANTEN: ${errs.join("; ")}` : ""),
  );
}
console.log(`Fertig in ${((Date.now() - t0) / 1000).toFixed(1)} s, Phase ${s.phase}, Vereine ${Object.keys(s.clubs).length}, JSON ${(JSON.stringify(s).length / 1e6).toFixed(1)} MB`);
