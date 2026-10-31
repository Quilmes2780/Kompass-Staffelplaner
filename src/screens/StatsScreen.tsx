import { useMemo, useState } from "react";
import { seasonLabel } from "../../config/rules";
import { clubSeasonsCSV, seasonsCSV, toCSV } from "../../engine/persistence";
import { dashboardSeries, elevatorTeams, eternalTable, ironmen, records, type EternalRow } from "../../engine/stats";
import type { ClubId, GameState } from "../../engine/types";
import { useStore } from "../store";
import { ClubLink, LeagueTable, LineChart, SortTable, Tabs } from "../ui/components";
import { download, eur, fmt, GROUP_HEX } from "../ui/format";
import { MapView } from "../ui/MapView";
import { MetricsGrid } from "./AllocationScreen";

type Tab = "EWIG" | "REKORDE" | "ARCHIV" | "DASHBOARD" | "EXPORT";

export function StatsScreen() {
  const g = useStore((s) => s.game)!;
  const [tab, setTab] = useState<Tab>("EWIG");
  return (
    <div className="card">
      <h2>Statistik</h2>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "EWIG", label: "Ewige Tabelle" },
          { id: "REKORDE", label: "Rekorde" },
          { id: "ARCHIV", label: "Staffel-Archiv" },
          { id: "DASHBOARD", label: "Liga-Dashboard" },
          { id: "EXPORT", label: "CSV-Export" },
        ]}
      />
      {!g.history.seasons.length && tab !== "EXPORT" ? (
        <p className="muted">Noch keine abgeschlossene Saison.</p>
      ) : (
        <>
          {tab === "EWIG" && <Eternal g={g} />}
          {tab === "REKORDE" && <Records g={g} />}
          {tab === "ARCHIV" && <Archive g={g} />}
          {tab === "DASHBOARD" && <Dashboard g={g} />}
          {tab === "EXPORT" && <Export g={g} />}
        </>
      )}
    </div>
  );
}

function Eternal({ g }: { g: GameState }) {
  const rows = useMemo(() => eternalTable(g), [g]);
  return (
    <SortTable<EternalRow>
      rows={rows.map((r, i) => ({ ...r, rank: i + 1 }) as EternalRow & { rank: number })}
      filter={(r, q) => g.clubs[r.clubId]?.name.toLowerCase().includes(q)}
      initial={{ key: "pts", dir: -1 }}
      cols={[
        { key: "rank", label: "#", num: true },
        { key: "clubId", label: "Verein", render: (r) => <ClubLink g={g} id={r.clubId} badge />, value: (r) => g.clubs[r.clubId]?.name ?? r.clubId },
        { key: "seasons", label: "Saisons", num: true },
        { key: "played", label: "Sp", num: true },
        { key: "w", label: "S", num: true },
        { key: "d", label: "U", num: true },
        { key: "l", label: "N", num: true },
        { key: "gf", label: "Tore", num: true, render: (r) => `${r.gf}:${r.ga}` },
        { key: "diff", label: "Diff", num: true, value: (r) => r.gf - r.ga },
        { key: "pts", label: "Pkt", num: true },
        { key: "titles", label: "Titel", num: true },
        { key: "bestRank", label: "Beste Pl.", num: true },
      ]}
    />
  );
}

