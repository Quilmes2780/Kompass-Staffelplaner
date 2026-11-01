import { useMemo, useState, type ReactNode } from "react";
import { seasonLabel } from "../../config/rules";
import { clubSeasonsCSV, seasonsCSV, toCSV } from "../../engine/persistence";
import { leagueLabel } from "../../engine/leagues";
import {
  chronicle,
  dashboardSeries,
  elevatorTeams,
  eternalTable,
  groupChangeClubs,
  groupChangeSeasons,
  ironmen,
  records,
  seasonKpis,
  statScopes,
  type ChronicleEntry,
  type ChronicleMove,
  type EternalRow,
  type SeasonKpiRow,
} from "../../engine/stats";
import type { ClubId, GameState } from "../../engine/types";
import { useStore } from "../store";
import { ClubLink, CompetitionPicker, LeagueTable, LineChart, SortTable, Tabs } from "../ui/components";
import { download, eur, fmt, GROUP_HEX, LEVEL_COLORS } from "../ui/format";
import { MapView } from "../ui/MapView";
import { MetricsGrid } from "./AllocationScreen";

type Tab = "EWIG" | "CHRONIK" | "WECHSLER" | "KENNZAHLEN" | "REKORDE" | "ARCHIV" | "DASHBOARD" | "EXPORT";

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
          { id: "CHRONIK", label: "Chronik" },
          { id: "WECHSLER", label: "Staffelwechsler" },
          { id: "KENNZAHLEN", label: "Kennzahlen je Saison" },
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
          {tab === "CHRONIK" && <Chronicle g={g} />}
          {tab === "WECHSLER" && <GroupChanges g={g} />}
          {tab === "KENNZAHLEN" && <Kpis g={g} />}
          {tab === "REKORDE" && <Records g={g} />}
          {tab === "ARCHIV" && <Archive g={g} />}
          {tab === "DASHBOARD" && <Dashboard g={g} />}
          {tab === "EXPORT" && <Export g={g} />}
        </>
      )}
    </div>
  );
}

function ScopeSelect({ g, value, onChange, all }: { g: GameState; value: string; onChange: (v: string) => void; all?: string }) {
  const scopes = useMemo(() => statScopes(g), [g]);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {all && <option value="">{all}</option>}
      {scopes.map((sc) => (
        <option key={sc.id} value={sc.id}>
          {sc.label}
        </option>
      ))}
    </select>
  );
}

type EternalView = EternalRow & { rank: number; group: string };

