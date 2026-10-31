import { useMemo } from "react";
import { seasonLabel } from "../../config/rules";
import { leagueIndex, leagueLabel } from "../../engine/leagues";
import { clubHistory, rivalryRecord } from "../../engine/stats";
import type { Club, GameState, LeagueRef } from "../../engine/types";
import { useStore } from "../store";
import { Bar, ClubBadge, ClubLink, LineChart, Modal, SortTable, type Column } from "../ui/components";
import { eur, fmt, GROUP_HEX, LEVEL_COLORS, LEVEL_SHORT } from "../ui/format";
import { LICENSE_LABEL } from "./LicensingScreen";

const MOVE_LABEL: Record<string, string> = {
  PROMOTED: "↑ Aufstieg",
  RELEGATED: "↓ Abstieg",
  STAYED: "",
  FORCED_RELEGATION: "↓ Zwangsabstieg",
  LICENSE_DENIED: "↓ keine Zulassung",
  WITHDRAWN: "↓ Rückzug",
  INSOLVENT: "↓ Insolvenz",
  REINSTATED: "Nachrücker",
};

interface Row {
  c: Club;
  league?: LeagueRef;
}

export function ClubsScreen() {
  const g = useStore((s) => s.game)!;
  const idx = useMemo(() => leagueIndex(g.leagues), [g.leagues]);
  const rows: Row[] = useMemo(() => Object.values(g.clubs).map((c) => ({ c, league: idx[c.id] })), [g.clubs, idx]);
  const order = { BL: 0, BL2: 1, L3: 2, RL: 3, OL: 4, VL: 5 };
  const cols: Column<Row>[] = [
    { key: "name", label: "Verein", render: (r) => <ClubLink g={g} id={r.c.id} badge />, value: (r) => r.c.name },
    { key: "town", label: "Ort", value: (r) => r.c.town },
    { key: "league", label: "Spielklasse", render: (r) => (r.league ? leagueLabel(r.league, g) : "–"), value: (r) => (r.league ? order[r.league.level] * 100 + r.league.group.charCodeAt(0) : 999) },
    { key: "rv", label: "Regionalverband", value: (r) => r.c.regionalverband },
    { key: "strength", label: "Stärke", num: true, value: (r) => r.c.strength, render: (r) => fmt(r.c.strength, 1) },
    { key: "budget", label: "Etat", num: true, value: (r) => r.c.budget, render: (r) => eur(r.c.budget) },
    { key: "fans", label: "Zuschauerpot.", num: true, value: (r) => r.c.fanPotential, render: (r) => fmt(r.c.fanPotential) },
    { key: "cap", label: "Stadion", num: true, value: (r) => r.c.stadium.capacity, render: (r) => fmt(r.c.stadium.capacity) },
    { key: "lux", label: "Lux", num: true, value: (r) => r.c.stadium.lux },
    { key: "sat", label: "Zufriedenheit", num: true, value: (r) => g.satisfaction[r.c.id] ?? 60, render: (r) => fmt(g.satisfaction[r.c.id] ?? 60) },
    { key: "verified", label: "geprüft", value: (r) => (r.c.verified ? "ja" : "nein") },
  ];
  return (
    <div className="card">
      <h2>Vereine</h2>
      <p className="small muted">* = Stammdaten unsicher (verified = false). Klick auf einen Verein öffnet das Profil.</p>
      <SortTable
        rows={rows}
        cols={cols}
        initial={{ key: "league", dir: 1 }}
        filter={(r, q) => `${r.c.name} ${r.c.town} ${r.c.landesverband} ${r.league ? leagueLabel(r.league, g) : ""}`.toLowerCase().includes(q)}
      />
    </div>
  );
}

export function ClubProfile() {
  const g = useStore((s) => s.game);
  const id = useStore((s) => s.club);
  const close = useStore((s) => s.openClub);
  if (!g || !id || !g.clubs[id]) return null;
  return (
    <Modal onClose={() => close(null)}>
      <ClubProfileBody g={g} id={id} onClose={() => close(null)} />
    </Modal>
  );
}