function Records({ g }: { g: GameState }) {
  const rec = useMemo(() => records(g), [g]);
  const elev = useMemo(() => elevatorTeams(g).slice(0, 10), [g]);
  const iron = useMemo(() => ironmen(g).slice(0, 10), [g]);
  return (
    <div className="grid g3">
      <div>
        <h3>Rekorde der Regionalliga</h3>
        <table className="t">
          <tbody>
            {rec.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td>
                  <b>{r.value}</b>
                </td>
                <td>{r.clubId && <ClubLink g={g} id={r.clubId} short />}</td>
                <td className="small muted">{r.season !== undefined ? seasonLabel(r.season) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3>Fahrstuhlteams</h3>
        <p className="small muted">Häufigste Wechsel zwischen Regionalliga und anderen Spielklassen.</p>
        <table className="t">
          <tbody>
            {elev.map((r) => (
              <tr key={r.clubId}>
                <td>
                  <ClubLink g={g} id={r.clubId} badge />
                </td>
                <td className="num">{r.moves}×</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3>Dauerbrenner</h3>
        <p className="small muted">Meiste Regionalliga-Saisons in Folge.</p>
        <table className="t">
          <tbody>
            {iron.map((r) => (
              <tr key={r.clubId}>
                <td>
                  <ClubLink g={g} id={r.clubId} badge />
                </td>
                <td className="num">{r.seasons}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Archive({ g }: { g: GameState }) {
  const seasons = g.history.seasons;
  const [sel, setSel] = useState(seasons[seasons.length - 1].season);
  const s = seasons.find((x) => x.season === sel) ?? seasons[seasons.length - 1];
  const groups = s.allocation?.groups ?? {};
  const groupOf: Record<ClubId, string> = {};
  for (const [gid, list] of Object.entries(groups)) for (const id of list) groupOf[id] = gid;
  const rlKeys = Object.keys(s.tables).filter((k) => k.startsWith("RL-")).sort();
  const [tab, setTab] = useState<string>(rlKeys[0] ?? "L3");
  const groupIds = Object.keys(groups).sort();
  return (
    <div>
      <div className="row mb">
        <label className="field" style={{ gridAutoFlow: "column", alignItems: "center" }}>
          <span>Saison</span>
          <select value={sel} onChange={(e) => setSel(Number(e.target.value))}>
            {seasons.map((x) => (
              <option key={x.season} value={x.season}>
                {seasonLabel(x.season)}
              </option>
            ))}
          </select>
        </label>
        <span className="small muted">
          Note {fmt(s.grade, 1)} · Akzeptanz {fmt(s.acceptance, 1)} · {fmt(s.goalsPerGame, 2)} Tore/Spiel · Erlös {eur(s.revenue)}
        </span>
      </div>
      {s.metrics && <MetricsGrid g={g} m={s.metrics} />}
      <div className="alloc mt">
        <MapView g={g} clubs={Object.keys(groupOf)} groupOf={groupOf} groupIds={groupIds} />
        <div>
          <Tabs value={tab} onChange={setTab} tabs={[...rlKeys.map((k) => ({ id: k, label: `Staffel ${k.slice(3)}` })), { id: "L3", label: "3. Liga" }]} />
          {tab.startsWith("RL-") && (
            <div className="small muted mb">
              <span className="chip" style={{ background: GROUP_HEX[tab.slice(3)] }} />
              Abschlusstabelle
            </div>
          )}
          {s.tables[tab] && <LeagueTable g={g} rows={s.tables[tab]} up={tab === "L3" ? g.rules.l3.promotedToBL2 : 1} down={tab === "L3" ? g.rules.l3.relegated : g.rules.rl.relegatedPerGroup} />}
        </div>
      </div>
    </div>
  );
}

function Dashboard({ g }: { g: GameState }) {
  const ser = useMemo(() => dashboardSeries(g), [g]);
  const colors = ["#0072b2", "#e69f00", "#009e73", "#cc79a7", "#56b4e9", "#d55e00", "#132238", "#8892a0"];
  return (
    <div className="grid g2">
      {Object.entries(ser).map(([k, s], i) => (
        <div key={k} className="card">
          <h4>{s.label}</h4>
          <LineChart
            series={[{ label: s.label, color: colors[i % colors.length], points: s.points.map((p) => ({ x: p.season, y: p.value })) }]}
            format={(v) => (s.unit === "€" ? `${fmt(v / 1e6, 1)} M` : Math.abs(v) >= 10000 ? `${fmt(v / 1000)} T` : fmt(v, Math.abs(v) < 10 ? 2 : 0))}
          />
        </div>
      ))}
    </div>
  );
}

function Export({ g }: { g: GameState }) {
  const tag = `kompass-${g.seed}-${seasonLabel(g.season).replace("/", "-")}`;
  const eternal = () =>
    toCSV(
      eternalTable(g).map((r, i) => ({ platz: i + 1, verein_id: r.clubId, verein: g.clubs[r.clubId]?.name, ...r, diff: r.gf - r.ga })),
    );
  const clubs = () =>
    toCSV(
      Object.values(g.clubs).map((c) => ({
        id: c.id,
        name: c.name,
        ort: c.town,
        lat: c.lat,
        lon: c.lon,
        landesverband: c.landesverband,
        regionalverband: c.regionalverband,
        oberliga: c.oberligaId,
        zweitvertretung: c.isReserve ? 1 : 0,
        mutterverein: c.parentId ?? "",
        staerke: c.strength,
        etat: c.budget,
        zuschauerpotenzial: c.fanPotential,
        kapazitaet: c.stadium.capacity,
        sitzplaetze: c.stadium.seats,
        lux: c.stadium.lux,
        presseplaetze: c.stadium.pressSeats,
        verified: c.verified ? 1 : 0,
      })),
    );
  const items = [
    { label: "Vereinshistorie (alle Vereine × Saisons)", file: `${tag}-historie.csv`, make: () => clubSeasonsCSV(g) },
    { label: "Saisonkennzahlen", file: `${tag}-saisons.csv`, make: () => seasonsCSV(g) },
    { label: "Ewige Tabelle", file: `${tag}-ewige-tabelle.csv`, make: eternal },
    { label: "Vereine (aktueller Stand)", file: `${tag}-vereine.csv`, make: clubs },
  ];
  return (
    <div>
      <p className="small muted">CSV mit Semikolon als Trennzeichen (UTF-8), direkt in Excel/LibreOffice öffenbar.</p>
      {items.map((it) => (
        <div key={it.file} className="spread" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
          <span>{it.label}</span>
          <button className="btn small" onClick={() => download(it.file, "﻿" + it.make(), "text/csv")}>
            Herunterladen
          </button>
        </div>
      ))}
    </div>
  );
}