function Eternal({ g }: { g: GameState }) {
  const [scope, setScope] = useState("RL");
  // zuletzt gespielte Staffel je Verein (zum Sortieren der Regionalliga-Gesamttabelle nach Staffeln)
  const lastGroup = useMemo(() => {
    const m: Record<ClubId, { season: number; group: string }> = {};
    for (const r of g.history.clubSeasons)
      if (r.league.level === "RL" && (!m[r.clubId] || m[r.clubId].season < r.season)) m[r.clubId] = { season: r.season, group: r.league.group };
    return m;
  }, [g]);
  const rows = useMemo(() => eternalTable(g, scope).map((r, i) => ({ ...r, rank: i + 1, group: lastGroup[r.clubId]?.group ?? "" })), [g, scope, lastGroup]);
  return (
    <div>
      <div className="row mb">
        <label className="field" style={{ gridAutoFlow: "column", alignItems: "center" }}>
          <span>Spielklasse</span>
          <ScopeSelect g={g} value={scope} onChange={setScope} />
        </label>
        <span className="small muted">Eine Staffel umfasst alle Spielzeiten unter ihrem Namen. Der Name geht jedes Jahr auf die Staffel mit den meisten gemeinsamen Vereinen über.</span>
      </div>
      <SortTable<EternalView>
        key={scope}
        rows={rows}
        filter={(r, q) => g.clubs[r.clubId]?.name.toLowerCase().includes(q)}
        initial={{ key: "pts", dir: -1 }}
        cols={[
          { key: "rank", label: "#", num: true },
          { key: "clubId", label: "Verein", render: (r) => <ClubLink g={g} id={r.clubId} badge />, value: (r) => g.clubs[r.clubId]?.name ?? r.clubId },
          ...(scope === "RL"
            ? [
                {
                  key: "group",
                  label: "Letzte Staffel",
                  render: (r: EternalView) =>
                    r.group ? (
                      <span>
                        <span className="chip" style={{ background: GROUP_HEX[r.group] }} />
                        {r.group} <span className="small muted">({seasonLabel(lastGroup[r.clubId].season)})</span>
                      </span>
                    ) : (
                      "–"
                    ),
                },
              ]
            : []),
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
    </div>
  );
}

const MOVE_TEXT: Record<string, string> = {
  FORCED_RELEGATION: "Zwangsabstieg",
  LICENSE_DENIED: "keine Zulassung",
  WITHDRAWN: "Rückzug",
  INSOLVENT: "Insolvenz",
};

function Moves({ g, list, prefix }: { g: GameState; list: ChronicleMove[]; prefix: string }) {
  if (!list.length) return <span className="muted">–</span>;
  return (
    <span>
      {list.map((m, i) => {
        // vor der Staffeleinteilung steht nur die Spielklasse fest
        const target = m.league && (m.league.level === "RL" && m.league.group === "POOL" ? "Regionalliga" : leagueLabel(m.league, g));
        const note = [target && `${prefix} ${target}`, MOVE_TEXT[m.movement]].filter(Boolean).join(", ");
        return (
          <span key={m.clubId}>
            {i > 0 && ", "}
            <ClubLink g={g} id={m.clubId} short />
            {note && <span className="small muted"> ({note})</span>}
          </span>
        );
      })}
    </span>
  );
}

function ChronicleCard({ g, e, showSeason }: { g: GameState; e: ChronicleEntry; showSeason: boolean }) {
  const color = e.level === "RL" ? GROUP_HEX[e.key.slice(3)] : e.level === "L3" ? LEVEL_COLORS.L3 : LEVEL_COLORS.OL;
  const row = (label: string, v: ReactNode) => (
    <tr key={label}>
      <td className="muted" style={{ width: "34%" }}>
        {label}
      </td>
      <td>{v}</td>
    </tr>
  );
  const club = (id: ClubId, extra: string) => (
    <span>
      <ClubLink g={g} id={id} short /> <span className="small muted">{extra}</span>
    </span>
  );
  return (
    <div className="card" style={{ borderTop: `4px solid ${color ?? "#888"}`, marginTop: 0 }}>
      <div className="spread">
        <h4 style={{ margin: 0 }}>{e.label}</h4>
        <span className="small muted">
          {showSeason ? `${seasonLabel(e.season)} · ` : ""}
          {e.teams} Teams{e.abstract ? " · abstrakt simuliert" : ""}
        </span>
      </div>
      <table className="t mt">
        <tbody>
          {row("Meister", e.champion ? club(e.champion.clubId, `${e.champion.pts} Pkt · ${e.champion.gf}:${e.champion.ga}`) : "–")}
          {e.runnerUp && row("Vizemeister", club(e.runnerUp.clubId, `${e.runnerUp.pts} Pkt`))}
          {row("Aufsteiger", <Moves g={g} list={e.promoted} prefix="→" />)}
          {row("Absteiger", <Moves g={g} list={e.relegated} prefix="→" />)}
          {e.reinstated.length > 0 && row("Klassenerhalt als Nachrücker", <Moves g={g} list={e.reinstated} prefix="" />)}
          {row("Neu in der Liga", <Moves g={g} list={e.newcomers} prefix="aus" />)}
          {e.groupChangersIn !== undefined && row("Staffelwechsler hierher", e.groupChangersIn)}
          {e.playoffs.map((p) =>
            row(
              p.name,
              <span>
                {p.text}
                {p.winner && (
                  <span className="small muted">
                    {" "}
                    · Sieger <ClubLink g={g} id={p.winner} short />
                  </span>
                )}
              </span>,
            ),
          )}
          {e.bestAttack && row("Beste Offensive", club(e.bestAttack.clubId, `${e.bestAttack.gf} Tore`))}
          {e.bestDefense && row("Beste Defensive", club(e.bestDefense.clubId, `${e.bestDefense.ga} Gegentore`))}
          {e.goalsPerGame !== undefined && row("Tore pro Spiel", fmt(e.goalsPerGame, 2))}
          {e.avgAttendance !== undefined &&
            row(
              "Ø Zuschauer",
              <span>
                {fmt(e.avgAttendance)}
                {e.topAttendance && (
                  <span className="small muted">
                    {" "}
                    · meiste: <ClubLink g={g} id={e.topAttendance.clubId} short /> ({fmt(e.topAttendance.value)})
                  </span>
                )}
              </span>,
            )}
          {e.totalKm !== undefined && row("Reise-km gesamt", `${fmt(e.totalKm)} km`)}
        </tbody>
      </table>
    </div>
  );
}

function Chronicle({ g }: { g: GameState }) {
  const all = useMemo(() => chronicle(g), [g]);
  const seasons = g.history.seasons.map((s) => s.season);
  const [season, setSeason] = useState<number | "">(seasons[seasons.length - 1]);
  const [scope, setScope] = useState("");
  const shown = all.filter((e) => (season === "" || e.season === season) && (!scope || (scope === "RL" ? e.level === "RL" : e.key === scope)));
  return (
    <div>
      <div className="row mb">
        <label className="field" style={{ gridAutoFlow: "column", alignItems: "center" }}>
          <span>Saison</span>
          <select value={season} onChange={(e) => setSeason(e.target.value === "" ? "" : Number(e.target.value))}>
            <option value="">alle Saisons</option>
            {[...seasons].reverse().map((x) => (
              <option key={x} value={x}>
                {seasonLabel(x)}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ gridAutoFlow: "column", alignItems: "center" }}>
          <span>Liga</span>
          <ScopeSelect g={g} value={scope} onChange={setScope} all="alle Ligen" />
        </label>
      </div>
      {!shown.length && <p className="muted">Keine Einträge für diese Auswahl.</p>}
      <div className="grid g2">
        {shown.map((e) => (
          <ChronicleCard key={`${e.season}|${e.key}`} g={g} e={e} showSeason={season === ""} />
        ))}
      </div>
    </div>
  );
}

function GroupChanges({ g }: { g: GameState }) {
  const perSeason = useMemo(() => groupChangeSeasons(g), [g]);
  const perClub = useMemo(() => groupChangeClubs(g), [g]);
  if (!perSeason.length) return <p className="muted">Staffelwechsel lassen sich erst ab der zweiten abgeschlossenen Saison auswerten.</p>;
  const total = perSeason.reduce((a, s) => a + s.changers.length, 0);
  return (
    <div>
      <p className="small muted">
        Gezählt wird nur der Wechsel von einer Saison zur direkt folgenden. Ein Verein wechselt, wenn er nicht mehr in der Nachfolgerin seiner bisherigen Staffel spielt, also der neuen Staffel mit
        den meisten gemeinsamen Vereinen. Wer zwischendurch in die 3. Liga aufgestiegen oder in eine Oberliga abgestiegen ist, zählt nicht.
      </p>
      <div className="grid g2">
        <div>
          <h3>Je Saison</h3>
          <table className="t">
            <thead>
              <tr>
                <th>Saison</th>
                <th className="num">Wechsler</th>
                <th className="num" title="Vereine, die in beiden Saisons Regionalliga spielten">
                  von
                </th>
                <th>Vereine</th>
              </tr>
            </thead>
            <tbody>
              {[...perSeason].reverse().map((s) => (
                <tr key={s.season}>
                  <td>{seasonLabel(s.season)}</td>
                  <td className="num">
                    <b>{s.changers.length}</b>
                  </td>
                  <td className="num small muted">{s.eligible}</td>
                  <td className="small">
                    {s.changers.map((c, i) => (
                      <span key={c.clubId}>
                        {i > 0 && ", "}
                        <ClubLink g={g} id={c.clubId} short />{" "}
                        <span className="muted">
                          ({c.from} → {c.to})
                        </span>
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>Gesamt</b>
                </td>
                <td className="num">
                  <b>{total}</b>
                </td>
                <td className="num small muted" style={{ whiteSpace: "nowrap" }}>
                  Ø {fmt(total / perSeason.length, 1)}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h3>Je Verein</h3>
          {!perClub.length ? (
            <p className="muted">Bisher hat kein Verein die Staffel gewechselt.</p>
          ) : (
            <SortTable
              rows={perClub}
              filter={(r, q) => g.clubs[r.clubId]?.name.toLowerCase().includes(q)}
              initial={{ key: "changes", dir: -1 }}
              cols={[
                { key: "clubId", label: "Verein", render: (r) => <ClubLink g={g} id={r.clubId} badge />, value: (r) => g.clubs[r.clubId]?.name ?? r.clubId },
                { key: "changes", label: "Wechsel", num: true },
                { key: "rlSeasons", label: "RL-Saisons", num: true },
                { key: "seasons", label: "Zur Saison", render: (r) => r.seasons.map(seasonLabel).join(", "), value: (r) => r.seasons[0] },
              ]}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Kpis({ g }: { g: GameState }) {
  const rows = useMemo(() => seasonKpis(g), [g]);
  const cols: { label: string; f: (r: SeasonKpiRow) => number | undefined; show: (v: number) => string }[] = [
    { label: "Gesamt-Reise-km", f: (r) => r.totalKm, show: (v) => fmt(v) },
    { label: "Getrennte Derbys (gew.)", f: (r) => r.derbiesSplitWeight, show: (v) => fmt(v, 1) },
    { label: "Staffelwechsler", f: (r) => r.groupChanges, show: (v) => fmt(v, Number.isInteger(v) ? 0 : 1) },
    { label: "Leistungsstreuung", f: (r) => r.strengthSpread, show: (v) => fmt(v, 2) },
    { label: "Vermarktungserlös", f: (r) => r.revenue, show: (v) => eur(v) },
    { label: "Ø Zuschauer RL", f: (r) => r.avgAttendanceRL, show: (v) => fmt(v) },
    { label: "Akzeptanz", f: (r) => r.acceptance, show: (v) => fmt(v, 1) },
    { label: "Saisonnote", f: (r) => r.grade, show: (v) => fmt(v, 1) },
  ];
  const avg = (f: (r: SeasonKpiRow) => number | undefined) => {
    const xs = rows.map(f).filter((x): x is number => x !== undefined);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
  };
  return (
    <div>
      <p className="small muted">
        Die Kennzahlen des Evaluierungsberichts für jede einzelne Saison. Der Bericht selbst mittelt sie über die letzten {g.rules.evaluation.intervalSeasons} Saisons.
      </p>
      <div className="scroll">
        <table className="t">
          <thead>
            <tr>
              <th>Saison</th>
              {cols.map((c) => (
                <th key={c.label} className="num">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.season}>
                <td style={{ whiteSpace: "nowrap" }}>
                  {seasonLabel(r.season)} {r.evaluation && <span className="pill">Evaluierung</span>}
                </td>
                {cols.map((c) => {
                  const v = c.f(r);
                  return (
                    <td key={c.label} className="num">
                      {v === undefined ? "–" : c.show(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td>
                <b>Ø alle Saisons</b>
              </td>
              {cols.map((c) => {
                const v = avg(c.f);
                return (
                  <td key={c.label} className="num">
                    <b>{v === undefined ? "–" : c.show(v)}</b>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
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
          <CompetitionPicker g={g} keys={Object.keys(s.tables)} value={tab} onChange={setTab} />
          {tab.startsWith("RL-") && (
            <div className="small muted mb">
              <span className="chip" style={{ background: GROUP_HEX[tab.slice(3)] }} />
              Abschlusstabelle
            </div>
          )}
          {s.tables[tab] && (
            <LeagueTable g={g} rows={s.tables[tab]} up={tab === "L3" ? g.rules.l3.promotedToBL2 : 1} down={tab === "L3" ? g.rules.l3.relegated : tab.startsWith("RL-") ? g.rules.rl.relegatedPerGroup : 0} />
          )}
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
