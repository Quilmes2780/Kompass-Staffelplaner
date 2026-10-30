// Spielplan (Doppelrunde nach Kreismethode) und Tabellenberechnung.
import type { ClubId, Fixture, TableRow } from "./types";
import type { Rng } from "./rng";
import { hashKeys } from "./rng";

/** Doppelrunde: Hinrunde nach Kreismethode mit alternierendem Heimrecht, Rückrunde gespiegelt. */
export function doubleRoundRobin(clubs: ClubId[], rng: Rng): Fixture[] {
  const teams = rng.shuffle([...clubs]);
  if (teams.length % 2 === 1) teams.push("__BYE__");
  const n = teams.length;
  const rounds = n - 1;
  const half: Fixture[] = [];
  const arr = [...teams];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a === "__BYE__" || b === "__BYE__") continue;
      // Heimrecht alternieren, damit kein Team zu viele Heimspiele in Folge hat
      const swap = i === 0 ? r % 2 === 1 : (r + i) % 2 === 0;
      half.push({ home: swap ? b : a, away: swap ? a : b, matchday: r + 1 });
    }
    // Rotation: erstes Team fix
    arr.splice(1, 0, arr.pop()!);
  }
  const second = half.map((f) => ({ home: f.away, away: f.home, matchday: f.matchday + rounds }));
  return [...half, ...second];
}

/** Einfachrunde (Aufstiegsrunden): jeder gegen jeden einmal */
export function singleRoundRobin(clubs: ClubId[], rng: Rng): Fixture[] {
  const all = doubleRoundRobin(clubs, rng);
  const rounds = clubs.length % 2 === 0 ? clubs.length - 1 : clubs.length;
  return all.filter((f) => f.matchday <= rounds);
}

function emptyRow(clubId: ClubId): TableRow {
  return { clubId, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: "" };
}

/**
 * Tabelle nach DFB-Kriterien: Punkte → Tordifferenz → erzielte Tore → direkter Vergleich
 * (Punkte, Tordifferenz, Tore) → Losentscheid (deterministisch über tieSeed).
 */
export function computeTable(clubs: ClubId[], fixtures: Fixture[], tieSeed = 0): TableRow[] {
  const rows: Record<ClubId, TableRow> = {};
  for (const c of clubs) rows[c] = emptyRow(c);
  const played = fixtures.filter((f) => f.hg !== undefined).sort((a, b) => a.matchday - b.matchday);
  for (const f of played) {
    const h = rows[f.home];
    const a = rows[f.away];
    if (!h || !a) continue;
    const hg = f.hg!;
    const ag = f.ag!;
    h.played++;
    a.played++;
    h.gf += hg;
    h.ga += ag;
    a.gf += ag;
    a.ga += hg;
    if (hg > ag) {
      h.w++; a.l++; h.pts += 3; h.form += "W"; a.form += "L";
    } else if (hg < ag) {
      a.w++; h.l++; a.pts += 3; h.form += "L"; a.form += "W";
    } else {
      h.d++; a.d++; h.pts++; a.pts++; h.form += "D"; a.form += "D";
    }
  }
  for (const r of Object.values(rows)) r.form = r.form.slice(-5);
  const list = Object.values(rows);
  const primary = (x: TableRow, y: TableRow) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf;
  list.sort(primary);
  // Gleichstände über direkten Vergleich auflösen
  const out: TableRow[] = [];
  let i = 0;
  while (i < list.length) {
    let j = i + 1;
    while (j < list.length && primary(list[i], list[j]) === 0) j++;
    const group = list.slice(i, j);
    if (group.length > 1) {
      const ids = new Set(group.map((g) => g.clubId));
      const h2h = computeTableRaw(group.map((g) => g.clubId), played.filter((f) => ids.has(f.home) && ids.has(f.away)));
      group.sort((x, y) => {
        const hx = h2h[x.clubId];
        const hy = h2h[y.clubId];
        return (
          hy.pts - hx.pts ||
          (hy.gf - hy.ga) - (hx.gf - hx.ga) ||
          hy.gf - hx.gf ||
          hashKeys(tieSeed, [x.clubId]) - hashKeys(tieSeed, [y.clubId])
        );
      });
    }
    out.push(...group);
    i = j;
  }
  return out;
}

function computeTableRaw(clubs: ClubId[], fixtures: Fixture[]): Record<ClubId, TableRow> {
  const rows: Record<ClubId, TableRow> = {};
  for (const c of clubs) rows[c] = emptyRow(c);
  for (const f of fixtures) {
    const h = rows[f.home];
    const a = rows[f.away];
    h.gf += f.hg!;
    h.ga += f.ag!;
    a.gf += f.ag!;
    a.ga += f.hg!;
    if (f.hg! > f.ag!) h.pts += 3;
    else if (f.hg! < f.ag!) a.pts += 3;
    else {
      h.pts++;
      a.pts++;
    }
  }
  return rows;
}

/**
 * Spielkalender: 38 Spieltage verteilt auf Wochen mit vier englischen Wochen.
 * Liefert für jede Kalenderwoche die Liste der Spieltage.
 */
export function weekCalendar(matchdays: number): number[][] {
  const english = new Set([8, 16, 26, 34].filter((x) => x < matchdays));
  const weeks: number[][] = [];
  let md = 1;
  while (md <= matchdays) {
    if (english.has(md) && md + 1 <= matchdays) {
      weeks.push([md, md + 1]);
      md += 2;
    } else {
      weeks.push([md]);
      md += 1;
    }
  }
  return weeks;
}
