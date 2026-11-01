import { useMemo, useState, type ReactNode } from "react";
import type { Ampel as AmpelT, ClubId, GameState, TableRow } from "../../engine/types";
import { useStore } from "../store";
import { fmt, initials, textColorFor } from "./format";

export function Tip({ text }: { text: string }) {
  return (
    <span className="tip" aria-label={text} tabIndex={0}>
      ?<span className="tiptext">{text}</span>
    </span>
  );
}

export function Ampel({ v }: { v?: AmpelT }) {
  return <span className={`ampel ${v ?? "green"}`} title={v === "red" ? "Problem" : v === "yellow" ? "kritisch" : "im Rahmen"} />;
}

export function ClubBadge({ g, id, size = 22 }: { g: GameState; id: ClubId; size?: number }) {
  const c = g.clubs[id];
  if (!c) return null;
  return (
    <span className="badge" style={{ background: c.colors[0], color: textColorFor(c.colors[0]), width: size, height: size, borderColor: c.colors[1] }}>
      {initials(c)}
    </span>
  );
}

export function ClubLink({ g, id, short, badge }: { g: GameState; id: ClubId; short?: boolean; badge?: boolean }) {
  const open = useStore((s) => s.openClub);
  const c = g.clubs[id];
  if (!c) return <span>{id}</span>;
  return (
    <span className="row" style={{ gap: 6, display: "inline-flex", flexWrap: "nowrap" }}>
      {badge && <ClubBadge g={g} id={id} size={18} />}
      <a onClick={() => open(id)} title={`${c.name} (${c.town})`}>
        {short ? c.shortName : c.name}
      </a>
      {!c.verified && <span className="small muted" title="Stammdaten unsicher (verified=false)">*</span>}
    </span>
  );
}

export function Bar({ value, max = 100, color }: { value: number; max?: number; color?: string }) {
  const p = Math.max(0, Math.min(100, (value / max) * 100));
  const c = color ?? (p >= 60 ? "var(--good)" : p >= 40 ? "var(--warn)" : "var(--bad)");
  return (
    <div className="bar">
      <div style={{ width: `${p}%`, background: c }} />
    </div>
  );
}

