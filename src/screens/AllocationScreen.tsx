import { useMemo, useState } from "react";
import { seasonLabel } from "../../config/rules";
import { clubTravelKm } from "../../engine/allocation/metrics";
import {
  decideHardship,
  loadVariant,
  metricsFor,
  moveClub,
  publishAllocation,
  reoptimize,
  resetToProposal,
  saveVariant,
  swapClubs,
  toggleFixed,
} from "../../engine/game";
import { distanceMatrixFor } from "../../engine/geo";
import { HARDSHIP_LABEL, isFulfilled } from "../../engine/hardship";
import type { Allocation, AllocationMetrics, ClubId, GameState } from "../../engine/types";
import { useStore } from "../store";
import { Ampel, ClubBadge, ClubLink, Kpi, Tabs, Tip } from "../ui/components";
import { fmt, GROUP_HEX } from "../ui/format";
import { MapView } from "../ui/MapView";
import { tips } from "../ui/tips";
import { Tutorial } from "../ui/Tutorial";

type Tab = "STAFFELN" | "HAERTE" | "VARIANTEN" | "REGELN";

export function AllocationScreen() {
  const g = useStore((s) => s.game)!;
  const act = useStore((s) => s.act);
  const actAsync = useStore((s) => s.actAsync);
  const [tab, setTab] = useState<Tab>("STAFFELN");
  const [sel, setSel] = useState<ClubId | null>(null);
  const draft = g.allocationDraft;

  if (g.phase !== "ALLOCATION" || !draft) return <AllocationArchiveHint g={g} />;

  const working = draft.working;
  const T = tips(g.rules);
  const groupIds = g.rules.rl.groupIds;
  const groupOf: Record<ClubId, string> = {};
  for (const [gid, list] of Object.entries(working.groups)) for (const id of list) groupOf[id] = gid;
  const clubs = Object.values(working.groups).flat();

  return (
    <div>
      <div className="spread mb">
        <div>
          <h2>Staffeleinteilung {seasonLabel(g.season)}</h2>
          <div className="small muted">
            {clubs.length} Teams · {groupIds.length} Staffeln à {g.rules.rl.groupSize}
            <Tip text={T.staffeln} /> · Vorlage: {working.label ?? "–"}
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => void actAsync(reoptimize)} title={T.fixieren}>
            ⟳ Neu optimieren
          </button>
          <button className="btn" onClick={() => act(resetToProposal)}>
            Vorschlag wiederherstellen
          </button>
          <button className="btn primary" onClick={() => act(publishAllocation)}>
            Veröffentlichen
          </button>
        </div>
      </div>
      <Metrics g={g} working={working} optimumKm={draft.optimumKm} />
      <div className="alloc mt">
        <div>
          <MapView
            g={g}
            clubs={clubs}
            groupOf={groupOf}
            groupIds={groupIds}
            selected={sel}
            fixed={working.fixed}
            onSelect={setSel}
            onDrop={(id, grp) => act((s) => moveClub(s, id, grp))}
          />
          {sel && <SelectedClub g={g} id={sel} groupOf={groupOf} onClose={() => setSel(null)} />}
        </div>
        <div className="card">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "STAFFELN", label: "Staffeln" },
              { id: "HAERTE", label: `Härtefälle (${draft.hardship.filter((h) => !h.decision).length} offen)` },
              { id: "VARIANTEN", label: "Varianten" },
              { id: "REGELN", label: "Regelprüfung" },
            ]}
          />
          {tab === "STAFFELN" && <GroupLists g={g} working={working} sel={sel} setSel={setSel} />}
          {tab === "HAERTE" && <Hardship g={g} />}
          {tab === "VARIANTEN" && <Variants g={g} />}
          {tab === "REGELN" && <RuleCheck g={g} working={working} />}
        </div>
      </div>
      {!g.settings.tutorialDone && <Tutorial />}
    </div>
  );
}

