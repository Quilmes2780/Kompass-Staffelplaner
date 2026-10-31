// Zustand-Store: dünne Hülle um die Engine. Jede Spielaktion ist eine reine Engine-Funktion.
import { create } from "zustand";
import { del, get, keys, set } from "idb-keyval";
import { newGame, type RuleError } from "../engine/game";
import type { NewGameOptions } from "../engine/setup";
import { exportState, importState } from "../engine/persistence";
import type { ClubId, GameState, Phase } from "../engine/types";
import { seasonLabel } from "../config/rules";

export type Screen = "SAISON" | "EINTEILUNG" | "ZULASSUNG" | "VEREINE" | "STATISTIK" | "VERBAND" | "EINSTELLUNGEN";

export interface SaveMeta {
  key: string;
  name: string;
  savedAt: string;
  season: string;
  phase: Phase;
}

interface Store {
  game: GameState | null;
  screen: Screen;
  club: ClubId | null;
  toast: { text: string; kind: "error" | "info" } | null;
  saves: SaveMeta[];
  busy: boolean;
  setScreen: (s: Screen) => void;
  openClub: (id: ClubId | null) => void;
  /** Engine-Aktion ausführen; Fehler werden als Meldung angezeigt */
  act: (fn: (g: GameState) => GameState) => boolean;
  /** Lange Aktion (z. B. Saisonsimulation) mit Ladeanzeige */
  actAsync: (fn: (g: GameState) => GameState) => Promise<void>;
  start: (opts: NewGameOptions) => void;
  load: (g: GameState) => void;
  notify: (text: string, kind?: "error" | "info") => void;
  refreshSaves: () => Promise<void>;
  saveAs: (name: string) => Promise<void>;
  loadSave: (key: string) => Promise<void>;
  deleteSave: (key: string) => Promise<void>;
}

export function screenForPhase(p: Phase): Screen {
  if (p === "ALLOCATION") return "EINTEILUNG";
  if (p === "LICENSING") return "ZULASSUNG";
  return "SAISON";
}

const AUTOSAVE = "save:autosave";

async function writeSave(key: string, name: string, g: GameState) {
  const meta: SaveMeta = { key, name, savedAt: new Date().toISOString(), season: seasonLabel(g.season), phase: g.phase };
  await set(key, { meta, json: exportState(g) });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<Store>((setS, getS) => ({
  game: null,
  screen: "SAISON",
  club: null,
  toast: null,
  saves: [],
  busy: false,
  setScreen: (screen) => setS({ screen }),
  openClub: (club) => setS({ club }),
  notify: (text, kind = "error") => {
    setS({ toast: { text, kind } });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setS({ toast: null }), kind === "error" ? 7000 : 3500);
  },
  act: (fn) => {
    const g = getS().game;
    if (!g) return false;
    try {
      const next = fn(g);
      const phaseChanged = next.phase !== g.phase;
      setS({ game: next, ...(phaseChanged ? { screen: screenForPhase(next.phase) } : {}) });
      if (phaseChanged) void writeSave(AUTOSAVE, "Automatisch", next).then(() => getS().refreshSaves());
      return true;
    } catch (e) {
      const err = e as RuleError;
      getS().notify(err.message || String(e));
      return false;
    }
  },
  actAsync: async (fn) => {
    setS({ busy: true });
    await new Promise((r) => setTimeout(r, 30));
    getS().act(fn);
    setS({ busy: false });
  },
  start: (opts) => {
    const g = newGame(opts);
    setS({ game: g, screen: screenForPhase(g.phase), club: null });
    void writeSave(AUTOSAVE, "Automatisch", g).then(() => getS().refreshSaves());
  },
  load: (g) => setS({ game: g, screen: screenForPhase(g.phase), club: null }),
  refreshSaves: async () => {
    try {
      const ks = (await keys()).filter((k) => String(k).startsWith("save:"));
      const metas: SaveMeta[] = [];
      for (const k of ks) {
        const v = (await get(k)) as { meta: SaveMeta } | undefined;
        if (v?.meta) metas.push(v.meta);
      }
      metas.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
      setS({ saves: metas });
    } catch {
      setS({ saves: [] });
    }
  },
  saveAs: async (name) => {
    const g = getS().game;
    if (!g) return;
    const key = `save:${Date.now()}`;
    await writeSave(key, name || "Spielstand", g);
    await getS().refreshSaves();
    getS().notify(`Gespeichert: ${name || "Spielstand"}`, "info");
  },
  loadSave: async (key) => {
    const v = (await get(key)) as { json: string } | undefined;
    if (!v) return getS().notify("Spielstand nicht gefunden");
    try {
      getS().load(importState(v.json));
      getS().notify("Spielstand geladen", "info");
    } catch (e) {
      getS().notify((e as Error).message);
    }
  },
  deleteSave: async (key) => {
    await del(key);
    await getS().refreshSaves();
  },
}));

/** Beim Start: Autosave laden, falls vorhanden */
export async function restoreAutosave(): Promise<boolean> {
  try {
    const v = (await get(AUTOSAVE)) as { json: string } | undefined;
    if (!v) return false;
    useStore.getState().load(importState(v.json));
    return true;
  } catch {
    return false;
  }
}