export function Kpi({ label, value, ampel, tip, sub }: { label: string; value: ReactNode; ampel?: AmpelT; tip?: string; sub?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="l">
        {ampel && <Ampel v={ampel} />}
        {label}
        {tip && <Tip text={tip} />}
      </div>
      <div className="v">{value}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

/** Tabellenauswahl: Regionalliga-Staffeln und 3. Liga als Reiter, Oberligen im Auswahlfeld */
export function CompetitionPicker({ g, keys, value, onChange }: { g: GameState; keys: string[]; value: string; onChange: (k: string) => void }) {
  const tabs = [
    ...keys.filter((k) => k.startsWith("RL-")).sort().map((k) => ({ id: k, label: `Staffel ${k.slice(3)}` })),
    ...(keys.includes("L3") ? [{ id: "L3", label: "3. Liga" }] : []),
  ];
  const ol = g.oberligen.filter((o) => keys.includes(o.id));
  return (
    <div className="row">
      <Tabs value={value} onChange={onChange} tabs={tabs} />
      {ol.length > 0 && (
        <select value={ol.some((o) => o.id === value) ? value : ""} onChange={(e) => e.target.value && onChange(e.target.value)} style={{ marginBottom: 10 }}>
          <option value="">Oberliga wählen …</option>
          {ol.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} className={t.id === value ? "active" : ""} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export interface Column<R> {
  key: string;
  label: string;
  num?: boolean;
  render?: (r: R) => ReactNode;
  value?: (r: R) => number | string;
  title?: string;
}

/** Sortier- und filterbare Tabelle */
export function SortTable<R>({ rows, cols, initial, filter, rowClass, max = 500 }: {
  rows: R[];
  cols: Column<R>[];
  initial?: { key: string; dir: 1 | -1 };
  filter?: (r: R, q: string) => boolean;
  rowClass?: (r: R, i: number) => string;
  max?: number;
}) {
  const [sort, setSort] = useState(initial);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    let rs = filter && q ? rows.filter((r) => filter(r, q.toLowerCase())) : rows;
    if (sort) {
      const col = cols.find((c) => c.key === sort.key);
      const val = col?.value ?? ((r: R) => (r as Record<string, unknown>)[sort.key] as number);
      rs = [...rs].sort((a, b) => {
        const x = val(a);
        const y = val(b);
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "de")) * sort.dir;
      });
    }
    return rs;
  }, [rows, sort, q, cols, filter]);
  return (
    <div>
      {filter && (
        <div className="row mb">
          <input type="text" placeholder="Filtern …" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
          <span className="small muted">{shown.length} Einträge</span>
        </div>
      )}
      <div className="scroll" style={{ maxHeight: 640 }}>
        <table className="t">
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={`${c.num ? "num" : ""} sortable`}
                  title={c.title}
                  onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key ? ((-s.dir) as 1 | -1) : c.num ? -1 : 1 }))}
                >
                  {c.label}
                  {sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, max).map((r, i) => (
              <tr key={i} className={rowClass?.(r, i)}>
                {cols.map((c) => (
                  <td key={c.key} className={c.num ? "num" : ""}>
                    {c.render ? c.render(r) : String((c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]) ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Ligatabelle mit Auf-/Abstiegszonen */
export function LeagueTable({ g, rows, up = 0, down = 0, compact }: { g: GameState; rows: TableRow[]; up?: number; down?: number; compact?: boolean }) {
  return (
    <table className="t">
      <thead>
        <tr>
          <th className="num">#</th>
          <th>Verein</th>
          <th className="num">Sp</th>
          {!compact && <th className="num">S</th>}
          {!compact && <th className="num">U</th>}
          {!compact && <th className="num">N</th>}
          <th className="num">Tore</th>
          <th className="num">Diff</th>
          <th className="num">Pkt</th>
          {!compact && <th>Form</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.clubId} className={i < up ? "zone-up" : i >= rows.length - down ? "zone-down" : ""}>
            <td className="num">{i + 1}</td>
            <td>
              <ClubLink g={g} id={r.clubId} short={compact} badge />
            </td>
            <td className="num">{r.played}</td>
            {!compact && <td className="num">{r.w}</td>}
            {!compact && <td className="num">{r.d}</td>}
            {!compact && <td className="num">{r.l}</td>}
            <td className="num">
              {r.gf}:{r.ga}
            </td>
            <td className="num">{r.gf - r.ga > 0 ? `+${r.gf - r.ga}` : r.gf - r.ga}</td>
            <td className="num">
              <b>{r.pts}</b>
            </td>
            {!compact && (
              <td className="mono small">
                {r.form.split("").map((ch, k) => (
                  <span key={k} style={{ color: ch === "W" ? "var(--good)" : ch === "L" ? "var(--bad)" : "var(--muted)" }}>
                    {ch === "W" ? "S" : ch === "D" ? "U" : "N"}
                  </span>
                ))}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Einfaches Liniendiagramm (SVG) für Verläufe über Saisons */
export function LineChart({
  series,
  height = 160,
  invert,
  format = (v: number) => fmt(v),
  yMin,
  yMax,
}: {
  series: { label: string; color: string; points: { x: number; y: number | null }[] }[];
  height?: number;
  invert?: boolean;
  format?: (v: number) => string;
  yMin?: number;
  yMax?: number;
}) {
  const W = 560;
  const H = height;
  const pad = { l: 52, r: 10, t: 10, b: 22 };
  const xs = series.flatMap((s) => s.points.map((p) => p.x));
  const ys = series.flatMap((s) => s.points.map((p) => p.y).filter((y): y is number => y !== null));
  if (!xs.length || !ys.length) return <div className="muted small">Noch keine Daten.</div>;
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  let y0 = yMin ?? Math.min(...ys);
  let y1 = yMax ?? Math.max(...ys);
  if (y0 === y1) {
    y0 -= 1;
    y1 += 1;
  }
  const sx = (x: number) => pad.l + ((x - x0) / Math.max(1, x1 - x0)) * (W - pad.l - pad.r);
  const sy = (y: number) => {
    const t = (y - y0) / (y1 - y0);
    return invert ? pad.t + t * (H - pad.t - pad.b) : H - pad.b - t * (H - pad.t - pad.b);
  };
  const ticks = [y0, (y0 + y1) / 2, y1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke="#e3e8ef" />
          <text x={pad.l - 6} y={sy(t) + 4} fontSize="10" textAnchor="end" fill="#5d6878">
            {format(t)}
          </text>
        </g>
      ))}
      {[...new Set(xs)].map((x) =>
        x1 - x0 <= 12 || (x - x0) % Math.ceil((x1 - x0) / 10) === 0 ? (
          <text key={x} x={sx(x)} y={H - 6} fontSize="10" textAnchor="middle" fill="#5d6878">
            {String(x).slice(2)}/{String((x + 1) % 100).padStart(2, "0")}
          </text>
        ) : null,
      )}
      {series.map((s) => {
        const pts = s.points.filter((p) => p.y !== null);
        const d = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x)},${sy(p.y!)}`).join(" ");
        return (
          <g key={s.label}>
            <path d={d} fill="none" stroke={s.color} strokeWidth={2} />
            {pts.map((p) => (
              <circle key={p.x} cx={sx(p.x)} cy={sy(p.y!)} r={3} fill={s.color}>
                <title>
                  {s.label} {p.x}: {format(p.y!)}
                </title>
              </circle>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/** Rückfrage im Spiel statt window.confirm (in eingebetteten Seiten, v. a. mobil, blockiert) */
export function Confirm({ text, ok, danger, onOk, onCancel }: { text: ReactNode; ok: string; danger?: boolean; onOk: () => void; onCancel: () => void }) {
  return (
    <Modal onClose={onCancel}>
      <div className="confirm">
        <p>{text}</p>
        <div className="row mt">
          <button className={`btn ${danger ? "danger" : "primary"}`} onClick={onOk}>
            {ok}
          </button>
          <button className="btn" onClick={onCancel}>
            Abbrechen
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function NewsFeed({ g, limit = 30 }: { g: GameState; limit?: number }) {
  const items = [...g.news].reverse().slice(0, limit);
  return (
    <div className="news">
      {items.map((n) => (
        <div key={n.id} className={`item ${n.tone}`}>
          <div>{n.headline}</div>
          {n.body && <div className="small muted">{n.body}</div>}
          <div className="small muted">
            {n.season}/{String((n.season + 1) % 100).padStart(2, "0")}
          </div>
        </div>
      ))}
      {!items.length && <div className="muted small">Noch keine Meldungen.</div>}
    </div>
  );
}
