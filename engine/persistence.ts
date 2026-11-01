// JSON-Export/-Import von Spielständen und Stammdaten (UI-unabhängig).
import { upgradeRules, validateRules } from "../config/rules";
import { STATE_VERSION } from "./setup";
import type { Club, Derby, GameState, Oberliga } from "./types";
import { validateWorld } from "./world";

export interface SaveFile {
  format: "kompass-save";
  version: number;
  exportedAt: string;
  state: GameState;
}

export function exportState(state: GameState, exportedAt = new Date().toISOString()): string {
  const file: SaveFile = { format: "kompass-save", version: STATE_VERSION, exportedAt, state };
  return JSON.stringify(file);
}

export function importState(json: string): GameState {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Datei ist kein gültiges JSON.");
  }
  const f = data as Partial<SaveFile>;
  if (f.format !== "kompass-save" || !f.state) throw new Error("Keine KOMPASS-Spielstanddatei.");
  if ((f.version ?? 0) > STATE_VERSION) throw new Error(`Spielstand-Version ${f.version} ist neuer als diese Spielversion (${STATE_VERSION}).`);
  const s = f.state;
  const errs = [...validateRules(s.rules)];
  if (!s.clubs || !s.leagues || !s.history) errs.push("Spielstand unvollständig.");
  if (errs.length) throw new Error(`Spielstand ungültig: ${errs.join("; ")}`);
  return { ...s, rules: upgradeRules(s.rules) };
}

export interface MasterDataFile {
  format: "kompass-stammdaten";
  version: 1;
  clubs: Club[];
  derbies: Derby[];
  oberligen: Oberliga[];
}

/** Stammdaten (aktueller Stand eines Spielstands) exportieren – im selben Schema wie data/*.json */
export function exportMasterData(state: GameState): string {
  const file: MasterDataFile = {
    format: "kompass-stammdaten",
    version: 1,
    clubs: Object.values(state.clubs),
    derbies: state.derbies,
    oberligen: state.oberligen,
  };
  return JSON.stringify(file, null, 1);
}

export function importMasterData(json: string): MasterDataFile {
  const f = JSON.parse(json) as MasterDataFile;
  if (f.format !== "kompass-stammdaten") throw new Error("Keine KOMPASS-Stammdatendatei.");
  const errs = validateWorld({ clubs: f.clubs, derbies: f.derbies, oberligen: f.oberligen, kind: "REAL" });
  if (errs.length) throw new Error(`Stammdaten fehlerhaft:\n${errs.slice(0, 10).join("\n")}`);
  return f;
}

// ---------- CSV ----------

export function toCSV(rows: Record<string, unknown>[], columns?: string[]): string {
  if (!rows.length) return "";
  const cols = columns ?? Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Semikolon als Trenner (deutsches Excel)
  return [cols.join(";"), ...rows.map((r) => cols.map((c) => esc(r[c])).join(";"))].join("\n");
}

export function clubSeasonsCSV(state: GameState): string {
  return toCSV(
    state.history.clubSeasons.map((r) => ({
      saison: r.season,
      verein_id: r.clubId,
      verein: state.clubs[r.clubId]?.name,
      ebene: r.league.level,
      staffel: r.league.group,
      platz: r.rank,
      spiele: r.played,
      s: r.w,
      u: r.d,
      n: r.l,
      tore: r.gf,
      gegentore: r.ga,
      punkte: r.pts,
      bewegung: r.movement,
      titel: r.title ? 1 : 0,
      relegation: r.playoff ? `${r.playoff.name}:${r.playoff.won ? "gewonnen" : "verloren"}` : "",
      reise_km: r.travelKm,
      km_pro_auswaertsspiel: r.travelKmPerAway,
      zuschauerschnitt: r.avgAttendance,
      garantie: r.income.guarantee,
      ausschuettung: r.income.distribution,
      sonstige_einnahmen: r.income.other,
      etat_ende: r.budgetEnd,
      zulassung: r.license.status,
      auflagen: r.license.conditions.join(" | "),
      haertefaelle: r.hardship.map((h) => `${h.reason}:${h.granted ? "stattgegeben" : "abgelehnt"}`).join(" | "),
      staffelwechsel: r.groupChanged ? 1 : 0,
      derbys: r.derbiesPlayed,
      abstrakt: r.abstract ? 1 : 0,
    })),
  );
}

export function seasonsCSV(state: GameState): string {
  return toCSV(
    state.history.seasons.map((s) => ({
      saison: s.season,
      gesamt_km: Math.round(s.metrics?.totalKm ?? 0),
      gini: s.metrics?.giniKm.toFixed(3),
      derbys_erhalten: s.metrics?.derbiesKept,
      derbys_getrennt: s.metrics?.derbiesSplit,
      staffelwechsler: s.metrics?.groupChanges,
      leistungsstreuung: s.metrics?.strengthSpread.toFixed(2),
      co2_t: s.metrics?.co2Tonnes,
      tore_pro_spiel: s.goalsPerGame,
      heimsiegquote: s.homeWinRate,
      zuschauer: s.avgAttendanceRL,
      erloes: s.revenue,
      akzeptanz: s.acceptance,
      note: s.grade,
      aufsteiger_3liga: s.promotedToL3.join(" "),
      absteiger_rl: s.relegatedFromRL.join(" "),
      aufsteiger_ol: s.promotedFromOL.join(" "),
      sonderfaelle: s.specialCases.length,
    })),
  );
}
