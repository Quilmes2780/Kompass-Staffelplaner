import { seasonLabel } from "../../config/rules";
import { ACHIEVEMENTS } from "../../engine/evaluation";
import { acceptance, STAKEHOLDER_LABEL } from "../../engine/stakeholders";
import { STAKEHOLDERS } from "../../engine/types";
import { useStore } from "../store";
import { Bar, ClubLink, Kpi, NewsFeed, Tip } from "../ui/components";
import { eur, fmt } from "../ui/format";
import { tips } from "../ui/tips";

export function VerbandScreen() {
  const g = useStore((s) => s.game)!;
  const T = tips(g.rules);
  const acc = acceptance(g);
  const guarantee = g.season <= g.rules.finance.guaranteeUntilSeason;
  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)" }}>
      <div>
        <div className="card">
          <h2>
            Stakeholder <Tip text={T.akzeptanz} />
          </h2>
          <div className="spread mb">
            <span>Gesamtakzeptanz der Reform</span>
            <b style={{ fontSize: 20 }}>{fmt(acc, 1)}</b>
          </div>
          <Bar value={acc} />
          <table className="t mt">
            <tbody>
              {STAKEHOLDERS.map((k) => (
                <tr key={k}>
                  <td style={{ width: 200 }}>{STAKEHOLDER_LABEL[k]}</td>
                  <td>
                    <Bar value={g.satisfaction[k] ?? 60} />
                  </td>
                  <td className="num" style={{ width: 50 }}>
                    {fmt(g.satisfaction[k] ?? 60)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>
            Finanzen <Tip text={T.finanzen} />
          </h2>
          <div className="grid g3">
            <Kpi label="Zentralvermarktung (Vertragswert p. a.)" value={eur(g.finance.marketingPot)} sub={`Medienvertrag bis ${seasonLabel(g.finance.tvContractUntil)}`} />
            <Kpi label="DFB-Rücklage Liga" value={eur(g.finance.dfbReserve)} sub={g.finance.dfbReserve < 0 ? "im Minus – Präsidium unzufrieden" : "deckt Garantien und Förderungen"} />
            <Kpi label="Garantie je 1. Mannschaft" value={guarantee ? eur(g.rules.finance.guaranteePerClub) : "ausgelaufen"} sub={`bis ${seasonLabel(g.rules.finance.guaranteeUntilSeason)}, darüber ${g.rules.finance.distributionShare * 100} % Ausschüttung`} />
          </div>
          {g.history.seasons.length > 0 && (
            <p className="small muted mt">
              Letzte Saison: Erlös {eur(g.history.seasons[g.history.seasons.length - 1].revenue)}; Mindestzahlung je Regionalverband {eur(g.rules.finance.minPerRegionalverband)}.
            </p>
          )}
        </div>
        <div className="card">
          <h2>Erfolge</h2>
          <div className="grid g2">
            {ACHIEVEMENTS.map((a) => {
              const got = g.achievements.find((x) => x.id === a.id);
              return (
                <div key={a.id} className="kpi" style={{ opacity: got ? 1 : 0.55 }}>
                  <div className="l">{got ? `🏆 ${seasonLabel(got.season)}` : "🔒 offen"}</div>
                  <div style={{ fontWeight: 600 }}>{a.title}</div>
                  <div className="small muted">{a.description}</div>
                </div>
              );
            })}
          </div>
          <p className="mt">
            Gesamt-Score: <b>{fmt(g.score)}</b>
          </p>
        </div>
      </div>
      <div>
        <div className="card">
          <h2>Newsfeed</h2>
          <NewsFeed g={g} limit={40} />
        </div>
        <div className="card">
          <h3>Evaluierungen</h3>
          {g.history.evaluations.map((e) => (
            <div key={e.season} className="small">
              {seasonLabel(e.season)}: Akzeptanz {fmt(e.acceptance, 1)} {e.motionFiled ? "– Rückabwicklungsantrag" : ""}
            </div>
          ))}
          {!g.history.evaluations.length && <p className="muted small">Erste Evaluierung nach {g.rules.evaluation.intervalSeasons} Saisons.</p>}
          <h3 className="mt">Sportgericht</h3>
          {g.courtCases.slice(-10).map((c) => (
            <div key={c.id} className="small">
              {seasonLabel(c.season)}: <ClubLink g={g} id={c.clubId} short /> – {c.subject}: {c.outcome === "OVERTURNED" ? "aufgehoben" : "bestätigt"}
            </div>
          ))}
          {!g.courtCases.length && <p className="muted small">Keine Verfahren.</p>}
          <h3 className="mt">Präzedenzfälle</h3>
          <p className="small">
            {g.precedents.filter((p) => p.kind === "EXEMPTION").length} Ausnahmegenehmigungen · {g.precedents.filter((p) => p.kind === "HARDSHIP").length} Härtefallzusagen ·{" "}
            {g.precedents.filter((p) => p.kind === "DENIAL").length} Verweigerungen
          </p>
        </div>
      </div>
    </div>
  );
}
