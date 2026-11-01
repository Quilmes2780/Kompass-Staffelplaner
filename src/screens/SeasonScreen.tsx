import { useMemo, useState } from "react";
import { seasonLabel } from "../../config/rules";
import { FUNDING_COST, required } from "../../engine/assembly";
import { ACHIEVEMENTS } from "../../engine/evaluation";
import {
  chooseEventOption,
  continueAfterEvaluation,
  continueAfterEvents,
  continueAfterWrapup,
  finishSeason,
  PROLOG_LIMITS,
  prologBlocks,
  prologConcession,
  prologContinue,
  prologVote,
  RESCUE_LIMITS,
  rescueBlocks,
  rescueConcession,
  rescueVote,
  seasonComplete,
  simulate,
} from "../../engine/game";
import { competitionTable, currentMatchday, seasonMatchdays } from "../../engine/season";
import { acceptance } from "../../engine/stakeholders";
import type { DelegateBlock } from "../../engine/assembly";
import type { Concession, GameState } from "../../engine/types";
import { useStore } from "../store";
import { Bar, ClubLink, CompetitionPicker, LeagueTable, NewsFeed, Tip } from "../ui/components";
import { eur, fmt, GROUP_HEX, pct } from "../ui/format";
import { tips } from "../ui/tips";

export function SeasonScreen() {
  const g = useStore((s) => s.game)!;
  switch (g.phase) {
    case "PROLOG":
      return <Prolog g={g} />;
    case "SEASON":
      return <SeasonRunning g={g} />;
    case "WRAPUP":
      return <Wrapup g={g} />;
    case "EVALUATION":
      return <Evaluation g={g} />;
    case "EVENTS":
      return <Events g={g} />;
    case "GAME_OVER":
      return <GameOver g={g} />;
    default:
      return <Waiting g={g} />;
  }
}

function Waiting({ g }: { g: GameState }) {
  const setScreen = useStore((s) => s.setScreen);
  const last = g.history.seasons[g.history.seasons.length - 1];
  return (
    <div className="grid g2">
      <div className="card">
        <h2>Saison {seasonLabel(g.season)}</h2>
        {g.phase === "ALLOCATION" && (
          <>
            <p>Die Staffeleinteilung für die kommende Saison steht aus.</p>
            <button className="btn primary" onClick={() => setScreen("EINTEILUNG")}>
              Zur Staffeleinteilung
            </button>
          </>
        )}
        {g.phase === "LICENSING" && (
          <>
            <p>Das Zulassungsverfahren läuft. Bitte entscheiden Sie über die offenen Anträge.</p>
            <button className="btn primary" onClick={() => setScreen("ZULASSUNG")}>
              Zum Zulassungsverfahren
            </button>
          </>
        )}
        {last && (
          <p className="small muted mt">
            Letzte Saison {seasonLabel(last.season)}: Note {fmt(last.grade, 1)}, Akzeptanz {fmt(last.acceptance, 1)}.
          </p>
        )}
      </div>
      <div className="card">
        <h3>Meldungen</h3>
        <NewsFeed g={g} limit={12} />
      </div>
    </div>
  );
}

