import { seasonLabel } from "../../config/rules";
import { decideAllSuggested, decideLicense, finishLicensingPhase } from "../../engine/game";
import { economicStage, repeatedDeficit, suggestDecision } from "../../engine/licensing";
import type { LicenseStatus } from "../../engine/types";
import { useStore } from "../store";
import { ClubLink, Tip } from "../ui/components";
import { eur, fmt } from "../ui/format";
import { tips } from "../ui/tips";

export const LICENSE_LABEL: Record<LicenseStatus, string> = {
  GRANTED: "Erteilt",
  CONDITIONS: "Mit Auflagen",
  EXEMPTION: "Ausnahmegenehmigung",
  DENIED: "Verweigert",
  NA: "–",
};

const EXPLAIN: Record<string, string> = {
  CONDITIONS: "Zulassung mit Auflagen: Der Verein muss die Mängel bis zur nächsten Saison beheben. Wird die Auflage nicht erfüllt, droht im Folgejahr die Verweigerung.",
  EXEMPTION: "Ausnahmegenehmigung: Der Verein spielt trotz Pflichtmängeln. Jede Ausnahme wird zum Präzedenzfall – Präsidium und Medien reagieren kritisch, spätere Verweigerungen werden vor dem Sportgericht angreifbar.",
  DENIED: "Verweigerung: Der Verein muss in die Oberliga. Der Verein kann vor das Sportgericht ziehen; Präzedenzfälle erhöhen seine Chancen. Ein Nachrücker wird nach Regelwerk bestimmt.",
};

export function LicensingScreen() {
  const g = useStore((s) => s.game)!;
  const act = useStore((s) => s.act);
  const lic = g.licensing;
  if (g.phase !== "LICENSING" || !lic) {
    return (
      <div className="card">
        <h2>Zulassungsverfahren</h2>
        <p className="muted">Das Zulassungsverfahren findet in der Zwischensaison statt (nach den Ereignissen, vor der Staffeleinteilung).</p>
        <p className="small">{tips(g.rules).zulassung}</p>
      </div>
    );
  }
  const open = lic.applications.filter((a) => !a.decision).length;
  const stage = economicStage(g);
  const infra = g.season >= g.rules.licensing.infrastructureMandatoryFrom;
  const problem = lic.applications.filter((a) => !a.clean);
  const clean = lic.applications.filter((a) => a.clean);
  return (
    <div>
      <div className="card mb">
        <div className="spread">
          <div>
            <h2>Zulassungsverfahren {seasonLabel(g.season)}</h2>
            <div className="small muted">
              {lic.applications.length} Anträge · {problem.length} mit Pflichtmängeln · {open} offen · Wirtschaftliche Prüfung: {stage.label}
              {stage.minBudget ? ` (Mindestetat ${eur(stage.minBudget)})` : ""} · Kapazität/Flutlicht {infra ? "verpflichtend" : `ab ${seasonLabel(g.rules.licensing.infrastructureMandatoryFrom)} verpflichtend`}
              <Tip text={tips(g.rules).zulassung} />
            </div>
          </div>
          <div className="row">
            <button className="btn" onClick={() => act(decideAllSuggested)} disabled={!open}>
              Offene nach Empfehlung entscheiden
            </button>
            <button className="btn primary" onClick={() => act(finishLicensingPhase)} disabled={open > 0}>
              Verfahren abschließen
            </button>
          </div>
        </div>
      </div>
      <div className="card mb">
        <h3>Anträge mit Pflichtmängeln</h3>
        {!problem.length && <p className="muted">Keine – alle Vereine erfüllen die Pflichtkriterien (ggf. mit Auflagen).</p>}
        <table className="t">
          <thead>
            <tr>
              <th>Verein</th>
              <th>Mängel</th>
              <th className="num">Etat</th>
              <th>Empfehlung</th>
              <th>Entscheidung</th>
            </tr>
          </thead>
          <tbody>
            {problem.map((a) => {
              const c = g.clubs[a.clubId];
              const sug = suggestDecision(g, a);
              const rep = repeatedDeficit(g, a);
              return (
                <tr key={a.clubId}>
                  <td>
                    <ClubLink g={g} id={a.clubId} badge />
                    <div className="small muted">
                      {fmt(c.stadium.capacity)} Pl. · {c.stadium.seats} Sitz · {c.stadium.lux} lx · {c.stadium.pressSeats} Presse
                    </div>
                  </td>
                  <td className="small">
                    {a.deficits.map((d) => (
                      <div key={d.code} style={{ color: d.mandatory ? "var(--bad)" : "var(--muted)" }}>
                        {d.mandatory ? "●" : "○"} {d.message}
                      </div>
                    ))}
                    {rep && <div className="pill warn">Auflage im Vorjahr nicht erfüllt</div>}
                  </td>
                  <td className="num">{eur(c.budget)}</td>
                  <td className="small">{LICENSE_LABEL[sug]}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {(["CONDITIONS", "EXEMPTION", "DENIED"] as LicenseStatus[]).map((d) => (
                        <button key={d} className={`btn small ${a.decision === d ? "on" : ""} ${d === "DENIED" ? "danger" : ""}`} title={EXPLAIN[d]} onClick={() => act((s) => decideLicense(s, a.clubId, d))}>
                          {LICENSE_LABEL[d]}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>Ohne Pflichtmängel ({clean.length})</h3>
        <p className="small muted">Automatisch erteilt; behebbare Mängel (Sitz-/Presseplätze, Flutlicht-Zielwert) werden als Auflage erteilt.</p>
        <div className="row small">
          {clean.map((a) => (
            <span key={a.clubId} className={`pill ${a.decision === "GRANTED" ? "good" : "warn"}`} title={a.conditions.join("\n")}>
              {g.clubs[a.clubId].shortName}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
