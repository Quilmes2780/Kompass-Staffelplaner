import type { Ampel, Club, ClubId, GameState, Level } from "../../engine/types";

export const fmt = (n: number | undefined, digits = 0) =>
  n === undefined || Number.isNaN(n) ? "–" : n.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const eur = (n: number) => (Math.abs(n) >= 1e6 ? `${fmt(n / 1e6, 2)} Mio. €` : `${fmt(n)} €`);
export const pct = (n: number, d = 1) => `${fmt(n * 100, d)} %`;

export const GROUP_COLORS: Record<string, string> = {
  A: "var(--g-A)",
  B: "var(--g-B)",
  C: "var(--g-C)",
  D: "var(--g-D)",
  E: "var(--g-E)",
  POOL: "var(--g-POOL)",
};
// Staffelfarben: regionale Namen (aktuelle Regelwerke) und Buchstaben (ältere Spielstände)
export const GROUP_HEX: Record<string, string> = {
  West: "#0072b2", Nordost: "#e69f00", "Südost": "#009e73", "Südwest": "#cc79a7", Nord: "#0072b2", Ost: "#e69f00", "Süd": "#009e73",
  A: "#0072b2", B: "#e69f00", C: "#009e73", D: "#cc79a7", E: "#56b4e9", POOL: "#8892a0",
};

export const LEVEL_COLORS: Record<Level, string> = {
  BL: "#3b1f5e",
  BL2: "#5b3f8c",
  L3: "#1f5fae",
  RL: "#009e73",
  OL: "#c98a00",
  VL: "#a3a9b3",
};
export const LEVEL_SHORT: Record<Level, string> = { BL: "BL", BL2: "2.BL", L3: "3.L", RL: "RL", OL: "OL", VL: "VL" };

export const AMPEL_LABEL: Record<Ampel, string> = { green: "im Rahmen", yellow: "kritisch", red: "Problem" };

export function initials(c: Club): string {
  const words = c.shortName.replace(/[^A-Za-zÄÖÜäöüß0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const base = words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join("") : (words[0] ?? "?").slice(0, 2);
  return (base + (c.isReserve ? "²" : "")).toUpperCase();
}

export function clubName(g: GameState, id: ClubId, short = false): string {
  const c = g.clubs[id];
  return c ? (short ? c.shortName : c.name) : id;
}

export function textColorFor(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const gg = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * gg + 0.114 * b > 160 ? "#111" : "#fff";
}

export function download(filename: string, content: string, mime = "application/json") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