function AllocationArchiveHint({ g }: { g: GameState }) {
  const setScreen = useStore((s) => s.setScreen);
  const groupOf: Record<ClubId, string> = {};
  const groups = g.allocation?.groups ?? {};
  for (const [gid, list] of Object.entries(groups)) for (const id of list) groupOf[id] = gid;
  return (
    <div>
      <div className="card mb">
        <h2>Staffeleinteilung</h2>
        <p className="muted">
          Die Einteilung ist nur in der Phase „Staffeleinteilung“ bearbeitbar. {g.allocation ? `Aktuell gilt die veröffentlichte Einteilung ${seasonLabel(g.season)}.` : ""}
        </p>
        <button className="btn" onClick={() => setScreen("SAISON")}>
          Zur Saison
        </button>
      </div>
      {g.allocation && (
        <div className="alloc">
          <MapView g={g} clubs={Object.keys(groupOf)} groupOf={groupOf} groupIds={g.rules.rl.groupIds} />
          {g.currentMetrics && <MetricsGrid g={g} m={g.currentMetrics} />}
        </div>
      )}
    </div>
  );
}

function Metrics({ g, working, optimumKm }: { g: GameState; working: Allocation; optimumKm: number }) {
  const m = useMemo(() => metricsFor(g, working), [g, working]);
  return <MetricsGrid g={g} m={m} optimumKm={optimumKm} />;
}

export function MetricsGrid({ g, m, optimumKm }: { g: GameState; m: AllocationMetrics; optimumKm?: number }) {
  const T = tips(g.rules);
  const over = optimumKm ? (m.totalKm - optimumKm) / optimumKm : undefined;
  const groupIds = g.rules.rl.groupIds;
  const topRisk = m.oberligaRisk.slice(0, 3);
  return (
    <div className="grid g4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
      <Kpi
        label="Gesamt-Reise-km"
        ampel={m.ampel.totalKm}
        tip={T.distanz}
        value={fmt(m.totalKm)}
        sub={over !== undefined ? `${over >= 0 ? "+" : ""}${fmt(over * 100, 1)} % ggü. km-Optimum` : `Ø ${fmt(m.totalKm / Math.max(1, groupIds.length * g.rules.rl.groupSize))} km je Verein`}
      />
      <Kpi
        label="Ø km je Verein und Staffel"
        value={
          <span className="row" style={{ gap: 10, fontSize: 13 }}>
            {groupIds.map((gid) => (
              <span key={gid}>
                <span className="chip" style={{ background: GROUP_HEX[gid] }} />
                {fmt(m.avgKmPerClub[gid])}
              </span>
            ))}
          </span>
        }
      />
      <Kpi label="Längste Saisonreise" ampel={m.ampel.maxClub} value={`${fmt(m.maxClub.km)} km`} sub={m.maxClub.clubId ? <ClubLink g={g} id={m.maxClub.clubId} short /> : null} />
      <Kpi label="Fairness (Gini)" ampel={m.ampel.gini} tip={T.gini} value={fmt(m.giniKm, 3)} />
      <Kpi
        label="Derbys erhalten / getrennt"
        ampel={m.ampel.derbies}
        tip={T.derbys}
        value={`${m.derbiesKept} / ${m.derbiesSplit}`}
        sub={`gewichtet ${m.derbiesKeptWeight} / ${m.derbiesSplitWeight}`}
      />
      <Kpi
        label="Zweitvertretungen je Staffel"
        ampel={m.ampel.reserves}
        tip={T.zweitvertretungen}
        value={
          <span className="row" style={{ gap: 10, fontSize: 13 }}>
            {groupIds.map((gid) => (
              <span key={gid} style={{ color: (m.reservesPerGroup[gid] ?? 0) > g.rules.rl.maxReservesPerGroup ? "var(--bad)" : undefined }}>
                <span className="chip" style={{ background: GROUP_HEX[gid] }} />
                {m.reservesPerGroup[gid] ?? 0}
              </span>
            ))}
          </span>
        }
        sub={`Grenze: ${g.rules.rl.maxReservesPerGroup}`}
      />
      <Kpi label="Staffelwechsler ggü. Vorjahr" ampel={m.ampel.changes} tip={T.wechsler} value={g.allocation ? m.groupChanges : "–"} sub={g.allocation ? "Planungssicherheit" : "erste Saison"} />
      <Kpi
        label="Leistungsbalance (Ø Stärke)"
        ampel={m.ampel.balance}
        tip={T.balance}
        value={
          <span className="row" style={{ gap: 10, fontSize: 13 }}>
            {groupIds.map((gid) => (
              <span key={gid}>
                <span className="chip" style={{ background: GROUP_HEX[gid] }} />
                {fmt(m.avgStrength[gid], 1)}
              </span>
            ))}
          </span>
        }
        sub={`Streuung ${fmt(m.strengthSpread, 2)}`}
      />
      <Kpi label="Vermarktungswert / Zuschauer" tip={T.vermarktung} value={fmt(m.marketingValue)} sub={`Prognose Ø ${fmt(m.attendanceForecast)} Zuschauer`} />
      <Kpi label="CO₂-Schätzung" tip={T.co2} value={`${fmt(m.co2Tonnes)} t`} />
      <Kpi
        label="Oberliga-Risiko"
        ampel={m.ampel.oberliga}
        tip={T.oberliga}
        value={<span style={{ fontSize: 13 }}>{topRisk.map((r) => `${g.oberligen.find((o) => o.id === r.oberligaId)?.short ?? r.oberligaId} ${fmt(r.expected, 1)}`).join(" · ")}</span>}
      />
      <Kpi
        label="Regelprüfung"
        ampel={m.ampel.valid}
        value={m.violations.length ? `${m.violations.length} Verstoß${m.violations.length > 1 ? "e" : ""}` : "gültig"}
        sub={m.violations[0]?.rule}
      />
    </div>
  );
}

