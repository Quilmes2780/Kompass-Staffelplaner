// Zulassungsverfahren für die Regionalliga.
import { rebalance, removeFrom, addTo, enforceReserves } from "./promotion";
import { rlClubs } from "./leagues";
import { rngFor } from "./rng";
import { balanceOberligen } from "./setup";
import type { ClubId, GameState, LicenseApplication, LicenseDeficit, LicenseStatus, Movement } from "./types";
import { addNews, nextId } from "./news";
import { adjust } from "./stakeholders";

const FIXABLE = new Set(["SEATS", "PRESS", "LUX_TARGET"]);

export function economicStage(state: GameState, season = state.season) {
  const stages = state.rules.licensing.economicStages.filter((s) => s.from <= season);
  return stages[stages.length - 1] ?? { from: season, minBudget: 0, label: "keine Prüfung" };
}

export function deficitsFor(state: GameState, id: ClubId, season = state.season): LicenseDeficit[] {
  const c = state.clubs[id];
  const L = state.rules.licensing;
  const infraMandatory = season >= L.infrastructureMandatoryFrom;
  const s = c.stadium;
  const d: LicenseDeficit[] = [];
  const fmt = (n: number) => n.toLocaleString("de-DE");
  if (s.capacity < L.minCapacity)
    d.push({ code: "CAPACITY", message: `Kapazität ${fmt(s.capacity)} < ${fmt(L.minCapacity)} Plätze`, mandatory: infraMandatory });
  if (s.seats < L.minSeats) d.push({ code: "SEATS", message: `nur ${s.seats} Sitzplätze (mind. ${L.minSeats})`, mandatory: true });
  if (s.lux < L.minLux) d.push({ code: "LUX", message: `Flutlicht ${s.lux} lx < ${L.minLux} lx`, mandatory: infraMandatory });
  else if (s.lux < L.targetLux) d.push({ code: "LUX_TARGET", message: `Flutlicht ${s.lux} lx unter Zielwert ${L.targetLux} lx`, mandatory: false });
  if (s.pressSeats < L.minPress) d.push({ code: "PRESS", message: `nur ${s.pressSeats} Presseplätze (mind. ${L.minPress})`, mandatory: true });
  const stage = economicStage(state, season);
  if (stage.minBudget > 0 && c.budget < stage.minBudget)
    d.push({ code: "ECONOMIC", message: `Etat ${fmt(c.budget)} € unter Mindestetat ${fmt(stage.minBudget)} € (${stage.label})`, mandatory: true });
  return d;
}

/** Anträge aller Vereine, die in der kommenden Saison Regionalliga spielen sollen */
export function openLicensing(state: GameState): void {
  const apps: LicenseApplication[] = rlClubs(state.leagues).map((id) => {
    const deficits = deficitsFor(state, id);
    // Sitz- und Presseplätze gelten als kurzfristig per Auflage behebbar; der Spieler entscheidet nur über
    // Infrastruktur (Kapazität/Flutlicht) und wirtschaftliche Mängel.
    const clean = deficits.every((x) => FIXABLE.has(x.code) || !x.mandatory) && !deficits.some((x) => x.code === "CAPACITY" || x.code === "LUX");
    const app: LicenseApplication = { clubId: id, level: "RL", deficits, conditions: [], clean };
    if (clean) {
      app.decision = deficits.length ? "CONDITIONS" : "GRANTED";
      app.conditions = deficits.map((x) => x.message);
    }
    return app;
  });
  apps.sort((a, b) => Number(a.clean) - Number(b.clean) || a.clubId.localeCompare(b.clubId));
  state.licensing = { season: state.season, applications: apps };
}

/** Vorschlag der Geschäftsstelle für eine Entscheidung */
export function suggestDecision(state: GameState, app: LicenseApplication): LicenseStatus {
  if (app.clean) return app.deficits.length ? "CONDITIONS" : "GRANTED";
  const mandatory = app.deficits.filter((d) => d.mandatory && !FIXABLE.has(d.code));
  if (!mandatory.length) return "CONDITIONS";
  const c = state.clubs[app.clubId];
  if (mandatory.some((d) => d.code === "ECONOMIC") && c.budget < economicStage(state).minBudget * 0.5) return "DENIED";
  // Auflagen im Vorjahr nicht erfüllt → Ausnahme nur noch mit Begründung, sonst Verweigerung
  if (repeatedDeficit(state, app)) return mandatory.length >= 2 && c.budget < 1_000_000 ? "DENIED" : "EXEMPTION";
  return c.budget >= 1_200_000 ? "CONDITIONS" : "EXEMPTION";
}

