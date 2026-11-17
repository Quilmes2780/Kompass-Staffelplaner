// Zeitraffer der Staffelkarte: Einteilungen Saison für Saison abspielen, mit Neulingen, Abgängen,
// Staffelwechslern und dem Weg der Staffel-Schwerpunkte.
import { useEffect, useMemo, useState } from "react";
import { seasonLabel } from "../../config/rules";
import { leagueLabel } from "../../engine/leagues";
import { timelapseFrames, type TimelapseFrame } from "../../engine/stats";
import type { ClubId, GameState, LeagueRef, Movement } from "../../engine/types";
import { ClubLink, Kpi } from "../ui/components";
import { GROUP_HEX } from "../ui/format";
import { MapView } from "../ui/MapView";

const SPEEDS = [
  { ms: 2500, label: "langsam" },
  { ms: 1500, label: "normal" },
  { ms: 700, label: "schnell" },
];

const LEAVE_REASON: Partial<Record<Movement, string>> = {
  LICENSE_DENIED: "Lizenz verweigert",
  WITHDRAWN: "Rückzug",
  INSOLVENT: "Insolvenz",
  FORCED_RELEGATION: "Zwangsabstieg",
};

const isUp = (ref?: LeagueRef) => ref?.level === "BL" || ref?.level === "BL2" || ref?.level === "L3";

function Chip({ group }: { group: string }) {
  return <span className="chip" style={{ background: GROUP_HEX[group] ?? "#888" }} title={`Staffel ${group}`} />;
}

/** Schwerpunkt (lon/lat) jeder Staffel einer Einteilung */
function centroids(g: GameState, f: TimelapseFrame): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const [gid, list] of Object.entries(f.groups)) {
    const cs = list.map((id) => g.clubs[id]).filter(Boolean);
    if (cs.length) out[gid] = [cs.reduce((a, c) => a + c.lon, 0) / cs.length, cs.reduce((a, c) => a + c.lat, 0) / cs.length];
  }
  return out;
}

export function Timelapse({ g }: { g: GameState }) {
  const frames = useMemo(() => timelapseFrames(g), [g]);
  const cents = useMemo(() => frames.map((f) => centroids(g, f)), [g, frames]);
  const [i, setI] = useState(frames.length - 1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1500);
  const [showTrail, setShowTrail] = useState(true);
  const [showMarks, setShowMarks] = useState(true);
  const last = frames.length - 1;
  const idx = Math.min(Math.max(i, 0), last);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setI((x) => {
        if (x >= last) {
          setPlaying(false);
          return x;
        }
        return x + 1;
      });
    }, speed);
    return () => clearInterval(t);
  }, [playing, speed, last]);

  if (!frames.length) return <p className="muted">Noch keine Staffeleinteilung veröffentlicht.</p>;

  const f = frames[idx];
  const groupIds = Object.keys(f.groups).sort();
  const groupOf: Record<ClubId, string> = {};
  for (const [gid, list] of Object.entries(f.groups)) for (const id of list) groupOf[id] = gid;
  const marks: Record<ClubId, "new" | "changed"> = {};
  if (showMarks) {
    for (const n of f.newcomers) marks[n.clubId] = "new";
    for (const c of f.changers) marks[c.clubId] = "changed";
  }
  const trails: Record<string, [number, number][]> = {};
  if (showTrail)
    for (const gid of groupIds) trails[gid] = cents.slice(0, idx + 1).map((c) => c[gid]).filter(Boolean);
  const play = () => {
    if (playing) return setPlaying(false);
    if (idx >= last) setI(0);
    setPlaying(true);
  };
  const step = (d: number) => {
    setPlaying(false);
    setI(Math.min(Math.max(idx + d, 0), last));
  };

  return (
    <div>
      <div className="timelapse-ctl mb">
        <div className="row">
          <button className="btn small" onClick={() => step(-last)} disabled={idx === 0} title="Erste Saison">
            ⏮
          </button>
          <button className="btn small" onClick={() => step(-1)} disabled={idx === 0} title="Vorherige Saison">
            ◀
          </button>
          <button className="btn small primary" onClick={play} disabled={last === 0} style={{ minWidth: 92 }}>
            {playing ? "⏸ Pause" : "▶ Abspielen"}
          </button>
          <button className="btn small" onClick={() => step(1)} disabled={idx === last} title="Nächste Saison">
            ▶
          </button>
          <button className="btn small" onClick={() => step(last)} disabled={idx === last} title="Letzte Saison">
            ⏭
          </button>
          <b className="timelapse-season">{seasonLabel(f.season)}</b>
        </div>
        <input
          type="range"
          min={0}
          max={last}
          value={idx}
          onChange={(e) => {
            setPlaying(false);
            setI(Number(e.target.value));
          }}
          aria-label="Saison wählen"
        />
        <div className="row small">
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Tempo">
            {SPEEDS.map((s) => (
              <option key={s.ms} value={s.ms}>
                Tempo: {s.label}
              </option>
            ))}
          </select>
          <label>
            <input type="checkbox" checked={showTrail} onChange={(e) => setShowTrail(e.target.checked)} /> Weg der Schwerpunkte
          </label>
          <label>
            <input type="checkbox" checked={showMarks} onChange={(e) => setShowMarks(e.target.checked)} /> Veränderungen markieren
          </label>
        </div>
      </div>
      <div className="alloc">
        <MapView
          g={g}
          clubs={Object.keys(groupOf)}
          groupOf={groupOf}
          groupIds={groupIds}
          showDerbies={false}
          marks={marks}
          ghosts={showMarks ? f.departed.map((d) => ({ id: d.clubId, group: d.group, up: isUp(d.to) })) : undefined}
          trails={showTrail ? trails : undefined}
          legendNote={
            showMarks ? (
              <>
                <span style={{ color: "#1a8a52" }}>◯</span> neu · ◯ Staffelwechsel · <span style={{ color: "#1a8a52" }}>▲</span>/<span style={{ color: "#c0392b" }}>▼</span> weg
                {showTrail ? " · Linie: Schwerpunkt" : ""}
              </>
            ) : showTrail ? (
              "Linie: Weg des Staffel-Schwerpunkts"
            ) : (
              "◆ Zweitvertretung"
            )
          }
        />
        <FramePanel g={g} f={f} />
      </div>
    </div>
  );
}