function SelectedClub({ g, id, groupOf, onClose }: { g: GameState; id: ClubId; groupOf: Record<ClubId, string>; onClose: () => void }) {
  const act = useStore((s) => s.act);
  const c = g.clubs[id];
  const w = g.allocationDraft!.working;
  const dm = distanceMatrixFor(g.clubs, g.rules.allocation.roadFactor);
  const own = groupOf[id];
  const kmIn = (gid: string) => w.groups[gid].filter((x) => x !== id).reduce((a, o) => a + 2 * dm.get(id, o), 0);
  const derbies = g.derbies.filter((d) => d.a === id || d.b === id).filter((d) => groupOf[d.a] && groupOf[d.b]);
  return (
    <div className="card mt">
      <div className="spread">
        <div className="row">
          <ClubBadge g={g} id={id} />
          <ClubLink g={g} id={id} />
          <span className="pill">Staffel {own}</span>
          {c.isReserve && <span className="pill warn">Zweitvertretung</span>}
          {w.fixed.includes(id) && <span className="pill">fixiert</span>}
        </div>
        <button className="btn small" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="row mt">
        <button className="btn small" onClick={() => act((s) => toggleFixed(s, id))} title={tips(g.rules).fixieren}>
          {w.fixed.includes(id) ? "Fixierung lösen" : "📌 Fixieren"}
        </button>
        {g.rules.rl.groupIds.map((gid) => (
          <button key={gid} className={`btn small ${gid === own ? "on" : ""}`} disabled={gid === own} onClick={() => act((s) => moveClub(s, id, gid))}>
            <span className="chip" style={{ background: GROUP_HEX[gid] }} />
            {gid}: {fmt(kmIn(gid))} km
          </button>
        ))}
      </div>
      {derbies.length > 0 && (
        <div className="small mt">
          Rivalen:{" "}
          {derbies.map((d) => {
            const o = d.a === id ? d.b : d.a;
            return (
              <span key={o} style={{ marginRight: 8, color: groupOf[o] === own ? "var(--good)" : "var(--bad)" }}>
                {g.clubs[o].shortName} ({"★".repeat(d.weight)}, {groupOf[o]})
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GroupLists({ g, working, sel, setSel }: { g: GameState; working: Allocation; sel: ClubId | null; setSel: (id: ClubId) => void }) {
  const act = useStore((s) => s.act);
  const [over, setOver] = useState<string | null>(null);
  const [overRow, setOverRow] = useState<string | null>(null);
  const dm = distanceMatrixFor(g.clubs, g.rules.allocation.roadFactor);
  const groupIds = g.rules.rl.groupIds;
  const km = useMemo(() => {
    const out: Record<ClubId, number> = {};
    for (const list of Object.values(working.groups)) Object.assign(out, clubTravelKm(list.filter((x) => g.clubs[x]), dm));
    return out;
  }, [working, dm, g.clubs]);
  return (
    <div className="groups" style={{ gridTemplateColumns: `repeat(${Math.min(groupIds.length, 2)}, minmax(0, 1fr))` }}>
      {groupIds.map((gid) => {
        const list = [...(working.groups[gid] ?? [])].sort((a, b) => g.clubs[a].lat - g.clubs[b].lat).reverse();
        const n = list.length;
        return (
          <div
            key={gid}
            data-group={gid}
            className={`groupcol ${over === gid ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(gid);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              const id = e.dataTransfer.getData("text/club");
              setOver(null);
              setOverRow(null);
              if (id) act((s) => moveClub(s, id, gid));
            }}
          >
            <header style={{ borderTop: `4px solid ${GROUP_HEX[gid]}` }}>
              <span>Staffel {gid}</span>
              <span className={`small ${n !== g.rules.rl.groupSize ? "pill bad" : "muted"}`}>
                {n}/{g.rules.rl.groupSize}
              </span>
            </header>
            <div style={{ maxHeight: 420, overflow: "auto" }}>
              {list.map((id) => (
                <div
                  key={id}
                  className={`clubrow ${sel === id ? "sel" : ""} ${overRow === id ? "over" : ""}`}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/club", id)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverRow(id);
                  }}
                  onDragLeave={() => setOverRow(null)}
                  onDrop={(e) => {
                    e.stopPropagation();
                    const other = e.dataTransfer.getData("text/club");
                    setOver(null);
                    setOverRow(null);
                    if (other && other !== id) act((s) => swapClubs(s, other, id));
                  }}
                  onClick={() => setSel(id)}
                  title="Ziehen: auf eine Staffel = verschieben, auf einen Verein = tauschen"
                >
                  <ClubBadge g={g} id={id} size={18} />
                  <span className="name">
                    {g.clubs[id].shortName}
                    {g.clubs[id].isReserve && <span className="muted"> ◆</span>}
                  </span>
                  {working.fixed.includes(id) && <span title="fixiert">📌</span>}
                  <span className="km small">{fmt(km[id])}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Hardship({ g }: { g: GameState }) {
  const act = useStore((s) => s.act);
  const d = g.allocationDraft!;
  if (!d.hardship.length) return <p className="muted">Keine Härtefallanträge in dieser Saison.</p>;
  return (
    <div>
      <p className="small muted">
        Stattgegebene Anträge werden beim <b>Neu optimieren</b> als harte Vorgabe berücksichtigt. Nicht entschiedene Anträge gelten bei Veröffentlichung als abgelehnt.
        <Tip text={tips(g.rules).haertefall} />
      </p>
      <div className="news">
        {d.hardship.map((h) => {
          const ok = isFulfilled(h, d.working);
          return (
            <div key={h.id} className={`item ${h.decision === "GRANTED" ? "pos" : h.decision === "REJECTED" ? "neg" : ""}`}>
              <div className="spread">
                <b>
                  <ClubLink g={g} id={h.clubId} /> · {HARDSHIP_LABEL[h.reason]}
                </b>
                <span className={`pill ${ok ? "good" : "warn"}`}>{ok ? "in aktueller Einteilung erfüllt" : "nicht erfüllt"}</span>
              </div>
              <div className="small mt">{h.text}</div>
              <div className="row mt">
                <button className={`btn small ${h.decision === "GRANTED" ? "on" : ""}`} onClick={() => act((s) => decideHardship(s, h.id, "GRANTED"))}>
                  Stattgeben
                </button>
                <button className={`btn small ${h.decision === "REJECTED" ? "on" : ""}`} onClick={() => act((s) => decideHardship(s, h.id, "REJECTED"))}>
                  Ablehnen
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Variants({ g }: { g: GameState }) {
  const act = useStore((s) => s.act);
  const d = g.allocationDraft!;
  const slots = ["A", "B", "C"] as const;
  const rows: { label: string; f: (m: AllocationMetrics) => string; better: (a: AllocationMetrics, b: AllocationMetrics) => number }[] = [
    { label: "Gesamt-km", f: (m) => fmt(m.totalKm), better: (a, b) => a.totalKm - b.totalKm },
    { label: "Max. km eines Vereins", f: (m) => fmt(m.maxClub.km), better: (a, b) => a.maxClub.km - b.maxClub.km },
    { label: "Gini", f: (m) => fmt(m.giniKm, 3), better: (a, b) => a.giniKm - b.giniKm },
    { label: "Getrennte Derbys (gew.)", f: (m) => String(m.derbiesSplitWeight), better: (a, b) => a.derbiesSplitWeight - b.derbiesSplitWeight },
    { label: "Staffelwechsler", f: (m) => String(m.groupChanges), better: (a, b) => a.groupChanges - b.groupChanges },
    { label: "Leistungsstreuung", f: (m) => fmt(m.strengthSpread, 2), better: (a, b) => a.strengthSpread - b.strengthSpread },
    { label: "Zuschauerprognose", f: (m) => fmt(m.attendanceForecast), better: (a, b) => b.attendanceForecast - a.attendanceForecast },
    { label: "Max. Zweitvertretungen", f: (m) => String(Math.max(...Object.values(m.reservesPerGroup))), better: () => 0 },
    { label: "Regelverstöße", f: (m) => String(m.violations.length), better: (a, b) => a.violations.length - b.violations.length },
  ];
  const cols: { key: string; label: string; a?: Allocation }[] = [{ key: "cur", label: "Aktuell", a: d.working }, ...slots.map((s) => ({ key: s, label: `Variante ${s}`, a: d.variants[s] }))];
  const ms = cols.map((c) => (c.a ? metricsFor(g, c.a) : undefined));
  return (
    <div>
      <div className="row mb">
        {slots.map((s) => (
          <span key={s} className="row" style={{ gap: 4 }}>
            <button className="btn small" onClick={() => act((st) => saveVariant(st, s))}>
              Als {s} speichern
            </button>
            <button className="btn small" disabled={!d.variants[s]} onClick={() => act((st) => loadVariant(st, s))}>
              {s} laden
            </button>
          </span>
        ))}
      </div>
      <table className="t">
        <thead>
          <tr>
            <th>Kennzahl</th>
            {cols.map((c) => (
              <th key={c.key} className="num">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const avail = ms.filter((m): m is AllocationMetrics => !!m);
            const best = avail.length ? [...avail].sort(r.better)[0] : undefined;
            return (
              <tr key={r.label}>
                <td>{r.label}</td>
                {ms.map((m, i) => (
                  <td key={i} className="num" style={{ fontWeight: m && best && r.better(m, best) === 0 && avail.length > 1 ? 700 : 400 }}>
                    {m ? r.f(m) : "–"}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small muted mt">Variante A enthält zu Beginn den Algorithmus-Vorschlag. Fett = bester Wert.</p>
    </div>
  );
}

function RuleCheck({ g, working }: { g: GameState; working: Allocation }) {
  const m = metricsFor(g, working);
  const T = tips(g.rules);
  return (
    <div>
      {m.violations.length ? (
        <div className="news">
          {m.violations.map((v, i) => (
            <div key={i} className="item neg">
              <b>{v.rule}</b>
              <div className="small">{v.message}</div>
            </div>
          ))}
        </div>
      ) : (
        <p>
          <Ampel v="green" />
          Die Einteilung erfüllt alle Regeln und kann veröffentlicht werden.
        </p>
      )}
      <h4 className="mt">Regeln</h4>
      <ul className="small">
        <li>{T.staffeln}</li>
        <li>{T.zweitvertretungen}</li>
        <li>{T.aufstieg}</li>
        <li>{T.abstieg}</li>
      </ul>
      {m.splitDerbies.length > 0 && (
        <>
          <h4 className="mt">Getrennte Derbys</h4>
          <div className="small">
            {m.splitDerbies.map((d) => (
              <div key={d.a + d.b}>
                {"★".repeat(d.weight)} {g.clubs[d.a].shortName} – {g.clubs[d.b].shortName}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
