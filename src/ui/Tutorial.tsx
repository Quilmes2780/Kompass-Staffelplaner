import { useState } from "react";
import { useStore } from "../store";

const STEPS = [
  {
    title: "Willkommen in der Verbandszentrale",
    text: "Sie leiten den Spielbetrieb der viergleisigen Regionalliga. Jedes Jahr teilen Sie 80 Teams auf vier Staffeln à 20 auf – vorrangig nach kurzen Reisewegen, aber mit Augenmaß für Derbys, Planungssicherheit und Zweitvertretungen.",
  },
  {
    title: "Der Algorithmus-Vorschlag",
    text: "Die Karte zeigt den Vorschlag des Optimierers. Farben = Staffeln, Rauten = Zweitvertretungen, Linien = Derbys (rot gestrichelt = getrennt). Mit dem Mausrad zoomen, mit gedrückter Maus verschieben.",
  },
  {
    title: "Vereine verschieben",
    text: "Ziehen Sie einen Verein auf der Karte in Richtung einer anderen Staffel oder auf die Legende. In den Listen rechts: auf eine Staffel ziehen = verschieben, auf einen Verein ziehen = tauschen. Eine Staffel muss am Ende genau 20 Teams haben.",
  },
  {
    title: "Fixieren & neu optimieren",
    text: "Klicken Sie einen Verein an und fixieren Sie ihn (📌). „Neu optimieren“ verteilt danach alle übrigen Vereine optimal – fixierte bleiben, wo sie sind.",
  },
  {
    title: "Kennzahlen & Ampeln",
    text: "Oben sehen Sie Gesamt-km, Fairness, Derbys, Zweitvertretungen, Staffelwechsler und mehr. Die Ampeln zeigen, wo Stakeholder unruhig werden. Das „?“ erklärt jede Regel.",
  },
  {
    title: "Härtefälle & Veröffentlichung",
    text: "Unter „Härtefälle“ entscheiden Sie über Anträge der Vereine. Speichern Sie Varianten (A/B/C) zum Vergleich. „Veröffentlichen“ prüft alle Regeln – ungültige Einteilungen werden mit der verletzten Regel abgelehnt.",
  },
];

export function Tutorial() {
  const act = useStore((s) => s.act);
  const [i, setI] = useState(0);
  const done = () => act((g) => ({ ...g, settings: { ...g.settings, tutorialDone: true } }));
  const s = STEPS[i];
  return (
    <div className="tutorial" role="dialog" aria-label="Tutorial">
      <div className="small" style={{ opacity: 0.7 }}>
        Tutorial {i + 1}/{STEPS.length}
      </div>
      <h3>{s.title}</h3>
      <p style={{ fontSize: 13, lineHeight: 1.45 }}>{s.text}</p>
      <div className="spread">
        <button className="btn small" onClick={done}>
          Überspringen
        </button>
        <div className="row">
          {i > 0 && (
            <button className="btn small" onClick={() => setI(i - 1)}>
              Zurück
            </button>
          )}
          <button className="btn small primary" onClick={() => (i + 1 < STEPS.length ? setI(i + 1) : done())}>
            {i + 1 < STEPS.length ? "Weiter" : "Los geht's"}
          </button>
        </div>
      </div>
    </div>
  );
}