function FramePanel({ g, f }: { g: GameState; f: TimelapseFrame }) {
  const running = f.season === g.season && !g.history.seasons.some((s) => s.season === f.season);
  return (
    <div>
      <h3>
        Saison {seasonLabel(f.season)}
        {running && <span className="small muted"> · laufend</span>}
      </h3>
      {!f.compared ? (
        <p className="muted small">Erste Einteilung – noch keine Vorsaison zum Vergleich.</p>
      ) : (
        <>
          <div className="grid tl-kpis mb">
            <Kpi label="Neu" value={f.newcomers.length} />
            <Kpi label="Abgänge" value={f.departed.length} />
            <Kpi label="Wechsler" value={f.changers.length} tip="Vereine, die nicht mehr mit der Mehrheit ihrer Vorjahresstaffel spielen" />
          </div>
          <h4>Neu in der Regionalliga</h4>
          <ul className="tl-list">
            {[...f.newcomers]
              .sort((a, b) => a.group.localeCompare(b.group))
              .map((n) => (
                <li key={n.clubId}>
                  <Chip group={n.group} /> <ClubLink g={g} id={n.clubId} />
                  <span className="small muted"> {n.from ? `aus ${n.from.level === "L3" ? "der 3. Liga" : leagueLabel(n.from, g)}` : ""}</span>
                </li>
              ))}
            {!f.newcomers.length && <li className="muted small">keine</li>}
          </ul>
          <h4>Staffelwechsler</h4>
          <ul className="tl-list">
            {f.changers.map((c) => (
              <li key={c.clubId}>
                <ClubLink g={g} id={c.clubId} />{" "}
                <span className="small muted nowrap">
                  <Chip group={c.from} /> {c.from} → <Chip group={c.to} /> {c.to}
                </span>
              </li>
            ))}
            {!f.changers.length && <li className="muted small">keine</li>}
          </ul>
          <h4>Nicht mehr dabei</h4>
          <ul className="tl-list">
            {[...f.departed]
              .sort((a, b) => Number(isUp(b.to)) - Number(isUp(a.to)) || a.group.localeCompare(b.group))
              .map((d) => (
                <li key={d.clubId}>
                  <Chip group={d.group} /> <ClubLink g={g} id={d.clubId} />{" "}
                  <span className="small" style={{ color: isUp(d.to) ? "#1a8a52" : "#c0392b" }}>
                    {isUp(d.to) ? "▲" : "▼"}
                  </span>
                  <span className="small muted">
                    {" "}
                    {(d.movement && LEAVE_REASON[d.movement]) ?? (d.to ? leagueLabel(d.to, g) : "")}
                  </span>
                </li>
              ))}
            {!f.departed.length && <li className="muted small">keine</li>}
          </ul>
        </>
      )}
    </div>
  );
}
