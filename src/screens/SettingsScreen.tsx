import { useEffect, useRef, useState } from "react";
import { cloneRules, KOMPASS_RULES, MODEL_22_5_RULES, seasonLabel, type RulesConfig } from "../../config/rules";
import { exportMasterData, exportState, importState } from "../../engine/persistence";
import type { GameState, Settings } from "../../engine/types";
import { useStore, type SaveMeta } from "../store";
import { Confirm, Tip } from "../ui/components";
import { download, fmt } from "../ui/format";

export function SettingsScreen() {
  const g = useStore((s) => s.game);
  return (
    <div className="grid g2">
      <NewGameCard />
      <div>
        {g && <CurrentSettings g={g} />}
        <SavesCard />
      </div>
    </div>
  );
}

function NewGameCard() {
  const start = useStore((s) => s.start);
  const g = useStore((s) => s.game);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6));
  const [world, setWorld] = useState<"REAL" | "FICTIONAL">("REAL");
  const [preset, setPreset] = useState<"KOMPASS" | "MODEL_22_5">("KOMPASS");
  const [prolog, setProlog] = useState(false);
  const [roadFactor, setRoadFactor] = useState(KOMPASS_RULES.allocation.roadFactor);
  const [derbyW, setDerbyW] = useState(KOMPASS_RULES.allocation.weights.derbySplitPerWeight);
  const [maxRes, setMaxRes] = useState(KOMPASS_RULES.rl.maxReservesPerGroup);
  const [mode, setMode] = useState<"CLUSTER" | "COMPASS">("CLUSTER");
  const [compass, setCompass] = useState<"N" | "O" | "S" | "W">("N");
  const [difficulty, setDifficulty] = useState<Settings["difficulty"]>("NORMAL");
  const [asking, setAsking] = useState(false);
  const go = () => {
    setAsking(false);
    const rules: RulesConfig = cloneRules(preset === "KOMPASS" ? KOMPASS_RULES : MODEL_22_5_RULES);
    rules.prolog.enabled = prolog;
    rules.allocation.roadFactor = roadFactor;
    rules.allocation.weights.derbySplitPerWeight = derbyW;
    rules.rl.maxReservesPerGroup = maxRes;
    rules.allocation.mode = mode;
    rules.allocation.compassStart = compass;
    start({ seed, world, rules, settings: { difficulty } });
  };
  return (
    <div className="card">
      <h2>Neues Spiel</h2>
      <div className="grid g2">
        <label className="field">
          <span>Seed (gleicher Seed + gleiche Entscheidungen = gleiches Spiel)</span>
          <div className="row">
            <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} style={{ width: 140 }} />
            <button className="btn small" onClick={() => setSeed(Math.floor(Math.random() * 1e6))}>
              Zufall
            </button>
          </div>
        </label>
        <label className="field">
          <span>Welt</span>
          <select value={world} onChange={(e) => setWorld(e.target.value as "REAL" | "FICTIONAL")}>
            <option value="REAL">Echtdaten (Stand 2026/27)</option>
            <option value="FICTIONAL">Fiktive Welt (generiert aus Seed)</option>
          </select>
        </label>
        <label className="field">
          <span>Regelwerk</span>
          <select value={preset} onChange={(e) => setPreset(e.target.value as "KOMPASS" | "MODEL_22_5")}>
            <option value="KOMPASS">Kompassmodell (4 × 20)</option>
            <option value="MODEL_22_5">22/5-Modell (5 × 18)</option>
          </select>
        </label>
        <label className="field">
          <span>Prolog „Bundestag 18.12.2026“</span>
          <select value={prolog ? "1" : "0"} onChange={(e) => setProlog(e.target.value === "1")}>
            <option value="0">überspringen (Kompassmodell gilt)</option>
            <option value="1">spielen</option>
          </select>
        </label>
        <label className="field">
          <span>
            Straßenfaktor <Tip text="Faktor auf die Luftlinie für die Reise-km (Standard 1,25)." />
          </span>
          <input type="number" step="0.05" min="1" max="2" value={roadFactor} onChange={(e) => setRoadFactor(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>
            Gewichtung Derbys (km je Gewichtspunkt) <Tip text="Wie viele Reise-km der Optimierer für den Erhalt eines Derbys (je Gewichtspunkt 1–3) in Kauf nimmt. 0 = reine km-Optimierung." />
          </span>
          <input type="number" step="25" min="0" value={derbyW} onChange={(e) => setDerbyW(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Zweitvertretungs-Grenze je Staffel</span>
          <input type="number" min="1" max="20" value={maxRes} onChange={(e) => setMaxRes(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Vorschlagsmodus</span>
          <div className="row">
            <select value={mode} onChange={(e) => setMode(e.target.value as "CLUSTER" | "COMPASS")}>
              <option value="CLUSTER">Clustering + Swap-Optimierung</option>
              <option value="COMPASS">Kompass-Rotation</option>
            </select>
            {mode === "COMPASS" && (
              <select value={compass} onChange={(e) => setCompass(e.target.value as "N" | "O" | "S" | "W")}>
                <option value="N">Start Nord</option>
                <option value="O">Start Ost</option>
                <option value="S">Start Süd</option>
                <option value="W">Start West</option>
              </select>
            )}
          </div>
        </label>
        <label className="field">
          <span>Schwierigkeit (Empfindlichkeit der Stakeholder, Ereignishäufigkeit)</span>
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Settings["difficulty"])}>
            <option value="LEICHT">Leicht</option>
            <option value="NORMAL">Normal</option>
            <option value="SCHWER">Schwer</option>
          </select>
        </label>
      </div>
      <button className="btn primary mt" onClick={() => (g && g.phase !== "GAME_OVER" ? setAsking(true) : go())}>
        Spiel starten
      </button>
      {asking && (
        <Confirm
          text="Laufendes Spiel verwerfen? Es bleibt als automatischer Spielstand erhalten, bis Sie im neuen Spiel weiterspielen."
          ok="Neues Spiel starten"
          danger
          onOk={go}
          onCancel={() => setAsking(false)}
        />
      )}
    </div>
  );
}

function CurrentSettings({ g }: { g: GameState }) {
  const act = useStore((s) => s.act);
  const setRules = (f: (r: RulesConfig) => void) =>
    act((s) => {
      const rules = cloneRules(s.rules);
      f(rules);
      return { ...s, rules };
    });
  const setSettings = (p: Partial<Settings>) => act((s) => ({ ...s, settings: { ...s.settings, ...p } }));
  return (
    <div className="card">
      <h2>Laufendes Spiel</h2>
      <p className="small muted">
        Seed {g.seed} · {g.worldKind === "REAL" ? "Echtdaten" : "Fiktive Welt"} · {g.rules.name} · Saison {seasonLabel(g.season)}
      </p>
      <div className="grid g2">
        <label className="field">
          <span>Schwierigkeit</span>
          <select value={g.settings.difficulty} onChange={(e) => setSettings({ difficulty: e.target.value as Settings["difficulty"] })}>
            <option value="LEICHT">Leicht</option>
            <option value="NORMAL">Normal</option>
            <option value="SCHWER">Schwer</option>
          </select>
        </label>
        <label className="field">
          <span>Straßenfaktor (wirkt ab nächster Einteilung)</span>
          <input type="number" step="0.05" min="1" max="2" value={g.rules.allocation.roadFactor} onChange={(e) => setRules((r) => (r.allocation.roadFactor = Number(e.target.value) || 1.25))} />
        </label>
        <label className="field">
          <span>Gewichtung Derbys (km je Gewichtspunkt)</span>
          <input type="number" step="25" min="0" value={g.rules.allocation.weights.derbySplitPerWeight} onChange={(e) => setRules((r) => (r.allocation.weights.derbySplitPerWeight = Number(e.target.value)))} />
        </label>
        <label className="field">
          <span>Gewichtung Planungssicherheit (km je Staffelwechsler)</span>
          <input type="number" step="50" min="0" value={g.rules.allocation.weights.groupChange} onChange={(e) => setRules((r) => (r.allocation.weights.groupChange = Number(e.target.value)))} />
        </label>
        <label className="field">
          <span>Gewichtung Leistungsbalance</span>
          <input type="number" step="500" min="0" value={g.rules.allocation.weights.strengthImbalance} onChange={(e) => setRules((r) => (r.allocation.weights.strengthImbalance = Number(e.target.value)))} />
        </label>
        <label className="field">
          <span>Zweitvertretungs-Grenze je Staffel</span>
          <input type="number" min="1" max="20" value={g.rules.rl.maxReservesPerGroup} onChange={(e) => setRules((r) => (r.rl.maxReservesPerGroup = Number(e.target.value)))} />
        </label>
        <label className="field">
          <span>Vorschlagsmodus</span>
          <select value={g.rules.allocation.mode === "COMPASS" ? `C-${g.rules.allocation.compassStart}` : "CLUSTER"} onChange={(e) => setRules((r) => {
            if (e.target.value === "CLUSTER") r.allocation.mode = "CLUSTER";
            else {
              r.allocation.mode = "COMPASS";
              r.allocation.compassStart = e.target.value.slice(2) as "N" | "O" | "S" | "W";
            }
          })}>
            <option value="CLUSTER">Clustering + Swap-Optimierung</option>
            <option value="C-N">Kompass-Rotation (Start Nord)</option>
            <option value="C-O">Kompass-Rotation (Start Ost)</option>
            <option value="C-S">Kompass-Rotation (Start Süd)</option>
            <option value="C-W">Kompass-Rotation (Start West)</option>
          </select>
        </label>
        <label className="field">
          <span>Simulationsgeschwindigkeit (Standard-Schritt)</span>
          <select value={g.settings.simSpeed} onChange={(e) => setSettings({ simSpeed: e.target.value as Settings["simSpeed"] })}>
            <option value="SPIELTAG">Spieltag</option>
            <option value="WOCHE">Woche</option>
            <option value="SAISON">Bis Saisonende</option>
          </select>
        </label>
      </div>
      <div className="row mt">
        <button className="btn small" onClick={() => setSettings({ tutorialDone: false })}>
          Tutorial erneut zeigen
        </button>
      </div>
      <p className="small muted mt">
        Weitere Regelparameter (Kontingente, Zulassung, Finanzen) stehen in <code>config/rules.ts</code>. Aktive Werte: Garantie {fmt(g.rules.finance.guaranteePerClub)} €, Ausschüttung {g.rules.finance.distributionShare * 100} %, Kapazität ≥{" "}
        {fmt(g.rules.licensing.minCapacity)}.
      </p>
    </div>
  );
}

function SavesCard() {
  const g = useStore((s) => s.game);
  const saves = useStore((s) => s.saves);
  const refresh = useStore((s) => s.refreshSaves);
  const saveAs = useStore((s) => s.saveAs);
  const loadSave = useStore((s) => s.loadSave);
  const deleteSave = useStore((s) => s.deleteSave);
  const load = useStore((s) => s.load);
  const notify = useStore((s) => s.notify);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<SaveMeta | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const onImport = async (f: File) => {
    try {
      load(importState(await f.text()));
      notify("Spielstand importiert", "info");
    } catch (e) {
      notify((e as Error).message);
    }
  };
  return (
    <div className="card">
      <h2>Spielstände</h2>
      {g && (
        <div className="row mb">
          <input type="text" placeholder="Name des Spielstands" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" onClick={() => void saveAs(name)}>
            Speichern
          </button>
          <button className="btn" onClick={() => download(`kompass-${g.seed}-${seasonLabel(g.season).replace("/", "-")}.json`, exportState(g))}>
            JSON exportieren
          </button>
          <button className="btn" onClick={() => download(`kompass-stammdaten.json`, exportMasterData(g))} title="Vereine, Derbys und Oberligen im Schema von data/*.json">
            Stammdaten exportieren
          </button>
        </div>
      )}
      <div className="row mb">
        <input ref={file} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && void onImport(e.target.files[0])} />
        <button className="btn" onClick={() => file.current?.click()}>
          JSON importieren …
        </button>
      </div>
      <table className="t">
        <thead>
          <tr>
            <th>Name</th>
            <th>Saison</th>
            <th>Gespeichert</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {saves.map((s) => (
            <tr key={s.key}>
              <td>{s.name}</td>
              <td>
                {s.season} · {s.phase}
              </td>
              <td className="small">{new Date(s.savedAt).toLocaleString("de-DE")}</td>
              <td className="right">
                <button className="btn small" onClick={() => void loadSave(s.key)}>
                  Laden
                </button>{" "}
                <button className="btn small danger" onClick={() => setDeleting(s)}>
                  Löschen
                </button>
              </td>
            </tr>
          ))}
          {!saves.length && (
            <tr>
              <td className="muted" colSpan={4}>
                Keine Spielstände.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {deleting && (
        <Confirm
          text={`Spielstand „${deleting.name}“ löschen?`}
          ok="Löschen"
          danger
          onOk={() => {
            void deleteSave(deleting.key);
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