/** Hatte der Verein in der Vorsaison bereits eine Auflage zu demselben Mangel? */
export function repeatedDeficit(state: GameState, app: LicenseApplication): boolean {
  const prev = state.history.clubSeasons.find((r) => r.season === state.season - 1 && r.clubId === app.clubId);
  if (!prev || (prev.license.status !== "CONDITIONS" && prev.license.status !== "EXEMPTION")) return false;
  return app.deficits.some((d) => d.mandatory && !FIXABLE.has(d.code) && prev.license.conditions.some((c) => c.startsWith(d.message.split(" ")[0])));
}

/** Hat ein Verein Pflichtmängel, die ihm die Zulassung für die Regionalliga verwehren würden? */
export function hasHardDeficits(state: GameState, id: ClubId, season: number): boolean {
  return deficitsFor(state, id, season).some((d) => d.mandatory && !FIXABLE.has(d.code));
}

export function decideLicense(state: GameState, clubId: ClubId, decision: LicenseStatus): void {
  const app = state.licensing?.applications.find((a) => a.clubId === clubId);
  if (!app) throw new Error(`Kein Antrag von ${clubId}`);
  app.decision = decision;
  app.conditions = decision === "CONDITIONS" || decision === "EXEMPTION" ? app.deficits.map((d) => d.message) : [];
}

export function allLicensesDecided(state: GameState): boolean {
  return !!state.licensing && state.licensing.applications.every((a) => a.decision);
}

/**
 * Entscheidungen anwenden: Verweigerungen führen (ggf. nach Sportgericht) zum Abstieg in die Oberliga,
 * Nachrücker werden nach Regelwerk bestimmt. Ausnahmegenehmigungen schaffen Präzedenzfälle.
 */
