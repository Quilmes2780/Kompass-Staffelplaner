// Erklärtexte für Tooltips – jede Regel des Kompassmodells.
import type { RulesConfig } from "../../config/rules";
import { fmt } from "./format";

export function tips(r: RulesConfig): Record<string, string> {
  const L = r.licensing;
  return {
    staffeln: `${r.rl.groupIds.length} Staffeln à ${r.rl.groupSize} Teams, Doppelrunde mit ${(r.rl.groupSize - 1) * 2} Spieltagen. Die Einteilung erfolgt jedes Jahr neu – vorrangig nach kürzesten Reisewegen, Verbandsgrenzen sind kein Kriterium.`,
    aufstieg: `Alle ${r.rl.promotedToL3} Staffelmeister steigen direkt in die 3. Liga auf, aus der 3. Liga steigen ${r.l3.relegated} Teams ab. Ein Meister ohne Drittliga-Zulassung wird durch den bestplatzierten zugelassenen Verein seiner Staffel bis Platz ${r.specialCases.noLicenseChampionMaxRank} ersetzt.`,
    abstieg: `Pro Staffel steigen ${r.rl.relegatedPerGroup} Teams in ihre Heim-Oberliga ab (${r.rl.relegatedPerGroup * r.rl.groupIds.length} insgesamt).`,
    kontingente: "16 Aufsteiger aus der 5. Ebene nach Gebiet der bisherigen Regionalligen: West 4, Südwest 4, Nord 3, Bayern 2,5, Nordost 2,5. Der halbe Platz wird jährlich in einer Relegation zwischen dem besten bayerischen und dem besten nordostdeutschen Oberliga-Zweiten ausgespielt.",
    zweitvertretungen: `Fallen einer Staffel mehr als ${r.rl.maxReservesPerGroup} Zweitvertretungen von Lizenzvereinen zu, greift die Sonderregel: Die Einteilung ist dann nicht veröffentlichungsfähig und muss umverteilt werden. Zweitvertretungen spielen immer mindestens eine Ebene unter ihrem Profiverein – steigt der Profiverein in die 3. Liga ab, folgt der Zwangsabstieg.`,
    zulassung: `Stadion ≥ ${fmt(L.minCapacity)} Plätze, davon ≥ ${L.minSeats} Sitzplätze, Flutlicht ≥ ${L.minLux} lx (Ziel ${L.targetLux} lx), mindestens ${L.minPress} Presseplätze. Kapazität und Flutlicht sind erst ab ${L.infrastructureMandatoryFrom}/${(L.infrastructureMandatoryFrom + 1) % 100} verpflichtend. Dazu ein schrittweise eingeführtes wirtschaftliches Zulassungsverfahren.`,
    finanzen: `Jeder Klub mit seiner 1. Mannschaft in der Regionalliga erhält garantiert mindestens ${fmt(r.finance.guaranteePerClub)} € pro Jahr (bis ${r.finance.guaranteeUntilSeason + 1}). Darüber hinausgehende Erlöse der Zentralvermarktung werden zu ${r.finance.distributionShare * 100} % ausgeschüttet. Jeder Regionalverband erhält mindestens ${fmt(r.finance.minPerRegionalverband)} € pro Jahr.`,
    distanz: `Distanz = Luftlinie (Haversine) × Straßenfaktor ${fmt(r.allocation.roadFactor, 2)}. Saison-km eines Vereins = Hin- und Rückfahrt zu jedem Staffelgegner.`,
    gini: "Gini-Koeffizient der Saison-Reisewege aller Vereine: 0 = alle reisen gleich weit, 1 = maximal ungleich.",
    derbys: "Rivalitäten aus data/derbies.json mit Gewicht 1–3. Getrennte Derbys kosten Zuschauer, Fan- und Medienzufriedenheit.",
    wechsler: "Vereine, die gegenüber dem Vorjahr die Staffel wechseln. Viele Wechsel schaden der Planungssicherheit.",
    balance: "Streuung der durchschnittlichen Stärke der Staffeln. Hohe Werte = ungleich schwere Staffeln.",
    oberliga: "Prognose, wie viele Absteiger in dieselbe Oberliga fallen könnten (Summe der Abstiegswahrscheinlichkeiten nach Stärke). Hohe Werte drohen eine temporäre Aufstockung auszulösen.",
    co2: "Schätzung: Reisebus mit 1,1 kg CO₂ je km.",
    vermarktung: "Vermarktungswert aus Zuschauerpotenzial, Zugpferden je Staffel und erhaltenen Derbys.",
    haertefall: "Vereine beantragen begründet eine bestimmte Konstellation. Stattgegebene Anträge werden beim Neu-Optimieren berücksichtigt. Wird eine Zusage in der veröffentlichten Einteilung nicht eingehalten, gilt das als gebrochenes Versprechen.",
    fixieren: "Fixierte Vereine bleiben beim Neu-Optimieren in ihrer aktuellen Staffel.",
    akzeptanz: "Gewichtetes Mittel der Zufriedenheit: Präsidium 20 %, Regionalverbände je 8 %, Fans 15 %, Medien 10 %, Vermarktung 15 %. Fällt sie bei der Evaluierung unter die Schwelle, droht ein Antrag auf Rückabwicklung.",
    evaluierung: `Alle ${r.evaluation.intervalSeasons} Saisons erstellt der DFB einen Evaluierungsbericht. Liegt die Gesamtakzeptanz unter ${r.evaluation.acceptanceThreshold}, wird auf dem Bundestag die Rückabwicklung beantragt (2/3-Mehrheit nötig).`,
  };
}