function ClubProfileBody({ g, id, onClose }: { g: GameState; id: string; onClose: () => void }) {
  const c = g.clubs[id];
  const hist = clubHistory(g, id);
  const cur = leagueIndex(g.leagues)[id];
  const rivals = rivalryRecord(g, id);
  const titles = hist.filter((r) => r.title && r.league.level === "RL");
  const promos = hist.filter((r) => r.movement === "PROMOTED").length;
  // Platzierungskurve: Gesamtposition über alle Ebenen (Ebene × 20 + Rang)
  const lvlBase = { BL: 0, BL2: 18, L3: 36, RL: 56, OL: 76, VL: 92 };
  const pos = hist.map((r) => ({ x: r.season, y: lvlBase[r.league.level] + r.rank }));
  return (
    <div>
      <div className="spread">
        <div className="row">
          <ClubBadge g={g} id={id} size={40} />
          <div>
            <h2 style={{ margin: 0 }}>{c.name}</h2>
            <div className="muted small">
              {c.town} · {c.landesverband} · Regionalverband {c.regionalverband} · Heim-Oberliga {g.oberligen.find((o) => o.id === c.oberligaId)?.name}
              {c.parentId && (
                <>
                  {" "}
                  · Zweitvertretung von <ClubLink g={g} id={c.parentId} />
                </>
              )}
              {!c.verified && <span className="pill warn" style={{ marginLeft: 6 }}>Stammdaten unsicher</span>}
              {c.fictional && <span className="pill" style={{ marginLeft: 6 }}>fiktiv</span>}
            </div>
          </div>
        </div>
        <button className="btn" onClick={onClose}>
          Schließen
        </button>
      </div>
      <div className="grid g4 mt">
        <div className="kpi">
          <div className="l">Aktuell</div>
          <div className="v" style={{ fontSize: 15 }}>{cur ? leagueLabel(cur, g) : "–"}</div>
        </div>
        <div className="kpi">
          <div className="l">Stärke / Etat</div>
          <div className="v" style={{ fontSize: 15 }}>
            {fmt(c.strength, 1)} · {eur(c.budget)}
          </div>
        </div>
        <div className="kpi">
          <div className="l">Stadion</div>
          <div className="v" style={{ fontSize: 15 }}>
            {fmt(c.stadium.capacity)} ({c.stadium.seats} Sitz, {c.stadium.lux} lx, {c.stadium.pressSeats} Presse)
          </div>
        </div>
        <div className="kpi">
          <div className="l">Zufriedenheit</div>
          <Bar value={g.satisfaction[id] ?? 60} />
          <div className="small">{fmt(g.satisfaction[id] ?? 60)}</div>
        </div>
      </div>
      <h4 className="mt">Ligazugehörigkeit</h4>
      {hist.length ? (
        <div className="timeline">
          {hist.map((r) => (
            <div
              key={r.season}
              style={{ background: r.league.level === "RL" ? GROUP_HEX[r.league.group] ?? LEVEL_COLORS.RL : LEVEL_COLORS[r.league.level] }}
              title={`${seasonLabel(r.season)}: ${leagueLabel(r.league, g)}, Platz ${r.rank}${MOVE_LABEL[r.movement] ? " · " + MOVE_LABEL[r.movement] : ""}`}
            >
              {LEVEL_SHORT[r.league.level]}
              {r.league.level === "RL" ? r.league.group : ""}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small">Noch keine abgeschlossene Saison.</p>
      )}
      <div className="grid g2 mt">
        <div>
          <h4>Platzierung (oben = höher)</h4>
          <LineChart series={[{ label: "Gesamtposition", color: "#1f5fae", points: pos }]} invert format={(v) => fmt(v)} />
        </div>
        <div>
          <h4>Reise-km pro Saison</h4>
          <LineChart series={[{ label: "km", color: "#e69f00", points: hist.filter((r) => !r.abstract).map((r) => ({ x: r.season, y: r.travelKm })) }]} />
        </div>
        <div>
          <h4>Zuschauerschnitt</h4>
          <LineChart series={[{ label: "Zuschauer", color: "#009e73", points: hist.filter((r) => !r.abstract).map((r) => ({ x: r.season, y: r.avgAttendance })) }]} />
        </div>
        <div>
          <h4>Etat und Einnahmen aus der Zentralvermarktung</h4>
          <LineChart
            format={(v) => (Math.abs(v) >= 1e6 ? `${fmt(v / 1e6, 1)} M` : `${fmt(v / 1e3)} T`)}
            series={[
              { label: "Etat", color: "#cc79a7", points: hist.map((r) => ({ x: r.season, y: r.budgetEnd })) },
              { label: "Garantie + Ausschüttung", color: "#0072b2", points: hist.map((r) => ({ x: r.season, y: r.income.guarantee + r.income.distribution })) },
            ]}
          />
        </div>
      </div>
      <div className="grid g2 mt">
        <div>
          <h4>Erfolge</h4>
          <div className="small">
            {titles.length ? titles.map((t) => <div key={t.season}>🏆 Staffelmeister {t.league.group} {seasonLabel(t.season)}</div>) : <div className="muted">Noch kein Titel.</div>}
            <div>Aufstiege: {promos}</div>
          </div>
          <h4 className="mt">Rivalen-Bilanz</h4>
          <table className="t">
            <tbody>
              {rivals.map((r) => (
                <tr key={r.opponent}>
                  <td>
                    {"★".repeat(r.weight)} <ClubLink g={g} id={r.opponent} short />
                  </td>
                  <td className="num">
                    {r.w}S {r.d}U {r.l}N
                  </td>
                </tr>
              ))}
              {!rivals.length && (
                <tr>
                  <td className="muted">Keine Rivalitäten hinterlegt.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="scroll" style={{ maxHeight: 360 }}>
          <h4>Saisons</h4>
          <table className="t">
            <thead>
              <tr>
                <th>Saison</th>
                <th>Liga</th>
                <th className="num">Pl.</th>
                <th className="num">Pkt</th>
                <th className="num">Tore</th>
                <th className="num">km</th>
                <th className="num">Zusch.</th>
                <th>Zulassung</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...hist].reverse().map((r) => (
                <tr key={r.season}>
                  <td>{seasonLabel(r.season)}</td>
                  <td>{leagueLabel(r.league, g)}</td>
                  <td className="num">{r.rank}</td>
                  <td className="num">{r.pts}</td>
                  <td className="num">
                    {r.gf}:{r.ga}
                  </td>
                  <td className="num">{r.abstract ? "–" : fmt(r.travelKm)}</td>
                  <td className="num">{r.abstract ? "–" : fmt(r.avgAttendance)}</td>
                  <td className="small" title={r.license.conditions.join("\n")}>
                    {LICENSE_LABEL[r.license.status]}
                    {r.hardship.length ? ` · HF ${r.hardship.map((h) => (h.granted ? "✓" : "✗")).join("")}` : ""}
                  </td>
                  <td className="small">
                    {r.title && r.league.level !== "VL" ? "🏆 " : ""}
                    {MOVE_LABEL[r.movement]}
                    {r.playoff ? ` (${r.playoff.name}: ${r.playoff.won ? "gewonnen" : "verloren"})` : ""}
                    {r.groupChanged ? " · Staffelwechsel" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