function SeasonRunning({ g }: { g: GameState }) {
  const act = useStore((s) => s.act);
  const actAsync = useStore((s) => s.actAsync);
  const groupIds = Object.keys(g.leagues.RL).sort();
  const [tab, setTab] = useState<string>(`RL-${groupIds[0]}`);
  const md = currentMatchday(g);
  const total = seasonMatchdays(g);
  const done = seasonComplete(g);
  const comp = g.competitions[tab];
  const table = useMemo(() => (comp ? competitionTable(g, tab) : []), [g, tab, comp]);
  const lastResults = comp ? comp.fixtures.filter((f) => f.matchday === comp.played) : [];
  const isRl = tab.startsWith("RL-");
  const isOl = comp?.level === "OL";
  return (
    <div>
      <div className="card mb">
        <div className="spread">
          <div>
            <h2>Saison {seasonLabel(g.season)}</h2>
            <div className="muted small">
              Spieltag {md} von {total}
            </div>
          </div>
          <div className="row">
            {!done ? (
              <>
                <button className="btn" onClick={() => act((s) => simulate(s, "MATCHDAY"))}>
                  ▶ Spieltag
                </button>
                <button className="btn" onClick={() => act((s) => simulate(s, "WEEK"))}>
                  ▶▶ Woche
                </button>
                <button className="btn primary" onClick={() => void actAsync((s) => simulate(s, "SEASON"))}>
                  ⏭ Bis Saisonende
                </button>
              </>
            ) : (
              <button className="btn primary" onClick={() => void actAsync(finishSeason)}>
                Saison abschließen
              </button>
            )}
          </div>
        </div>
        <div className="bar mt">
          <div style={{ width: `${(md / Math.max(1, total)) * 100}%`, background: "var(--accent)" }} />
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)" }}>
        <div className="card">
          <CompetitionPicker g={g} keys={Object.keys(g.competitions)} value={tab} onChange={setTab} />
          {isRl && (
            <div className="small muted mb">
              <span className="chip" style={{ background: GROUP_HEX[tab.slice(3)] }} />
              Platz 1 steigt auf (3. Liga), die letzten {g.rules.rl.relegatedPerGroup} steigen ab. <Tip text={tips(g.rules).aufstieg} />
            </div>
          )}
          {isOl && (
            <div className="small muted mb">
              {g.oberligen.find((o) => o.id === tab)?.name}: {comp?.matchdays} Spieltage, gleichmäßig über die Saison verteilt. Der Aufstieg richtet sich nach dem Kontingent der Region (Meister bzw. Aufstiegsrunde).
            </div>
          )}
          <LeagueTable g={g} rows={table} up={isRl || isOl ? 1 : g.rules.l3.promotedToBL2} down={isRl ? g.rules.rl.relegatedPerGroup : isOl ? 0 : g.rules.l3.relegated} />
        </div>
        <div>
          <div className="card">
            <h3>Spieltag {comp?.played ?? 0}</h3>
            <table className="t">
              <tbody>
                {lastResults.map((f) => (
                  <tr key={f.home}>
                    <td>
                      <ClubLink g={g} id={f.home} short />
                    </td>
                    <td className="center mono">
                      <b>
                        {f.hg}:{f.ag}
                      </b>
                    </td>
                    <td>
                      <ClubLink g={g} id={f.away} short />
                    </td>
                    <td className="num small muted">{fmt(f.attendance)}</td>
                  </tr>
                ))}
                {!lastResults.length && (
                  <tr>
                    <td className="muted">Noch keine Spiele.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>Meldungen</h3>
            <NewsFeed g={g} limit={8} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Wrapup({ g }: { g: GameState }) {
  const act = useStore((s) => s.act);
  const s = g.history.seasons[g.history.seasons.length - 1];
  const name = (id: string) => <ClubLink g={g} id={id} />;
  const fresh = g.achievements.filter((a) => a.season === s.season);
  const groupIds = Object.keys(s.tables).filter((k) => k.startsWith("RL-"));
  return (
    <div>
      <div className="card mb">
        <div className="spread">
          <div>
            <h2>Saisonabschluss {seasonLabel(s.season)}</h2>
            <div className="muted">
              Saisonnote <b>{fmt(s.grade, 1)}</b> · Akzeptanz {fmt(s.acceptance, 1)} · {fmt(s.goalsPerGame, 2)} Tore/Spiel · Heimsiege {pct(s.homeWinRate)} · Ø {fmt(s.avgAttendanceRL)} Zuschauer · Erlös {eur(s.revenue)}
            </div>
          </div>
          <button className="btn primary" onClick={() => act(continueAfterWrapup)}>
            Weiter
          </button>
        </div>
        {fresh.length > 0 && (
          <div className="row mt">
            {fresh.map((a) => (
              <span key={a.id} className="pill good">
                🏆 {ACHIEVEMENTS.find((x) => x.id === a.id)?.title}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="grid g3">
        <div className="card">
          <h3>Staffelmeister</h3>
          {groupIds.map((k) => (
            <div key={k} className="row">
              <span className="chip" style={{ background: GROUP_HEX[k.slice(3)] }} />
              {k.slice(3)}: {name(s.champions[k])}
            </div>
          ))}
          <h4 className="mt">Aufstieg in die 3. Liga</h4>
          {s.promotedToL3.map((id) => (
            <div key={id}>↑ {name(id)}</div>
          ))}
          <h4 className="mt">Absteiger aus der 3. Liga</h4>
          {s.relegatedFromL3.map((id) => (
            <div key={id}>↓ {name(id)}</div>
          ))}
        </div>
        <div className="card">
          <h3>Absteiger aus der Regionalliga</h3>
          {s.relegatedFromRL.map((id) => (
            <div key={id}>
              ↓ {name(id)} <span className="small muted">→ {g.oberligen.find((o) => o.id === g.clubs[id].oberligaId)?.name}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Aufsteiger aus den Oberligen</h3>
          {s.promotedFromOL.map((id) => (
            <div key={id}>
              ↑ {name(id)} <span className="small muted">({g.oberligen.find((o) => o.id === g.clubs[id].oberligaId)?.short})</span>
            </div>
          ))}
          <Tip text={tips(g.rules).kontingente} />
        </div>
      </div>
      <div className="grid g2 mt">
        <div className="card">
          <h3>Relegation & Aufstiegsrunden</h3>
          {s.playoffs.map((t) => (
            <div key={t.id} className="mb">
              <b>{t.name}</b>: {g.clubs[t.a].shortName} – {g.clubs[t.b].shortName}{" "}
              <span className="mono">{t.legs.map((l) => `${g.clubs[l.home].shortName} ${l.hg}:${l.ag} ${g.clubs[l.away].shortName}`).join(" · ")}</span>
              {t.decidedBy === "PENALTIES" && " (i. E.)"} → <b>{g.clubs[t.winner].shortName}</b>
            </div>
          ))}
          {s.promotionRounds.map((r) => (
            <div key={r.id} className="mb">
              <b>{r.name}</b>
              {r.table.length ? <LeagueTable g={g} rows={r.table} up={r.promoted.length} compact /> : <div className="small muted">ohne Runde entschieden</div>}
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Sonderfälle</h3>
          {s.specialCases.length ? (
            <ul className="small">
              {s.specialCases.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">Keine.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function BlockTable({ blocks, perBlock, onConcession, used, limits, label }: {
  blocks: DelegateBlock[];
  perBlock?: Record<string, number>;
  onConcession?: (c: Concession) => void;
  used: Concession[];
  limits: { HARDSHIP: number; FUNDING: number };
  label: string;
}) {
  const left = (k: "HARDSHIP" | "FUNDING") => limits[k] - used.filter((c) => c.kind === k).length;
  return (
    <table className="t">
      <thead>
        <tr>
          <th>Delegiertenblock</th>
          <th className="num">Stimmen</th>
          <th style={{ width: 160 }}>{label}</th>
          <th>Empfänglich für</th>
          {perBlock && <th className="num">Ergebnis</th>}
          {onConcession && <th />}
        </tr>
      </thead>
      <tbody>
        {blocks.map((b) => (
          <tr key={b.id}>
            <td>{b.name}</td>
            <td className="num">{b.votes}</td>
            <td>
              <Bar value={b.support * 100} />
              <span className="small muted">{fmt(b.support * 100)} %</span>
            </td>
            <td className="small">{b.wants === "HARDSHIP" ? "Härtefallgarantien" : "Fördergelder"}</td>
            {perBlock && <td className="num">{perBlock[b.id]}</td>}
            {onConcession && (
              <td>
                <div className="row">
                  <button className="btn small" disabled={left("HARDSHIP") <= 0} onClick={() => onConcession({ blockId: b.id, kind: "HARDSHIP" })}>
                    Härtefallgarantie
                  </button>
                  <button className="btn small" disabled={left("FUNDING") <= 0} onClick={() => onConcession({ blockId: b.id, kind: "FUNDING" })}>
                    Fördergeld
                  </button>
                </div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Prolog({ g }: { g: GameState }) {
  const act = useStore((s) => s.act);
  const start = useStore((s) => s.start);
  const p = g.prolog!;
  const blocks = prologBlocks(g);
  const expected = blocks.reduce((a, b) => a + b.votes * b.support, 0);
  const voted = p.won !== undefined;
  return (
    <div className="card">
      <h2>Prolog: DFB-Bundestag, 18.12.2026</h2>
      <p>
        Das Kompassmodell braucht eine Zweidrittelmehrheit: <b>{required(g)}</b> von {g.rules.prolog.votesTotal} Stimmen. Werben Sie bei den Delegiertenblöcken mit Zusagen: {PROLOG_LIMITS.HARDSHIP} Härtefallgarantien
        (Präzedenzfälle) und {PROLOG_LIMITS.FUNDING} Förderpakete à {eur(FUNDING_COST)} aus der DFB-Rücklage.
      </p>
      <BlockTable
        blocks={blocks}
        perBlock={p.perBlock}
        used={p.concessions}
        limits={PROLOG_LIMITS}
        label="Zustimmung"
        onConcession={voted ? undefined : (c) => act((s) => prologConcession(s, c))}
      />
      <div className="spread mt">
        <div>
          Erwartete Ja-Stimmen: <b>{fmt(expected)}</b> (nötig {required(g)}) <span className="small muted">– das Ergebnis schwankt um einige Stimmen.</span>
        </div>
        {!voted && (
          <button className="btn primary" onClick={() => act(prologVote)}>
            Abstimmung durchführen
          </button>
        )}
      </div>
      {voted && (
        <div className="card mt">
          {p.won ? (
            <>
              <h3>Angenommen: {p.votes} Ja-Stimmen</h3>
              <p>Das Kompassmodell ist beschlossen. Die erste viergleisige Saison 2028/29 steht an.</p>
              <button className="btn primary" onClick={() => act((s) => prologContinue(s, false))}>
                Zur ersten Staffeleinteilung
              </button>
            </>
          ) : (
            <>
              <h3>Abgelehnt: nur {p.votes} Ja-Stimmen</h3>
              <p>Der Antrag ist gescheitert. Sie können im Alternativszenario (22/5-Modell, fünf Staffeln) weiterspielen oder neu beginnen.</p>
              <div className="row">
                <button className="btn primary" onClick={() => act((s) => prologContinue(s, true))}>
                  Alternativszenario 22/5
                </button>
                <button className="btn" onClick={() => start({ seed: g.seed + 1, world: g.worldKind, rules: { ...g.rules, prolog: { ...g.rules.prolog, enabled: true } }, settings: g.settings })}>
                  Neu starten
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Evaluation({ g }: { g: GameState }) {
  const act = useStore((s) => s.act);
  const rep = g.history.evaluations[g.history.evaluations.length - 1];
  const r = g.rescue;
  const blocks = r ? rescueBlocks(g) : [];
  return (
    <div>
      <div className="card mb">
        <div className="spread">
          <h2>Evaluierungsbericht {seasonLabel(rep.season)}</h2>
          {(!r || r.survived !== undefined) && (
            <button className="btn primary" onClick={() => act(continueAfterEvaluation)}>
              Weiter
            </button>
          )}
        </div>
        <p>
          Gesamtakzeptanz: <b>{fmt(rep.acceptance, 1)}</b> (Schwelle {g.rules.evaluation.acceptanceThreshold}) <Tip text={tips(g.rules).evaluierung} />
        </p>
        <div className="grid g2">
          <table className="t">
            <thead>
              <tr>
                <th>Kennzahl (Ø der letzten {g.rules.evaluation.intervalSeasons} Saisons)</th>
                <th className="num">Wert</th>
                <th className="num">Trend</th>
              </tr>
            </thead>
            <tbody>
              {rep.trends.map((t) => (
                <tr key={t.key}>
                  <td>{t.label}</td>
                  <td className="num">{fmt(t.value, t.value < 10 ? 2 : 0)}</td>
                  <td className="num">{t.delta ? `${t.delta > 0 ? "+" : ""}${fmt(t.delta, Math.abs(t.delta) < 10 ? 2 : 0)}` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <h4>Kritikpunkte</h4>
            <ul>
              {rep.criticism.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      {r && (
        <div className="card">
          <h2>Antrag auf Rückabwicklung der Reform</h2>
          <p>
            Mehrere Verbände beantragen auf dem Bundestag die Rückkehr zum alten System. Für die Rückabwicklung sind <b>{required(g)}</b> Stimmen nötig. Überzeugen Sie die Blöcke mit Zusagen ({RESCUE_LIMITS.HARDSHIP} Härtefallgarantien,{" "}
            {RESCUE_LIMITS.FUNDING} Förderpakete).
          </p>
          <BlockTable
            blocks={blocks}
            perBlock={r.perBlock}
            used={r.concessions}
            limits={RESCUE_LIMITS}
            label="Rückhalt für die Reform"
            onConcession={r.survived === undefined ? (c) => act((s) => rescueConcession(s, c)) : undefined}
          />
          {r.survived === undefined ? (
            <div className="spread mt">
              <span>
                Erwartete Stimmen für die Rückabwicklung: <b>{fmt(blocks.reduce((a, b) => a + b.votes * (1 - b.support), 0))}</b>
              </span>
              <button className="btn primary" onClick={() => act(rescueVote)}>
                Abstimmung
              </button>
            </div>
          ) : (
            <p className="mt">
              <b>{r.survived ? "Die Reform ist gerettet." : "Die Reform ist gescheitert."}</b> {r.votesForReversal} Stimmen für die Rückabwicklung.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Events({ g }: { g: GameState }) {
  const act = useStore((s) => s.act);
  const open = g.pendingEvents.filter((e) => !e.chosen).length;
  return (
    <div>
      <div className="card mb spread">
        <div>
          <h2>Zwischensaison {seasonLabel(g.season)}</h2>
          <div className="muted">Entscheiden Sie über die anstehenden Vorgänge. Danach beginnt das Zulassungsverfahren für {seasonLabel(g.season + 1)}.</div>
        </div>
        <button className="btn primary" disabled={open > 0} onClick={() => act(continueAfterEvents)}>
          {open ? `${open} offen` : "Zum Zulassungsverfahren"}
        </button>
      </div>
      <div className="grid g2">
        {g.pendingEvents.map((e) => (
          <div key={e.id} className="card">
            <h3>{e.title}</h3>
            <p>{e.text}</p>
            {e.clubId && (
              <p className="small">
                Verein: <ClubLink g={g} id={e.clubId} />
              </p>
            )}
            <div className="grid" style={{ gap: 6 }}>
              {e.options.map((o) => (
                <button
                  key={o.id}
                  className={`btn ${e.chosen === o.id ? "on" : ""}`}
                  style={{ textAlign: "left", whiteSpace: "normal" }}
                  disabled={!!e.chosen}
                  onClick={() => act((s) => chooseEventOption(s, e.id, o.id))}
                >
                  <b>{o.label}</b>
                  <div className="small muted">{o.description}</div>
                </button>
              ))}
            </div>
            {e.outcome && <p className="small mt">→ {e.outcome}</p>}
          </div>
        ))}
        {!g.pendingEvents.length && <div className="card muted">Eine ruhige Sommerpause.</div>}
      </div>
    </div>
  );
}

function GameOver({ g }: { g: GameState }) {
  const setScreen = useStore((s) => s.setScreen);
  return (
    <div className="card">
      <h2>Game over</h2>
      <p>{g.gameOver?.reason}</p>
      <p>
        Sie haben die Reform {g.history.seasons.length} Saisons lang geführt. Gesamt-Score: <b>{fmt(g.score)}</b>, Akzeptanz zuletzt {fmt(acceptance(g), 1)}.
      </p>
      <p>Erfolge: {g.achievements.map((a) => ACHIEVEMENTS.find((x) => x.id === a.id)?.title).join(", ") || "keine"}</p>
      <div className="row">
        <button className="btn" onClick={() => setScreen("STATISTIK")}>
          Statistik ansehen
        </button>
        <button className="btn primary" onClick={() => setScreen("EINSTELLUNGEN")}>
          Neues Spiel
        </button>
      </div>
    </div>
  );
}
