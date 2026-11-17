// Offline-Karte (d3-geo, SVG): Zoom/Pan, Vereine als Punkte in Staffelfarben, Drag & Drop zwischen Staffeln.
import { geoMercator, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import geo from "../../data/geo/de.json";
import type { ClubId, GameState } from "../../engine/types";
import { GROUP_HEX, initials } from "./format";

const W = 600;
const H = 780;

type Feature = { type: "Feature"; id: string; properties: { name: string; home: boolean }; geometry: GeoPermissibleObjects };
const features = (geo as unknown as { features: Feature[] }).features;
const germany = features.find((f) => f.properties.home)!;
const projection = geoMercator().fitExtent(
  [
    [20, 20],
    [W - 20, H - 20],
  ],
  germany as unknown as GeoPermissibleObjects,
);
const path = geoPath(projection);
const landPaths = features.map((f) => ({ id: f.id, home: f.properties.home, d: path(f as unknown as GeoPermissibleObjects) ?? "" }));

export function project(lon: number, lat: number): [number, number] {
  return projection([lon, lat]) ?? [0, 0];
}

function hull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: [number, number][] = [];
  for (const pt of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export interface MapProps {
  g: GameState;
  clubs: ClubId[];
  groupOf: Record<ClubId, string>;
  groupIds: string[];
  selected?: ClubId | null;
  fixed?: ClubId[];
  onSelect?: (id: ClubId) => void;
  onDrop?: (id: ClubId, group: string) => void;
  showDerbies?: boolean;
  showHulls?: boolean;
  highlight?: ClubId[];
  /** Zeitraffer: neue Vereine (grüner Ring) und Staffelwechsler (dunkler Ring) */
  marks?: Record<ClubId, "new" | "changed">;
  /** Zeitraffer: Vereine, die die Regionalliga verlassen haben (hohl, Farbe der alten Staffel) */
  ghosts?: { id: ClubId; group: string; up: boolean }[];
  /** Zeitraffer: Weg der Staffel-Schwerpunkte über die Saisons (lon/lat) */
  trails?: Record<string, [number, number][]>;
  /** ersetzt die Erklärzeile der Legende */
  legendNote?: ReactNode;
}

export function MapView({ g, clubs, groupOf, groupIds, selected, fixed = [], onSelect, onDrop, showDerbies = true, showHulls = true, highlight = [], marks, ghosts, trails, legendNote }: MapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [drag, setDrag] = useState<{ id: ClubId; x: number; y: number; moved: boolean; target?: string } | null>(null);
  const [pan, setPan] = useState<{ sx: number; sy: number; x: number; y: number } | null>(null);

  const pos = useMemo(() => {
    const m: Record<ClubId, [number, number]> = {};
    for (const id of clubs) {
      const c = g.clubs[id];
      if (c) m[id] = project(c.lon, c.lat);
    }
    return m;
  }, [clubs, g.clubs]);

  const centroids = useMemo(() => {
    const out: Record<string, [number, number]> = {};
    for (const gid of groupIds) {
      const ps = clubs.filter((id) => groupOf[id] === gid && pos[id]).map((id) => pos[id]);
      if (ps.length) out[gid] = [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length];
    }
    return out;
  }, [clubs, groupOf, groupIds, pos]);

  const hulls = useMemo(
    () =>
      groupIds.map((gid) => ({ gid, pts: hull(clubs.filter((id) => groupOf[id] === gid && pos[id]).map((id) => pos[id])) })),
    [clubs, groupOf, groupIds, pos],
  );

  const derbyLines = useMemo(() => {
    if (!showDerbies) return [];
    const set = new Set(clubs);
    return g.derbies.filter((d) => set.has(d.a) && set.has(d.b)).map((d) => ({ ...d, kept: groupOf[d.a] === groupOf[d.b] }));
  }, [g.derbies, clubs, groupOf, showDerbies]);

  const toSvg = (e: { clientX: number; clientY: number }): [number, number] => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [(p.x - view.x) / view.k, (p.y - view.y) / view.k];
  };

  const targetAt = (e: { clientX: number; clientY: number }, x: number, y: number): string | undefined => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-group]");
    if (el && !svgRef.current?.contains(el)) return el.getAttribute("data-group") ?? undefined;
    let best: string | undefined;
    let bd = Infinity;
    for (const [gid, [cx, cy]] of Object.entries(centroids)) {
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bd) {
        bd = d;
        best = gid;
      }
    }
    return best;
  };

  const onWheel = (e: React.WheelEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const k2 = Math.max(1, Math.min(8, view.k * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    setView({ k: k2, x: p.x - ((p.x - view.x) / view.k) * k2, y: p.y - ((p.y - view.y) / view.k) * k2 });
  };

  const zoomBy = (f: number) => {
    const k2 = Math.max(1, Math.min(8, view.k * f));
    const cx = W / 2;
    const cy = H / 2;
    setView({ k: k2, x: cx - ((cx - view.x) / view.k) * k2, y: cy - ((cy - view.y) / view.k) * k2 });
  };

  const onBgDown = (e: RPointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setPan({ sx: e.clientX, sy: e.clientY, x: view.x, y: view.y });
  };

  const onMove = (e: RPointerEvent) => {
    if (drag) {
      const [x, y] = toSvg(e);
      const moved = drag.moved || Math.hypot(x - pos[drag.id][0], y - pos[drag.id][1]) > 4 / view.k;
      setDrag({ ...drag, x, y, moved, target: moved ? targetAt(e, x, y) : undefined });
    } else if (pan) {
      const svg = svgRef.current!;
      const scale = W / svg.getBoundingClientRect().width;
      setView((v) => ({ ...v, x: pan.x + (e.clientX - pan.sx) * scale, y: pan.y + (e.clientY - pan.sy) * scale }));
    }
  };

  const onUp = (e: RPointerEvent) => {
    if (drag) {
      if (!drag.moved) onSelect?.(drag.id);
      else {
        const [x, y] = toSvg(e);
        const t = targetAt(e, x, y);
        if (t && t !== groupOf[drag.id]) onDrop?.(drag.id, t);
      }
      setDrag(null);
    }
    setPan(null);
  };

  const r = 5.5 / Math.sqrt(view.k);
  return (
    <div className="mapbox">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        onWheel={onWheel}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => {
          setPan(null);
        }}
        style={{ cursor: pan ? "grabbing" : drag ? "grabbing" : "default" }}
      >
        <rect width={W} height={H} fill="#e4ecf4" onPointerDown={onBgDown} />
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          <g onPointerDown={onBgDown}>
            {landPaths.map((p) => (
              <path key={p.id} d={p.d} fill={p.home ? "#ffffff" : "#eef1f4"} stroke={p.home ? "#9aa7b8" : "#d3d9e1"} strokeWidth={1 / view.k} />
            ))}
          </g>
          {showHulls &&
            hulls.map(({ gid, pts }) =>
              pts.length > 2 ? (
                <polygon
                  key={gid}
                  points={pts.map((p) => p.join(",")).join(" ")}
                  fill={GROUP_HEX[gid] ?? "#888"}
                  fillOpacity={0.08}
                  stroke={GROUP_HEX[gid] ?? "#888"}
                  strokeOpacity={0.5}
                  strokeWidth={1.2 / view.k}
                  strokeDasharray={`${4 / view.k} ${3 / view.k}`}
                  pointerEvents="none"
                />
              ) : null,
            )}
          {derbyLines.map((d) =>
            pos[d.a] && pos[d.b] ? (
              <line
                key={d.a + d.b}
                x1={pos[d.a][0]}
                y1={pos[d.a][1]}
                x2={pos[d.b][0]}
                y2={pos[d.b][1]}
                stroke={d.kept ? "#1a8a52" : "#c0392b"}
                strokeOpacity={d.kept ? 0.35 : 0.85}
                strokeWidth={(0.6 + d.weight * 0.5) / view.k}
                strokeDasharray={d.kept ? undefined : `${3 / view.k} ${2 / view.k}`}
                pointerEvents="none"
              />
            ) : null,
          )}
          {trails &&
            Object.entries(trails).map(([gid, pts]) => {
              const ps = pts.map(([lon, lat]) => project(lon, lat));
              const col = GROUP_HEX[gid] ?? "#888";
              return (
                <g key={`trail-${gid}`} pointerEvents="none">
                  {ps.length > 1 && (
                    <polyline points={ps.map((p) => p.join(",")).join(" ")} fill="none" stroke={col} strokeWidth={2.5 / view.k} strokeOpacity={0.85} strokeLinejoin="round" />
                  )}
                  {ps.map((p, i) => (
                    <circle key={i} cx={p[0]} cy={p[1]} r={(i === ps.length - 1 ? 7 : 2.5) / Math.sqrt(view.k)} fill={i === ps.length - 1 ? "#fff" : col} stroke={col} strokeWidth={2.5 / view.k} />
                  ))}
                  {ps.length > 0 && (
                    <text x={ps[ps.length - 1][0]} y={ps[ps.length - 1][1] + 3.5 / view.k} fontSize={9 / view.k} textAnchor="middle" fontWeight={700} fill={col}>
                      {gid[0]}
                    </text>
                  )}
                </g>
              );
            })}
          {ghosts?.map(({ id, group, up }) => {
            const c = g.clubs[id];
            if (!c) return null;
            const [x, y] = project(c.lon, c.lat);
            const col = GROUP_HEX[group] ?? "#888";
            return (
              <g key={`ghost-${id}`} transform={`translate(${x},${y})`}>
                <circle r={r} fill="#fff" fillOpacity={0.6} stroke={col} strokeWidth={1.4 / view.k} strokeDasharray={`${2 / view.k} ${1.5 / view.k}`} />
                <text y={3 / view.k} fontSize={8 / view.k} textAnchor="middle" fontWeight={700} fill={up ? "#1a8a52" : "#c0392b"} pointerEvents="none">
                  {up ? "▲" : "▼"}
                </text>
                <title>
                  {c.name} – {up ? "aufgestiegen" : "abgestiegen bzw. ausgeschieden"} (zuvor Staffel {group})
                </title>
              </g>
            );
          })}
          {clubs.map((id) => {
            const p = pos[id];
            if (!p) return null;
            const c = g.clubs[id];
            const color = GROUP_HEX[groupOf[id]] ?? "#888";
            const isSel = selected === id;
            const isDrag = drag?.id === id && drag.moved;
            const mark = marks?.[id];
            return (
              <g key={id} transform={`translate(${p[0]},${p[1]})`} style={{ cursor: onDrop ? "grab" : "pointer" }} opacity={isDrag ? 0.3 : 1}>
                {(isSel || highlight.includes(id)) && <circle r={r * 2} fill="none" stroke="#132238" strokeWidth={1.5 / view.k} />}
                {mark && <circle r={r * 1.9} fill="none" stroke={mark === "new" ? "#1a8a52" : "#132238"} strokeWidth={(mark === "new" ? 2 : 1.6) / view.k} pointerEvents="none" />}
                {c.isReserve ? (
                  <rect
                    x={-r}
                    y={-r}
                    width={2 * r}
                    height={2 * r}
                    transform="rotate(45)"
                    fill={color}
                    style={{ transition: "fill 0.5s" }}
                    stroke="#fff"
                    strokeWidth={1 / view.k}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      (e.target as Element).setPointerCapture?.(e.pointerId);
                      setDrag({ id, x: p[0], y: p[1], moved: false });
                    }}
                  />
                ) : (
                  <circle
                    r={r}
                    fill={color}
                    style={{ transition: "fill 0.5s" }}
                    stroke={fixed.includes(id) ? "#132238" : "#fff"}
                    strokeWidth={(fixed.includes(id) ? 2.2 : 1) / view.k}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      (e.target as Element).setPointerCapture?.(e.pointerId);
                      setDrag({ id, x: p[0], y: p[1], moved: false });
                    }}
                  />
                )}
                {view.k >= 2.2 && (
                  <text y={-r - 2 / view.k} fontSize={9 / view.k} textAnchor="middle" fill="#17202c" pointerEvents="none">
                    {c.shortName}
                  </text>
                )}
                <title>
                  {c.name} ({c.town}) – Staffel {groupOf[id]}
                  {c.isReserve ? " · Zweitvertretung" : ""}
                  {fixed.includes(id) ? " · fixiert" : ""}
                </title>
              </g>
            );
          })}
          {drag?.moved && (
            <g transform={`translate(${drag.x},${drag.y})`} pointerEvents="none">
              <circle r={r * 1.6} fill={GROUP_HEX[drag.target ?? groupOf[drag.id]] ?? "#888"} stroke="#132238" strokeWidth={1.5 / view.k} />
              <text y={-r * 2.2} fontSize={11 / view.k} textAnchor="middle" fontWeight={600} fill="#132238">
                {initials(g.clubs[drag.id])} → {drag.target ?? "?"}
              </text>
            </g>
          )}
        </g>
      </svg>
      <div className="mapctl">
        <button onClick={() => zoomBy(1.4)} title="Hineinzoomen">+</button>
        <button onClick={() => zoomBy(1 / 1.4)} title="Herauszoomen">−</button>
        <button onClick={() => setView({ k: 1, x: 0, y: 0 })} title="Ansicht zurücksetzen">⟲</button>
      </div>
      <div className="maplegend">
        {groupIds.map((gid) => (
          <div key={gid} data-group={gid} className={`lg ${drag?.target === gid ? "drop" : ""}`}>
            <span className="chip" style={{ background: GROUP_HEX[gid] }} />
            Staffel {gid}
          </div>
        ))}
        <div className="small muted">{legendNote ?? "◆ Zweitvertretung · Linien: Derbys (rot = getrennt)"}</div>
      </div>
    </div>
  );
}
