import { useEffect, useState } from "react";
import { seasonLabel } from "../config/rules";
import { acceptance } from "../engine/stakeholders";
import type { Phase } from "../engine/types";
import { AllocationScreen } from "./screens/AllocationScreen";
import { ClubProfile, ClubsScreen } from "./screens/ClubsScreen";
import { LicensingScreen } from "./screens/LicensingScreen";
import { SeasonScreen } from "./screens/SeasonScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { StatsScreen } from "./screens/StatsScreen";
import { VerbandScreen } from "./screens/VerbandScreen";
import { restoreAutosave, useStore, type Screen } from "./store";
import { fmt } from "./ui/format";

const NAV: { id: Screen; label: string }[] = [
  { id: "SAISON", label: "Saison" },
  { id: "EINTEILUNG", label: "Staffeleinteilung" },
  { id: "ZULASSUNG", label: "Zulassung" },
  { id: "VEREINE", label: "Vereine" },
  { id: "STATISTIK", label: "Statistik" },
  { id: "VERBAND", label: "Verband" },
  { id: "EINSTELLUNGEN", label: "Einstellungen" },
];

const PHASE_LABEL: Record<Phase, string> = {
  PROLOG: "Prolog",
  LICENSING: "Zulassungsverfahren",
  ALLOCATION: "Staffeleinteilung",
  SEASON: "Saison läuft",
  WRAPUP: "Saisonabschluss",
  EVENTS: "Zwischensaison",
  EVALUATION: "Evaluierung",
  GAME_OVER: "Game over",
};

export function App() {
  const g = useStore((s) => s.game);
  const screen = useStore((s) => s.screen);
  const setScreen = useStore((s) => s.setScreen);
  const toast = useStore((s) => s.toast);
  const busy = useStore((s) => s.busy);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void restoreAutosave().then((ok) => {
      if (!ok) setScreen("EINSTELLUNGEN");
      setReady(true);
    });
  }, [setScreen]);

  const attention: Partial<Record<Screen, boolean>> = g
    ? { EINTEILUNG: g.phase === "ALLOCATION", ZULASSUNG: g.phase === "LICENSING", SAISON: ["SEASON", "WRAPUP", "EVENTS", "EVALUATION", "PROLOG"].includes(g.phase) }
    : {};

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span style={{ color: "#e69f00" }}>◆</span> KOMPASS <small>Der Staffelplaner</small>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.id} className={screen === n.id ? "active" : ""} onClick={() => setScreen(n.id)} disabled={!g && n.id !== "EINSTELLUNGEN"}>
              {n.label}
              {attention[n.id] && screen !== n.id && <span className="dot" />}
            </button>
          ))}
        </nav>
        {g && (
          <div className="status">
            <span>
              Saison <b>{seasonLabel(g.season)}</b>
            </span>
            <span>{PHASE_LABEL[g.phase]}</span>
            <span title="Gesamtakzeptanz der Reform">
              Akzeptanz <b>{fmt(acceptance(g), 1)}</b>
            </span>
          </div>
        )}
      </header>
      <main className="main">
        {!ready ? (
          <p className="muted">Lade …</p>
        ) : !g || screen === "EINSTELLUNGEN" ? (
          <>
            {!g && (
              <div className="card mb">
                <h2>Willkommen bei KOMPASS – Der Staffelplaner</h2>
                <p>
                  Sie leiten beim DFB den Spielbetrieb der viergleisigen Regionalliga. Starten Sie ein neues Spiel – die erste Aufgabe ist die Staffeleinteilung der Saison 2028/29.
                </p>
              </div>
            )}
            <SettingsScreen />
          </>
        ) : screen === "SAISON" ? (
          <SeasonScreen />
        ) : screen === "EINTEILUNG" ? (
          <AllocationScreen />
        ) : screen === "ZULASSUNG" ? (
          <LicensingScreen />
        ) : screen === "VEREINE" ? (
          <ClubsScreen />
        ) : screen === "STATISTIK" ? (
          <StatsScreen />
        ) : (
          <VerbandScreen />
        )}
      </main>
      <ClubProfile />
      {toast && (
        <div className={`toast ${toast.kind === "info" ? "info" : ""}`} role="alert">
          {toast.text}
        </div>
      )}
      {busy && (
        <div className="overlay" style={{ background: "rgba(15,25,40,.25)" }}>
          <div className="card">Berechne …</div>
        </div>
      )}
    </div>
  );
}