export function finishLicensing(state: GameState): void {
  if (!state.licensing) return;
  const movements: Record<ClubId, Movement> = {};
  const notes: string[] = [];
  const last = state.history.seasons[state.history.seasons.length - 1];
  const rankOf: Record<ClubId, { compId: string; rank: number; ppg: number }> = {};
  if (last)
    for (const [compId, t] of Object.entries(last.tables))
      t.forEach((row, i) => (rankOf[row.clubId] = { compId, rank: i + 1, ppg: row.played ? row.pts / row.played : 0 }));
  const sens = sensitivity(state);
  const exemptionsSoFar = state.precedents.filter((p) => p.kind === "EXEMPTION").length;
  let exemptions = 0;
  let softConditions = 0;
  for (const app of state.licensing.applications) {
    const c = state.clubs[app.clubId];
    const dec = app.decision ?? suggestDecision(state, app);
    state.licenseThisSeason[app.clubId] = { status: dec, conditions: app.conditions };
    if (dec === "EXEMPTION") {
      state.precedents.push({ season: state.season, clubId: app.clubId, kind: "EXEMPTION", detail: app.deficits.map((d) => d.code).join(", ") });
      adjust(state, app.clubId, 8);
      exemptions++;
      // Ausnahmegenehmigungen setzen Anreize, die Infrastruktur trotzdem nachzubessern
      improveStadium(state, app.clubId, app.deficits.map((d) => d.code));
    } else if (dec === "CONDITIONS") {
      if (!app.clean) {
        // Auflagen trotz Pflichtmängeln: Verein muss bis zur nächsten Saison nachbessern
        adjust(state, app.clubId, -2);
        softConditions++;
      }
      // Auflagen werden mit gewisser Wahrscheinlichkeit erfüllt → Stadion wird ertüchtigt
      improveStadium(state, app.clubId, app.deficits.map((d) => d.code));
    } else if (dec === "DENIED") {
      const rng = rngFor(state.seed, state.season, "court", app.clubId);
      const precedentHelps = state.precedents.some((p) => p.kind === "EXEMPTION" && app.deficits.some((d) => p.detail.includes(d.code)));
      const appealSuccess = rng.chance(precedentHelps ? 0.55 : 0.2);
      const caseId = nextId(state, "court");
      state.courtCases.push({ id: caseId, season: state.season, clubId: app.clubId, subject: "Lizenzverweigerung Regionalliga", outcome: appealSuccess ? "OVERTURNED" : "UPHELD" });
      state.counters.courtFreeSeasons = 0;
      if (appealSuccess) {
        state.licenseThisSeason[app.clubId] = { status: "EXEMPTION", conditions: ["Zulassung durch Sportgericht"] };
        addNews(state, `Sportgericht kippt Lizenzverweigerung: ${c.name} darf Regionalliga spielen`, "neg", [app.clubId],
          precedentHelps ? "Das Gericht verweist auf frühere Ausnahmegenehmigungen in vergleichbaren Fällen." : undefined);
        adjust(state, "PRAESIDIUM", -4 * sens);
        adjust(state, "MEDIA", -2 * sens);
      } else {
        movements[app.clubId] = "LICENSE_DENIED";
        removeFrom(state.leagues, app.clubId);
        addTo(state, state.leagues, app.clubId, "OL");
        addNews(state, `Keine Zulassung: ${c.name} muss in die Oberliga`, "neg", [app.clubId]);
        adjust(state, app.clubId, -30);
        adjust(state, c.regionalverband, -3 * sens);
        adjust(state, "FANS", -2 * sens);
        state.precedents.push({ season: state.season, clubId: app.clubId, kind: "DENIAL", detail: app.deficits.map((d) => d.code).join(", ") });
      }
    }
  }
  // Präsidium und Medien bewerten die Linie des Verfahrens insgesamt (Präzedenzfälle wirken nach)
  if (exemptions || softConditions) {
    const k = sens * (1 + exemptionsSoFar / 80);
    adjust(state, "PRAESIDIUM", -k * (1.2 * Math.sqrt(exemptions) + 0.4 * Math.sqrt(softConditions)));
    adjust(state, "MEDIA", -sens * 0.8 * Math.sqrt(exemptions));
    if (exemptions >= 5) addNews(state, `${exemptions} Ausnahmegenehmigungen – Kritik an „Lizenz light“`, "neg");
  }
  if (Object.keys(movements).length) {
    rebalance(state, state.leagues, movements, notes, rankOf);
    enforceReserves(state, state.leagues, movements, notes);
    rebalance(state, state.leagues, movements, notes, rankOf);
    balanceOberligen(state, state.leagues, rngFor(state.seed, state.season, "licensing-balance"));
    for (const n of notes) addNews(state, n, "neutral");
    // Nachrücker erhalten automatisch eine Zulassung mit Auflagen
    for (const [id, m] of Object.entries(movements))
      if ((m === "REINSTATED" || m === "PROMOTED") && !state.licenseThisSeason[id])
        state.licenseThisSeason[id] = { status: "CONDITIONS", conditions: ["Nachrücker-Zulassung"] };
    // Bewegungen in die Historie der Vorsaison übernehmen
    for (const rec of state.history.clubSeasons) {
      if (rec.season !== state.season - 1) continue;
      const m = movements[rec.clubId];
      if (m) rec.movement = m;
    }
  }
}

export function improveStadium(state: GameState, id: ClubId, codes: string[]): void {
  const c = state.clubs[id];
  const L = state.rules.licensing;
  const rng = rngFor(state.seed, state.season, "stadium", id);
  const p = c.budget > 2_000_000 ? 0.75 : c.budget > 1_200_000 ? 0.5 : 0.3;
  for (const code of codes) {
    if (!rng.chance(FIXABLE.has(code) ? 0.9 : p)) continue;
    const s = c.stadium;
    if (code === "SEATS") s.seats = Math.max(s.seats, L.minSeats + rng.int(0, 150));
    if (code === "PRESS") s.pressSeats = Math.max(s.pressSeats, L.minPress + rng.int(0, 3));
    if (code === "LUX" || code === "LUX_TARGET") s.lux = Math.max(s.lux, code === "LUX" ? L.minLux + rng.int(0, 150) : L.targetLux);
    if (code === "CAPACITY") s.capacity = Math.max(s.capacity, L.minCapacity + rng.int(0, 500));
  }
}

export function sensitivity(state: GameState): number {
  return state.settings.difficulty === "LEICHT" ? 0.7 : state.settings.difficulty === "SCHWER" ? 1.4 : 1;
}
